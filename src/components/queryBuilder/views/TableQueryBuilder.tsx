import React from 'react';

import { EditorField, EditorRow } from '@grafana/plugin-ui';

import { BuilderMode, BuilderOptions, ColumnMeta } from '../../../types';
import { AggregateEditor } from '../AggregateEditor';
import { ColumnsEditor } from '../ColumnsEditor';
import { FilterEditor } from '../FilterEditor';
import { GroupByEditor } from '../GroupByEditor';
import { LimitEditor } from '../LimitEditor';
import { ModeSwitch } from '../ModeSwitch';
import { OrderByEditor } from '../OrderByEditor';

interface Props {
  columns: ColumnMeta[];
  options: BuilderOptions;
  onChange: (options: BuilderOptions, run?: boolean) => void;
}

export function TableQueryBuilder({ columns, options, onChange }: Props) {
  return (
    <>
      <EditorRow>
        <EditorField label="Mode">
          <ModeSwitch value={options.mode} onChange={(mode) => onChange({ ...options, mode })} />
        </EditorField>
        {options.mode === BuilderMode.Simple ? (
          <EditorField label="Columns">
            <ColumnsEditor
              columns={columns}
              value={options.columns}
              onChange={(picked) => onChange({ ...options, columns: picked })}
            />
          </EditorField>
        ) : (
          <>
            <EditorField label="Aggregations">
              <AggregateEditor
                columns={columns}
                value={options.aggregates}
                onChange={(aggregates, run) => onChange({ ...options, aggregates }, run)}
              />
            </EditorField>
            <EditorField label="Group by">
              <GroupByEditor
                columns={columns}
                value={options.groupBy}
                onChange={(groupBy) => onChange({ ...options, groupBy })}
              />
            </EditorField>
          </>
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
        <EditorField label="Order by">
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
