import React from 'react';

import { EditorField, EditorRow } from '@grafana/plugin-ui';

import { getColumnByHint } from '../../../data/sqlGenerator';
import { BuilderOptions, ColumnHint, ColumnMeta } from '../../../types';
import { ColumnSelect } from '../ColumnSelect';
import { ColumnsEditor } from '../ColumnsEditor';
import { FilterEditor } from '../FilterEditor';
import { LimitEditor } from '../LimitEditor';
import { withHint } from '../hints';

interface Props {
  columns: ColumnMeta[];
  options: BuilderOptions;
  onChange: (options: BuilderOptions, run?: boolean) => void;
}

export function LogsQueryBuilder({ columns, options, onChange }: Props) {
  const hinted = (hint: ColumnHint) => getColumnByHint(options, hint)?.column;
  const setHinted = (hint: ColumnHint) => (column: string | undefined) =>
    onChange({ ...options, columns: withHint(options.columns, hint, column) });
  const plain = options.columns.filter((column) => !column.hint);

  return (
    <>
      <EditorRow>
        <EditorField label="Time column" tooltip="Timestamp of each log line; bounds the query to the dashboard range">
          <ColumnSelect columns={columns} kinds={['time']} value={hinted(ColumnHint.Time)} onChange={setHinted(ColumnHint.Time)} />
        </EditorField>
        <EditorField label="Message column" tooltip="The log line body">
          <ColumnSelect
            columns={columns}
            kinds={['string']}
            value={hinted(ColumnHint.LogMessage)}
            onChange={setHinted(ColumnHint.LogMessage)}
          />
        </EditorField>
        <EditorField label="Level column" tooltip="Optional severity, colors the log lines">
          <ColumnSelect
            columns={columns}
            kinds={['string']}
            value={hinted(ColumnHint.LogLevel)}
            onChange={setHinted(ColumnHint.LogLevel)}
            placeholder="(none)"
          />
        </EditorField>
        <EditorField label="Extra columns" tooltip="Additional fields attached to each log line">
          <ColumnsEditor
            columns={columns}
            value={plain}
            onChange={(picked) =>
              onChange({ ...options, columns: [...options.columns.filter((column) => column.hint), ...picked] })
            }
          />
        </EditorField>
      </EditorRow>
      <EditorRow>
        <EditorField label="Filters">
          <FilterEditor
            columns={columns}
            value={options.filters}
            onChange={(filters, run) => onChange({ ...options, filters }, run)}
          />
        </EditorField>
        <EditorField label="Limit" tooltip="Newest lines first; the cap keeps the panel responsive">
          <LimitEditor value={options.limit} onChange={(limit) => onChange({ ...options, limit })} />
        </EditorField>
      </EditorRow>
    </>
  );
}
