export function escapeIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function escapeLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

// wrap a value as a quoted SQL string literal, escaping embedded quotes
export function quoteLiteral(value: unknown): string {
  return `'${escapeLiteral(String(value))}'`;
}

// keep OBJECT/ARRAY subscripts (o['a'], arr[1]) outside the quotes, else the ref
// reads as an unknown column. Only a well-formed subscript chain passes through
// (keys re-escaped); anything else is quoted whole so it stays an inert identifier.
export function escapeColumnRef(column: string): string {
  const bracket = column.indexOf('[');
  if (bracket === -1) {
    return escapeIdentifier(column);
  }
  const subscripts = escapeSubscripts(column.slice(bracket));
  if (subscripts === null) {
    return escapeIdentifier(column);
  }
  return `${escapeIdentifier(column.slice(0, bracket))}${subscripts}`;
}

// validate a chain of ['key'] / [index] subscripts and re-escape the string
// keys; returns null when the input is not exactly such a chain
function escapeSubscripts(input: string): string | null {
  let out = '';
  let i = 0;
  while (i < input.length) {
    if (input[i] !== '[') {
      return null;
    }
    const close = input.indexOf(']', i);
    if (close === -1) {
      return null;
    }
    const inner = input.slice(i + 1, close);
    if (/^\d+$/.test(inner)) {
      out += `[${inner}]`;
    } else if (inner.length >= 2 && inner.startsWith("'") && inner.endsWith("'")) {
      const key = inner.slice(1, -1);
      // an embedded quote would close the literal early — reject rather than guess
      if (key.includes("'")) {
        return null;
      }
      out += `['${escapeLiteral(key)}']`;
    } else {
      return null;
    }
    i = close + 1;
  }
  return out;
}
