// completion provider wiring adapted from the Redshift datasource
// (Apache-2.0), https://github.com/grafana/redshift-datasource; see NOTICE
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

interface RangeLike {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

interface ModelLike {
  getValueInRange: (range: RangeLike) => string;
}

interface PositionLike {
  lineNumber: number;
  column: number;
}

interface SuggestionLike {
  range?: unknown;
}

type ProvideCompletionItems = (
  model: ModelLike,
  position: PositionLike,
  ...rest: unknown[]
) => { suggestions?: SuggestionLike[] } | null | undefined | Promise<{ suggestions?: SuggestionLike[] } | null | undefined>;

interface CompletionProviderLike {
  provideCompletionItems?: ProvideCompletionItems;
}

interface LanguagesRegistryLike {
  registerCompletionItemProvider: (languageId: string, provider: CompletionProviderLike) => unknown;
}

// The SQL tokenizer lexes a word typed flush against a macro (`and$__timeFilter`)
// as one token, which plugin-ui uses as the replace range — so accepting `AND`
// would swallow the macro. When a `$…` follows the cursor inside the range, clamp
// the range to the cursor so the keyword replaces only what was typed.
export function clampRangeBeforeMacro<T extends SuggestionLike>(model: ModelLike, position: PositionLike, item: T): T {
  const range = item.range;
  if (typeof range !== 'object' || range === null || !('startColumn' in range)) {
    return item;
  }
  const r = range as RangeLike;
  const sameLine = r.startLineNumber === position.lineNumber && r.endLineNumber === position.lineNumber;
  if (!sameLine || r.startColumn >= position.column || r.endColumn <= position.column) {
    return item;
  }
  const tail = model.getValueInRange({ ...r, startColumn: position.column });
  if (!tail.startsWith('$')) {
    return item;
  }
  return { ...item, range: { ...r, endColumn: position.column } };
}

// The range must be fixed at suggestion-creation time (Monaco captures it then,
// so resolve-time hooks can't). plugin-ui builds its own provideCompletionItems
// but registers it synchronously right after the factory below runs — so intercept
// exactly that one registration and wrap it.
export function interceptNextCompletionRegistration(languages: LanguagesRegistryLike) {
  const original = languages.registerCompletionItemProvider;
  const patched: LanguagesRegistryLike['registerCompletionItemProvider'] = function (languageId, provider) {
    languages.registerCompletionItemProvider = original;
    const provide = provider.provideCompletionItems?.bind(provider);
    if (!provide) {
      return original.call(languages, languageId, provider);
    }
    return original.call(languages, languageId, {
      ...provider,
      provideCompletionItems: async (model, position, ...rest) => {
        const result = await provide(model, position, ...rest);
        if (result?.suggestions) {
          result.suggestions = result.suggestions.map((s) => clampRangeBeforeMacro(model, position, s));
        }
        return result;
      },
    });
  };
  languages.registerCompletionItemProvider = patched;
  // registration is expected synchronously; if it never fires, revert so the
  // patch can't later wrap an unrelated provider
  queueMicrotask(() => {
    if (languages.registerCompletionItemProvider === patched) {
      languages.registerCompletionItemProvider = original;
    }
  });
}

export const getCrateDBCompletionProvider: (args: CompletionProviderGetterArgs) => LanguageCompletionProvider =
  ({ getSchemas, getTables, getColumns }) =>
  (monaco, language) => {
    interceptNextCompletionRegistration(monaco.languages as unknown as LanguagesRegistryLike);
    return {
      // standard SQL keywords/functions from plugin-ui
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
    };
  };
