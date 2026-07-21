import { escapeColumnRef, escapeIdentifier, escapeLiteral } from './escape';

describe('escapeIdentifier', () => {
  it('wraps in double quotes and doubles embedded quotes', () => {
    expect(escapeIdentifier('col')).toBe('"col"');
    expect(escapeIdentifier('a"b')).toBe('"a""b"');
  });
});

describe('escapeLiteral', () => {
  it('doubles single quotes', () => {
    expect(escapeLiteral("O'Brien")).toBe("O''Brien");
  });
});

describe('escapeColumnRef', () => {
  it('quotes a plain column', () => {
    expect(escapeColumnRef('temperature')).toBe('"temperature"');
  });

  it('keeps a well-formed OBJECT subscript outside the quotes', () => {
    expect(escapeColumnRef(`o['a']`)).toBe(`"o"['a']`);
    expect(escapeColumnRef(`o['a']['b']`)).toBe(`"o"['a']['b']`);
  });

  it('keeps a numeric ARRAY subscript', () => {
    expect(escapeColumnRef('arr[1]')).toBe('"arr"[1]');
  });

  it('quotes the whole ref when a subscript literal has an unescaped quote', () => {
    // an embedded (unescaped) quote would close the subscript literal early
    expect(escapeColumnRef(`o['a'b']`)).toBe(`"o['a'b']"`);
  });

  it('quotes a crafted injection key whole so it stays inert', () => {
    // the classic bracket-escape bypass must not leak a bare predicate
    const evil = `temperature['a'] = 'x') OR ('1'='1`;
    const escaped = escapeColumnRef(evil);
    expect(escaped).toBe(`"temperature['a'] = 'x') OR ('1'='1"`);
    // the whole thing is a single double-quoted identifier: exactly two quotes
    expect(escaped.match(/"/g)).toHaveLength(2);
  });

  it('rejects a subscript followed by trailing junk', () => {
    expect(escapeColumnRef(`o['a'] extra`)).toBe(`"o['a'] extra"`);
  });
});
