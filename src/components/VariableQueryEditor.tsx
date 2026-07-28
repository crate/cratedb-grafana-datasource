import React, { useMemo } from 'react';

import { QueryEditorProps } from '@grafana/data';
import { EditorField, EditorRow, EditorRows, SQLEditor } from '@grafana/plugin-ui';
import { Text } from '@grafana/ui';

import type { CrateDBDatasource } from '../datasource';
import { getCrateDBCompletionProvider } from '../editor/completionProvider';
import { useCompletionData } from '../editor/useCompletionData';
import { useMonacoAutoLayout } from '../editor/useMonacoAutoLayout';
import { CrateDBOptions, CrateDBQuery, CrateDBVariableQuery } from '../types';
import { variableRawSql } from '../variables';

type Props = QueryEditorProps<CrateDBDatasource, CrateDBQuery, CrateDBOptions, CrateDBVariableQuery>;

// Query-variable editor: the panel's Monaco SQL editor (autocomplete + macro hover)
// minus the format picker, since variable queries always run as tables. Accepts
// the bare-string query shape generic SQL dashboards store; edits emit the model.
export function VariableQueryEditor({ query, onChange, datasource }: Props) {
  const rawSql = variableRawSql(query);

  const { getSchemas, getTables, getColumns, error: completionError } = useCompletionData(datasource);
  const completionProvider = useMemo(
    () => getCrateDBCompletionProvider({ getSchemas, getTables, getColumns }),
    [getSchemas, getTables, getColumns]
  );
  const editorRef = useMonacoAutoLayout<HTMLDivElement>();

  return (
    <EditorRows>
      <EditorRow>
        {/* flex:1/min-width:0 stops the editor collapsing as a flex-row item */}
        <div ref={editorRef} style={{ flex: 1, minWidth: 0 }}>
          <SQLEditor
            query={rawSql}
            onChange={(sql) =>
              onChange(typeof query === 'object' && query ? { ...query, rawSql: sql } : { refId: 'A', rawSql: sql })
            }
            language={{ id: 'sql', completionProvider }}
          />
        </div>
      </EditorRow>
      <EditorRow>
        <EditorField label="Result format">
          <Text color="secondary">
            Return one column to use its values as both label and value. Alias two columns{' '}
            <code>__text</code> and <code>__value</code> to show one but submit the other.
          </Text>
        </EditorField>
      </EditorRow>
      {completionError && (
        <EditorRow>
          <Text color="secondary" italic>
            Autocomplete is unavailable — schema lookup failed. Completions fall back to keywords and macros.
          </Text>
        </EditorRow>
      )}
    </EditorRows>
  );
}
