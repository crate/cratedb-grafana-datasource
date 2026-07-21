import { findMacroAtPosition, registerMacroHover } from './macroHover';

describe('findMacroAtPosition', () => {
  const line = 'SELECT $__timeGroupAlias(ts, $__interval), v FROM t';
  // columns are 1-based: $__timeGroupAlias spans 8..25, $__interval spans 30..41

  it('finds the macro under the pointer', () => {
    const found = findMacroAtPosition(line, 10);
    expect(found?.macro.text).toBe('$__timeGroupAlias');
    expect(found?.startColumn).toBe(8);
    expect(found?.endColumn).toBe(25);
  });

  it('distinguishes adjacent macros on one line', () => {
    expect(findMacroAtPosition(line, 32)?.macro.text).toBe('$__interval');
  });

  it('hits at both edges of the macro', () => {
    expect(findMacroAtPosition(line, 8)?.macro.text).toBe('$__timeGroupAlias');
    expect(findMacroAtPosition(line, 25)?.macro.text).toBe('$__timeGroupAlias');
  });

  it('misses outside any macro', () => {
    expect(findMacroAtPosition(line, 3)).toBeUndefined();
    expect(findMacroAtPosition(line, 45)).toBeUndefined();
    expect(findMacroAtPosition('SELECT 1', 4)).toBeUndefined();
  });

  it('ignores unknown $__ tokens', () => {
    expect(findMacroAtPosition('SELECT $__nope(x)', 10)).toBeUndefined();
  });
});

describe('registerMacroHover', () => {
  function makeLanguages() {
    const dispose = jest.fn();
    const registerHoverProvider = jest.fn().mockReturnValue({ dispose });
    return { languages: { registerHoverProvider }, dispose };
  }

  it('registers once per language id until disposed', () => {
    const { languages } = makeLanguages();

    const first = registerMacroHover(languages, 'sql-abc');
    expect(registerMacroHover(languages, 'sql-abc')).toBeUndefined();
    expect(languages.registerHoverProvider).toHaveBeenCalledTimes(1);

    first?.dispose();
    expect(registerMacroHover(languages, 'sql-abc')).toBeDefined();
  });

  it('returns a doc hover for a macro position and null elsewhere', () => {
    const { languages } = makeLanguages();
    registerMacroHover(languages, 'sql-hover');
    const provider = languages.registerHoverProvider.mock.calls[0][1];
    const model = { getLineContent: () => 'WHERE $__timeFilter(ts)' };

    const hover = provider.provideHover(model, { lineNumber: 1, column: 9 });
    expect(hover.contents[0].value).toContain('$__timeFilter');
    expect(hover.contents[1].value).toContain('prune partitions');
    expect(hover.range).toEqual({ startLineNumber: 1, endLineNumber: 1, startColumn: 7, endColumn: 20 });

    expect(provider.provideHover(model, { lineNumber: 1, column: 2 })).toBeNull();
  });
});
