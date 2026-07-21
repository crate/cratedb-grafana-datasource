import React, { useEffect, useMemo, useRef } from 'react';

import { QueryEditorProps, SelectableValue } from '@grafana/data';
import { EditorField, EditorRow, EditorRows, SQLEditor } from '@grafana/plugin-ui';
import { RadioButtonGroup, Text } from '@grafana/ui';

import { detectFormat } from '../data/formatDetection';
import { CrateDBDatasource } from '../datasource';
import { getCrateDBCompletionProvider } from '../editor/completionProvider';
import { useCompletionData } from '../editor/useCompletionData';
import { useMonacoAutoLayout } from '../editor/useMonacoAutoLayout';
import { CrateDBOptions, CrateDBQuery, QueryFormat } from '../types';

type Props = QueryEditorProps<CrateDBDatasource, CrateDBQuery, CrateDBOptions>;

const FORMAT_OPTIONS: Array<SelectableValue<QueryFormat>> = [
  { label: 'Auto', value: QueryFormat.Auto },
  { label: 'Time series', value: QueryFormat.Timeseries },
  { label: 'Table', value: QueryFormat.Table },
  { label: 'Logs', value: QueryFormat.Logs },
];

export function QueryEditor({ query, datasource, onChange, onRunQuery }: Props) {
  const queryRef = useRef<CrateDBQuery>(query);
  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  const { getSchemas, getTables, getColumns, error: completionError } = useCompletionData(datasource);

  const completionProvider = useMemo(
    () => getCrateDBCompletionProvider({ getSchemas, getTables, getColumns }),
    [getSchemas, getTables, getColumns]
  );

  const editorRef = useMonacoAutoLayout<HTMLDivElement>();

  const pickedFormat = query.selectedFormat ?? query.format ?? QueryFormat.Timeseries;
  // what Auto currently resolves to, shown next to the picker
  const resolvedFormat = useMemo(() => detectFormat(query.rawSql), [query.rawSql]);
  const resolvedLabel = FORMAT_OPTIONS.find((option) => option.value === resolvedFormat)?.label;

  return (
    <EditorRows>
      <EditorRow>
        {/* flex:1/min-width:0 stops the editor collapsing as a flex-row item */}
        <div ref={editorRef} style={{ flex: 1, minWidth: 0 }}>
          <SQLEditor
            query={query.rawSql ?? ''}
            onChange={(rawSql, processQuery) => {
              const current = queryRef.current;
              onChange({
                ...current,
                rawSql,
                // Auto resolves at edit time; format always reaches the backend concrete
                format: current.selectedFormat === QueryFormat.Auto ? detectFormat(rawSql) : current.format,
              });
              // the editor's Ctrl/Cmd+Enter binding
              if (processQuery) {
                onRunQuery();
              }
            }}
            language={{ id: 'sql', completionProvider }}
          />
        </div>
      </EditorRow>
      {completionError && (
        <EditorRow>
          <Text color="secondary" italic>
            Autocomplete is unavailable — schema lookup failed. Completions fall back to keywords and macros.
          </Text>
        </EditorRow>
      )}
      <EditorRow>
        <EditorField
          label="Format"
          tooltip="Return the result as a time series, a plain table, or log lines. Auto picks time series when the first selected column is aliased time (or uses $__timeGroupAlias) and more columns follow, logs when a column aliased body accompanies a time column, and table otherwise."
        >
          <RadioButtonGroup
            options={FORMAT_OPTIONS}
            // no picker choice stored means the explicit format is the choice
            value={pickedFormat}
            onChange={(selectedFormat) => {
              onChange({
                ...queryRef.current,
                selectedFormat,
                format:
                  selectedFormat === QueryFormat.Auto ? detectFormat(queryRef.current.rawSql) : selectedFormat,
              });
              onRunQuery();
            }}
          />
        </EditorField>
        {pickedFormat === QueryFormat.Auto && (
          <div style={{ alignSelf: 'flex-end', paddingBottom: 6 }} data-testid="resolved-format">
            <Text color="secondary">→ {resolvedLabel}</Text>
          </div>
        )}
      </EditorRow>
    </EditorRows>
  );
}
