import React from 'react';

import { EditorField, EditorRow } from '@grafana/plugin-ui';

import { getColumnByHint } from '../../../data/sqlGenerator';
import { BuilderMode, BuilderOptions, ColumnHint, ColumnMeta } from '../../../types';
import { AggregateEditor } from '../AggregateEditor';
import { ColumnSelect } from '../ColumnSelect';
import { ColumnsEditor } from '../ColumnsEditor';
import { FilterEditor } from '../FilterEditor';
import { GroupByEditor } from '../GroupByEditor';
import { LimitEditor } from '../LimitEditor';
import { ModeSwitch } from '../ModeSwitch';
import { OrderByEditor } from '../OrderByEditor';
import { withHint } from '../hints';

interface Props {
  columns: ColumnMeta[];
  options: BuilderOptions;
  onChange: (options: BuilderOptions, run?: boolean) => void;
}

export function TimeSeriesQueryBuilder({ columns, options, onChange }: Props) {
  const plain = options.columns.filter((column) => !column.hint);
  return (
    <>
      <EditorRow>
        <EditorField label="Time column" tooltip="Buckets the series ($__timeGroup) and bounds it to the dashboard range ($__timeFilter)">
          <ColumnSelect
            columns={columns}
            kinds={['time']}
            value={getColumnByHint(options, ColumnHint.Time)?.column}
            onChange={(column) =>
              onChange({ ...options, columns: withHint(options.columns, ColumnHint.Time, column) })
            }
          />
        </EditorField>
        <EditorField label="Mode">
          <ModeSwitch value={options.mode} onChange={(mode) => onChange({ ...options, mode })} />
        </EditorField>
        {options.mode === BuilderMode.Aggregate ? (
          <>
            <EditorField label="Aggregations">
              <AggregateEditor
                columns={columns}
                value={options.aggregates}
                onChange={(aggregates, run) => onChange({ ...options, aggregates }, run)}
              />
            </EditorField>
            <EditorField label="Group by" tooltip="Splits the result into one series per group">
              <GroupByEditor
                columns={columns}
                value={options.groupBy}
                onChange={(groupBy) => onChange({ ...options, groupBy })}
              />
            </EditorField>
          </>
        ) : (
          <EditorField label="Columns">
            <ColumnsEditor
              columns={columns}
              value={plain}
              onChange={(picked) =>
                onChange({ ...options, columns: [...options.columns.filter((column) => column.hint), ...picked] })
              }
            />
          </EditorField>
        )}
      </EditorRow>
      <EditorRow>
        <EditorField label="Filters">
          <FilterEditor
            columns={columns}
            value={options.filters}
            onChange={(filters, run) => onChange({ ...options, filters }, run)}
          />
        </EditorField>
      </EditorRow>
      <EditorRow>
        <EditorField label="Order by" tooltip="Applied after the time ordering">
          <OrderByEditor
            columns={columns}
            value={options.orderBy}
            onChange={(orderBy, run) => onChange({ ...options, orderBy }, run)}
          />
        </EditorField>
        <EditorField label="Limit" tooltip="Row cap; empty means no LIMIT clause">
          <LimitEditor value={options.limit} onChange={(limit) => onChange({ ...options, limit })} />
        </EditorField>
      </EditorRow>
    </>
  );
}
