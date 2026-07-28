import React, { useEffect, useRef } from 'react';

import { QueryEditorProps } from '@grafana/data';
import { EditorRow, EditorRows } from '@grafana/plugin-ui';

import { generateSql } from '../data/sqlGenerator';
import { CrateDBDatasource } from '../datasource';
import { BuilderOptions, CrateDBOptions, CrateDBQuery, EditorType } from '../types';
import { EditorTypeSwitcher } from './queryBuilder/EditorTypeSwitcher';
import { QueryBuilder } from './queryBuilder/QueryBuilder';
import { SqlEditor } from './SqlEditor';

type Props = QueryEditorProps<CrateDBDatasource, CrateDBQuery, CrateDBOptions>;

// shell around the two editing surfaces; the visual builder regenerates rawSql
// on every edit, so the backend contract stays {rawSql, format} either way
export function QueryEditor({ query, datasource, onChange, onRunQuery }: Props) {
  const queryRef = useRef<CrateDBQuery>(query);
  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  const onBuilderChange = (options: BuilderOptions, run = true) => {
    const rawSql = generateSql(options);
    onChange({
      ...queryRef.current,
      editorType: EditorType.Builder,
      builderOptions: options,
      rawSql,
      // the flavor is the format; the SQL editor's Auto picker plays no part here
      format: options.flavor,
      selectedFormat: undefined,
    });
    if (run && rawSql) {
      onRunQuery();
    }
  };

  return (
    <EditorRows>
      <EditorRow>
        <EditorTypeSwitcher query={query} datasource={datasource} onChange={onChange} onRunQuery={onRunQuery} />
      </EditorRow>
      {query.editorType === EditorType.Builder ? (
        <QueryBuilder datasource={datasource} options={query.builderOptions} onChange={onBuilderChange} />
      ) : (
        <SqlEditor query={query} datasource={datasource} onChange={onChange} onRunQuery={onRunQuery} />
      )}
    </EditorRows>
  );
}
