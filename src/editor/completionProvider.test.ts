import { clampRangeBeforeMacro, getCrateDBCompletionProvider, interceptNextCompletionRegistration } from './completionProvider';
import { MACROS } from './macros';

// `WHERE location = 'Berlin' and$__timeFilter("ts")` — the tokenizer lexes
// `and$__timeFilter` as one token (cols 27–43); the cursor sits after `and`.
const LINE = `WHERE location = 'Berlin' and$__timeFilter("ts")`;

const model = {
  getValueInRange: (r: { startColumn: number; endColumn: number }) => LINE.slice(r.startColumn - 1, r.endColumn - 1),
};
const at = (column: number) => ({ lineNumber: 5, column });
const tokenRange = { startLineNumber: 5, startColumn: 27, endLineNumber: 5, endColumn: 43 };

describe('clampRangeBeforeMacro', () => {
  it('clamps the replace range at the cursor when a macro follows it', () => {
    const item = { insertText: 'AND ', range: tokenRange };
    expect(clampRangeBeforeMacro(model, at(30), item).range).toEqual({ ...tokenRange, endColumn: 30 });
  });

  it('leaves the range alone when plain text follows the cursor', () => {
    // cursor inside the macro name: `and$__tim|eFilter` — tail is not a `$…`
    const item = { insertText: 'AND ', range: tokenRange };
    expect(clampRangeBeforeMacro(model, at(37), item)).toBe(item);
  });

  it('leaves the range alone when the cursor sits at the range end', () => {
    const item = { insertText: 'AND ', range: { ...tokenRange, endColumn: 30 } };
    expect(clampRangeBeforeMacro(model, at(30), item)).toBe(item);
  });

  it('passes items without a usable range through', () => {
    const item = { insertText: 'AND ', range: undefined };
    expect(clampRangeBeforeMacro(model, at(30), item)).toBe(item);
  });
});

describe('interceptNextCompletionRegistration', () => {
  it('wraps only the next registration and restores the original', async () => {
    const registered: Array<{ languageId: string; provider: { provideCompletionItems?: unknown } }> = [];
    const languages = {
      registerCompletionItemProvider: (languageId: string, provider: { provideCompletionItems?: unknown }) => {
        registered.push({ languageId, provider });
        return { dispose: () => {} };
      },
    };
    const original = languages.registerCompletionItemProvider;

    interceptNextCompletionRegistration(languages);
    languages.registerCompletionItemProvider('sql-1', {
      provideCompletionItems: async () => ({ suggestions: [{ insertText: 'AND ', range: tokenRange }] }),
    });

    // restored: a later registration is untouched
    expect(languages.registerCompletionItemProvider).toBe(original);

    const wrapped = registered[0].provider.provideCompletionItems as (
      m: typeof model,
      p: { lineNumber: number; column: number }
    ) => Promise<{ suggestions: Array<{ range?: unknown }> }>;
    const result = await wrapped(model, at(30));
    expect(result.suggestions[0].range).toEqual({ ...tokenRange, endColumn: 30 });
  });
});

describe('getCrateDBCompletionProvider', () => {
  const makeMonaco = () => ({
    languages: { registerCompletionItemProvider: jest.fn() },
    editor: { getEditors: () => [] },
  });

  it('wires schema/table/column resolvers to the datasource fetchers and exposes the macros', async () => {
    const getSchemas = jest.fn().mockResolvedValue([{ name: 'doc' }]);
    const getTables = jest.fn().mockResolvedValue([{ name: 't' }]);
    const getColumns = jest.fn().mockResolvedValue([{ name: 'c' }]);

    // language undefined skips the standard-SQL provider spread; we only assert our wiring
    const provider = getCrateDBCompletionProvider({ getSchemas, getTables, getColumns })(
      makeMonaco() as never,
      undefined as never
    );

    await provider.schemas!.resolve!();
    expect(getSchemas).toHaveBeenCalled();

    await provider.tables!.resolve!({ schema: 'sys' });
    expect(getTables).toHaveBeenCalledWith('sys');

    await provider.columns!.resolve!({ schema: 'doc', table: 't' });
    expect(getColumns).toHaveBeenCalledWith('t', 'doc');

    expect(provider.supportedMacros!()).toBe(MACROS);
    expect(provider.triggerCharacters).toContain('.');
  });
});
