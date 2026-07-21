import { escapeLiteral, quoteLiteral } from './escape';

// the slice of the variable model templateSrv.replace hands to a custom formatter
interface FormatVariable {
  multi?: boolean;
  includeAll?: boolean;
}

// Default SQL formatting for dashboard variables (the format arg to
// templateSrv.replace); without it a multi-select renders as {Berlin,Vienna},
// invalid SQL. Follows the PostgreSQL datasource: multi-capable variables quote
// every value ('Berlin','Vienna'); a single value stays unquoted so it works in
// identifier positions too (quotes still escaped); numbers pass through.
export function interpolateVariable(value: unknown, variable: FormatVariable): string | number {
  if (typeof value === 'string') {
    return variable.multi || variable.includeAll ? quoteLiteral(value) : escapeLiteral(value);
  }
  if (Array.isArray(value)) {
    return value.map(quoteLiteral).join(',');
  }
  if (typeof value === 'number') {
    return value;
  }
  return String(value ?? '');
}
