// Completion provider wiring adapted from the Redshift datasource
// (Apache-2.0), https://github.com/grafana/redshift-datasource — see NOTICE.
import {
  ColumnDefinition,
  getStandardSQLCompletionProvider,
  LanguageCompletionProvider,
  SchemaDefinition,
  TableDefinition,
  TableIdentifier,
} from '@grafana/plugin-ui';

import { MACROS } from './macros';

interface CompletionProviderGetterArgs {
  getSchemas: () => Promise<SchemaDefinition[]>;
  getTables: (schema?: string) => Promise<TableDefinition[]>;
  getColumns: (table: string, schema?: string) => Promise<ColumnDefinition[]>;
}

export const getCrateDBCompletionProvider: (args: CompletionProviderGetterArgs) => LanguageCompletionProvider =
  ({ getSchemas, getTables, getColumns }) =>
  (monaco, language) => ({
    // Standard SQL keywords, functions and macro handling.
    ...(language && getStandardSQLCompletionProvider(monaco, language)),
    triggerCharacters: ['.', ' ', '$', ',', '(', "'"],
    schemas: {
      resolve: getSchemas,
    },
    tables: {
      resolve: (t?: TableIdentifier | null) => getTables(t?.schema),
    },
    columns: {
      resolve: (t?: TableIdentifier | null) => getColumns(t?.table ?? '', t?.schema),
    },
    supportedMacros: () => MACROS,
  });
