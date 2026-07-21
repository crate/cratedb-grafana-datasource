import { TypedVariableModel } from '@grafana/data';

import { applyConditionalAll } from './conditionalAll';

function variable(name: string, value: string): TypedVariableModel {
  return { name, current: { value } } as unknown as TypedVariableModel;
}

describe('applyConditionalAll', () => {
  const sql = 'SELECT * FROM t WHERE $__conditionalAll(location IN ($loc), $loc)';

  it('keeps the condition for a concrete selection', () => {
    expect(applyConditionalAll(sql, [variable('loc', 'Berlin')])).toBe(
      'SELECT * FROM t WHERE location IN ($loc)'
    );
  });

  it('degrades to 1=1 when All is selected', () => {
    expect(applyConditionalAll(sql, [variable('loc', '$__all')])).toBe('SELECT * FROM t WHERE 1=1');
  });

  it('degrades to 1=1 for an empty selection', () => {
    expect(applyConditionalAll(sql, [variable('loc', '')])).toBe('SELECT * FROM t WHERE 1=1');
  });

  it('handles multiple occurrences', () => {
    const multi = 'SELECT * FROM t WHERE $__conditionalAll(a IN ($a), $a) AND $__conditionalAll(b IN ($b), $b)';
    expect(applyConditionalAll(multi, [variable('a', '$__all'), variable('b', 'x')])).toBe(
      'SELECT * FROM t WHERE 1=1 AND b IN ($b)'
    );
  });

  it('supports the ${var} form', () => {
    const braced = 'SELECT * FROM t WHERE $__conditionalAll(x IN (${x}), ${x})';
    expect(applyConditionalAll(braced, [variable('x', '$__all')])).toBe('SELECT * FROM t WHERE 1=1');
  });

  it('leaves queries without the macro untouched', () => {
    expect(applyConditionalAll('SELECT 1', [])).toBe('SELECT 1');
  });

  it('skips a malformed occurrence but still expands valid ones', () => {
    const q = 'SELECT * FROM t WHERE $__conditionalAll(a, b, $a) AND $__conditionalAll(c IN ($c), $c)';
    expect(applyConditionalAll(q, [variable('a', '$__all'), variable('c', 'x')])).toBe(
      'SELECT * FROM t WHERE $__conditionalAll(a, b, $a) AND c IN ($c)'
    );
  });

  it('degrades to 1=1 for an array-valued All selection', () => {
    const arrayVar = { name: 'loc', current: { value: ['$__all'] } } as unknown as TypedVariableModel;
    expect(applyConditionalAll(sql, [arrayVar])).toBe('SELECT * FROM t WHERE 1=1');
  });

  it('keeps a condition containing $-sequences verbatim (no replacement-pattern expansion)', () => {
    // "$'" / "$$" are special in String.replace's replacement arg; the condition
    // must be spliced literally instead
    const q = "SELECT * FROM t WHERE $__conditionalAll(x ~ '^abc$', $v) AND y = 1";
    expect(applyConditionalAll(q, [variable('v', 'Berlin')])).toBe(
      "SELECT * FROM t WHERE x ~ '^abc$' AND y = 1"
    );
  });

  it('parses arguments with a comma inside a string literal', () => {
    // the comma inside 'a,b' must not be counted as an argument separator
    const q = "SELECT * FROM t WHERE $__conditionalAll(col ~ 'a,b', $v)";
    expect(applyConditionalAll(q, [variable('v', 'Berlin')])).toBe("SELECT * FROM t WHERE col ~ 'a,b'");
    expect(applyConditionalAll(q, [variable('v', '$__all')])).toBe('SELECT * FROM t WHERE 1=1');
  });
});
