import { MACROS } from './macros';

// Hover docs for macros. plugin-ui's LanguageDefinition carries no hover hook, but
// SQLEditor mints a unique language id per editor, so a hover provider registers
// against that id on the global monaco object.

interface MacroMatch {
  macro: (typeof MACROS)[number];
  startColumn: number;
  endColumn: number;
}

// Monaco's word detection stops at '$', so scan the line manually. Columns are
// 1-based, end-exclusive; the end boundary counts as inside for forgiving hovering.
export function findMacroAtPosition(lineContent: string, column: number): MacroMatch | undefined {
  for (const match of lineContent.matchAll(/\$__\w+/g)) {
    const startColumn = (match.index ?? 0) + 1;
    const endColumn = startColumn + match[0].length;
    if (column >= startColumn && column <= endColumn) {
      const macro = MACROS.find((m) => m.text === match[0]);
      return macro ? { macro, startColumn, endColumn } : undefined;
    }
  }
  return undefined;
}

interface TextModelLike {
  getLineContent: (lineNumber: number) => string;
}

interface HoverPosition {
  lineNumber: number;
  column: number;
}

export interface MonacoLanguagesLike {
  registerHoverProvider: (
    languageId: string,
    provider: { provideHover: (model: TextModelLike, position: HoverPosition) => unknown }
  ) => { dispose: () => void };
}

// one registration per language id (each SQLEditor instance has its own)
const registered = new Set<string>();

export function registerMacroHover(
  languages: MonacoLanguagesLike,
  languageId: string
): { dispose: () => void } | undefined {
  if (registered.has(languageId)) {
    return undefined;
  }
  registered.add(languageId);
  const provider = languages.registerHoverProvider(languageId, {
    provideHover: (model, position) => {
      const found = findMacroAtPosition(model.getLineContent(position.lineNumber), position.column);
      if (!found) {
        return null;
      }
      return {
        range: {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: found.startColumn,
          endColumn: found.endColumn,
        },
        contents: [{ value: '`' + found.macro.name + '`' }, { value: found.macro.description }],
      };
    },
  });
  return {
    dispose: () => {
      registered.delete(languageId);
      provider.dispose();
    },
  };
}
