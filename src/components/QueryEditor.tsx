import React, { useCallback, useEffect, useMemo, useRef } from 'react';

import { QueryEditorProps, SelectableValue } from '@grafana/data';
import { EditorField, EditorRow, EditorRows, SQLEditor } from '@grafana/plugin-ui';
import { RadioButtonGroup } from '@grafana/ui';

import { CrateDBDatasource } from '../datasource';
import { getCrateDBCompletionProvider } from '../editor/completionProvider';
import { CrateDBOptions, CrateDBQuery, QueryFormat } from '../types';

type Props = QueryEditorProps<CrateDBDatasource, CrateDBQuery, CrateDBOptions>;

const FORMAT_OPTIONS: Array<SelectableValue<QueryFormat>> = [
  { label: 'Time series', value: QueryFormat.Timeseries },
  { label: 'Table', value: QueryFormat.Table },
];

export function QueryEditor({ query, datasource, onChange, onRunQuery }: Props) {
  const queryRef = useRef<CrateDBQuery>(query);
  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  const getSchemas = useCallback(async () => {
    const schemas = await datasource.fetchSchemas().catch(() => []);
    return schemas.map((schema) => ({ name: schema, completion: schema }));
  }, [datasource]);

  const getTables = useCallback(
    async (schema?: string) => {
      const tables = await datasource.fetchTables(schema).catch(() => []);
      return tables.map((table) => ({ name: table, completion: table }));
    },
    [datasource]
  );

  const getColumns = useCallback(
    async (table: string, schema?: string) => {
      const columns = await datasource.fetchColumns(schema ?? datasource.defaultSchema, table).catch(() => []);
      return columns.map((column) => ({ name: column, completion: column }));
    },
    [datasource]
  );

  const completionProvider = useMemo(
    () => getCrateDBCompletionProvider({ getSchemas, getTables, getColumns }),
    [getSchemas, getTables, getColumns]
  );

  return (
    <EditorRows>
      <EditorRow>
        <SQLEditor
          query={query.rawSql}
          onChange={(rawSql) => onChange({ ...queryRef.current, rawSql })}
          language={{ id: 'sql', completionProvider }}
        />
      </EditorRow>
      <EditorRow>
        <EditorField label="Format" tooltip="Return the result as a time series or as a plain table.">
          <RadioButtonGroup
            options={FORMAT_OPTIONS}
            value={query.format ?? QueryFormat.Timeseries}
            onChange={(format) => {
              onChange({ ...queryRef.current, format });
              onRunQuery();
            }}
          />
        </EditorField>
      </EditorRow>
    </EditorRows>
  );
}
