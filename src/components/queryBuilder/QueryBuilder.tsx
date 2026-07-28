import React, { useEffect, useRef } from 'react';

import { SelectableValue } from '@grafana/data';
import { EditorField, EditorRow } from '@grafana/plugin-ui';
import { RadioButtonGroup } from '@grafana/ui';

import { defaultBuilderOptions, generateSql, getColumnByHint } from '../../data/sqlGenerator';
import { CrateDBDatasource } from '../../datasource';
import { BuilderOptions, ColumnHint, QueryFormat } from '../../types';
import { applyHints } from './hints';
import { SqlPreview } from './SqlPreview';
import { TableSelect } from './TableSelect';
import { useColumnMeta } from './useColumnMeta';
import { LogsQueryBuilder } from './views/LogsQueryBuilder';
import { TableQueryBuilder } from './views/TableQueryBuilder';
import { TimeSeriesQueryBuilder } from './views/TimeSeriesQueryBuilder';

// the visual builder: schema/table/flavor selection, a per-flavor clause editor,
// and a preview of the generated SQL

interface Props {
  datasource: CrateDBDatasource;
  options: BuilderOptions;
  onChange: (options: BuilderOptions, run?: boolean) => void;
}

const FLAVORS: Array<SelectableValue<Exclude<QueryFormat, QueryFormat.Auto>>> = [
  { label: 'Table', value: QueryFormat.Table },
  { label: 'Time series', value: QueryFormat.Timeseries },
  { label: 'Logs', value: QueryFormat.Logs },
];

export function QueryBuilder({ datasource, options, onChange }: Props) {
  const columns = useColumnMeta(datasource, options.schema, options.table);

  // prefill the flavor's hinted columns (time/message/level) once per table and
  // flavor, so a cleared picker stays cleared
  const hintedFor = useRef('');
  useEffect(() => {
    const key = `${options.schema}.${options.table}:${options.flavor}`;
    if (!options.table || columns.length === 0 || hintedFor.current === key) {
      return;
    }
    hintedFor.current = key;
    const next = applyHints(options, columns);
    if (next !== options) {
      onChange(next);
    }
  }, [columns, options, onChange]);

  const changeTable = (schema: string, table: string) => {
    // a new table invalidates every column-bound clause; mode and limit carry over
    const defaults = defaultBuilderOptions(schema, options.flavor);
    onChange({ ...defaults, table, mode: options.mode, limit: options.limit ?? defaults.limit });
  };

  const changeFlavor = (flavor: Exclude<QueryFormat, QueryFormat.Auto>) => {
    if (flavor === options.flavor) {
      return;
    }
    // filters, limit and the time column translate across flavors; the rest
    // restarts from the flavor's defaults (heuristics refill the log roles)
    const time = getColumnByHint(options, ColumnHint.Time);
    const defaults = defaultBuilderOptions(options.schema, flavor);
    onChange({
      ...defaults,
      table: options.table,
      columns: time ? [time] : [],
      filters: options.filters,
      limit: options.limit ?? defaults.limit,
    });
  };

  const view =
    options.flavor === QueryFormat.Timeseries
      ? TimeSeriesQueryBuilder
      : options.flavor === QueryFormat.Logs
        ? LogsQueryBuilder
        : TableQueryBuilder;
  const View = view;

  return (
    <>
      <EditorRow>
        <TableSelect datasource={datasource} schema={options.schema} table={options.table} onChange={changeTable} />
        <EditorField
          label="Type"
          tooltip="Shape of the result: a plain table, a time series bucketed by the panel interval, or log lines"
        >
          <RadioButtonGroup options={FLAVORS} value={options.flavor} onChange={changeFlavor} />
        </EditorField>
      </EditorRow>
      {/* keyed so a table change remounts the editors, dropping any picker
          state (typed filter text) bound to the previous table */}
      <View key={`${options.schema}.${options.table}`} columns={columns} options={options} onChange={onChange} />
      <EditorRow>
        <SqlPreview sql={generateSql(options)} />
      </EditorRow>
    </>
  );
}
