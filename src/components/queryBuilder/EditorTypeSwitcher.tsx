import React, { useState } from 'react';

import { SelectableValue } from '@grafana/data';
import { ConfirmModal, RadioButtonGroup } from '@grafana/ui';

import { defaultBuilderOptions, generateSql } from '../../data/sqlGenerator';
import { parseSqlToBuilderOptions } from '../../data/sqlParser';
import { CrateDBDatasource } from '../../datasource';
import { BuilderOptions, CrateDBQuery, CrateDBSqlQuery, EditorType } from '../../types';

// switches a query between the visual builder and raw SQL.
//
// Builder → SQL always hands over the generated SQL and stashes the builder
// state in meta. SQL → Builder restores that stash when the SQL is untouched,
// else re-derives the state through the SQL parser; only SQL neither the stash
// nor the parser can account for asks before being replaced.
//
// adapted from the ClickHouse datasource (Apache-2.0),
// https://github.com/grafana/clickhouse-datasource; see NOTICE

interface Props {
  query: CrateDBQuery;
  datasource: CrateDBDatasource;
  onChange: (query: CrateDBQuery) => void;
  onRunQuery: () => void;
}

const EDITOR_TYPES: Array<SelectableValue<EditorType>> = [
  { label: 'Builder', value: EditorType.Builder },
  { label: 'SQL', value: EditorType.SQL },
];

export function EditorTypeSwitcher({ query, datasource, onChange, onRunQuery }: Props) {
  const editorType = query.editorType ?? EditorType.SQL;
  // pending SQL → Builder switch awaiting confirmation; null while inactive
  const [pending, setPending] = useState<BuilderOptions | null>(null);

  const toBuilder = (options: BuilderOptions) => {
    const rawSql = generateSql(options);
    // only ever entered from the SQL side; the stash moves back into builderOptions
    const { meta, ...rest } = query as CrateDBSqlQuery;
    void meta;
    onChange({
      ...rest,
      editorType: EditorType.Builder,
      builderOptions: options,
      rawSql,
      format: options.flavor,
      selectedFormat: undefined,
    });
    if (rawSql) {
      onRunQuery();
    }
  };

  const switchTo = (next: EditorType) => {
    if (next === editorType) {
      return;
    }
    if (next === EditorType.SQL) {
      if (query.editorType === EditorType.Builder) {
        const { builderOptions, ...rest } = query;
        onChange({
          ...rest,
          editorType: EditorType.SQL,
          selectedFormat: query.format,
          meta: { builderOptions },
        });
      }
      return;
    }
    const stash = query.editorType !== EditorType.Builder ? query.meta?.builderOptions : undefined;
    if (stash && query.rawSql.trim() === generateSql(stash).trim()) {
      toBuilder(stash);
      return;
    }
    const parsed = parseSqlToBuilderOptions(query.rawSql, datasource.defaultSchema);
    if (parsed) {
      toBuilder(parsed);
      return;
    }
    if (!query.rawSql.trim()) {
      toBuilder(stash ?? defaultBuilderOptions(datasource.defaultSchema));
      return;
    }
    // this SQL can't be carried over — ask before discarding it
    setPending(stash ?? defaultBuilderOptions(datasource.defaultSchema, query.format));
  };

  return (
    <>
      <RadioButtonGroup options={EDITOR_TYPES} value={editorType} onChange={switchTo} size="sm" />
      <ConfirmModal
        isOpen={pending !== null}
        title="Switch to the builder"
        body={
          (query.editorType !== EditorType.Builder && query.meta?.builderOptions
            ? 'This SQL is more than the builder can represent. Switching restores the last builder state and discards your SQL edits.'
            : 'This SQL is more than the builder can represent. Switching starts the builder from scratch and discards the SQL.') +
          ' Switch back to SQL at any time to write the query by hand again.'
        }
        confirmText="Switch"
        onConfirm={() => {
          if (pending) {
            toBuilder(pending);
          }
          setPending(null);
        }}
        onDismiss={() => setPending(null)}
      />
    </>
  );
}
