import React, { useEffect, useState } from 'react';

import { EditorField } from '@grafana/plugin-ui';
import { Combobox, ComboboxOption } from '@grafana/ui';

import { CrateDBDatasource } from '../../datasource';

interface Props {
  datasource: CrateDBDatasource;
  schema: string;
  table: string;
  onChange: (schema: string, table: string) => void;
}

function toOptions(names: string[]): Array<ComboboxOption<string>> {
  return names.map((name) => ({ label: name, value: name }));
}

// schema + table pickers fed by the backend introspection routes; failures
// degrade to free-text entry
export function TableSelect({ datasource, schema, table, onChange }: Props) {
  const [schemas, setSchemas] = useState<string[]>([]);
  // keyed by schema so a stale list never shows for the current one
  const [tables, setTables] = useState<{ schema: string; names: string[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    datasource.fetchSchemas().then(
      (names) => {
        if (!cancelled) {
          setSchemas(names);
        }
      },
      () => {}
    );
    return () => {
      cancelled = true;
    };
  }, [datasource]);

  useEffect(() => {
    let cancelled = false;
    if (schema) {
      datasource.fetchTables(schema).then(
        (names) => {
          if (!cancelled) {
            setTables({ schema, names });
          }
        },
        () => {}
      );
    }
    return () => {
      cancelled = true;
    };
  }, [datasource, schema]);

  return (
    <>
      <EditorField label="Schema" width={25}>
        <Combobox
          options={toOptions(schemas)}
          value={schema || null}
          onChange={(selected) => onChange(selected.value, '')}
          createCustomValue
          placeholder="Schema"
        />
      </EditorField>
      <EditorField label="Table" width={25}>
        <Combobox
          options={toOptions(tables?.schema === schema ? tables.names : [])}
          value={table || null}
          onChange={(selected) => onChange(schema, selected.value)}
          createCustomValue
          placeholder="Table"
        />
      </EditorField>
    </>
  );
}
