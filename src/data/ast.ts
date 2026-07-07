import { From, parse, SelectFromStatement, Statement } from 'pgsql-ast-parser';

// SQL analysis via pgsql-ast-parser (CrateDB speaks the postgres dialect). Macros
// aren't valid SQL, so they're swapped for equal-length placeholders before parsing;
// offsets stay aligned with the original, which is what gets spliced (never the copy).
//
// adapted from the ClickHouse datasource (Apache-2.0),
// https://github.com/grafana/clickhouse-datasource; see NOTICE

// equal-length placeholders for ${var}, $__macro, $var; $ before a letter/underscore
// only, leaving $5 and $$ alone
function sanitizeForParse(sql: string): string {
  return sql.replace(/\$\{[\w:.]+\}|\$[a-zA-Z_]\w*/g, (match) => 'g'.padEnd(match.length, 'x'));
}

function parseSelect(sql: string): SelectFromStatement | null {
  let stm: Statement | undefined;
  try {
    stm = parse(sanitizeForParse(sql), { locationTracking: true })[0];
  } catch {
    return null;
  }
  return stm && stm.type === 'select' ? stm : null;
}

function qualify(name: { schema?: string; name: string }): string {
  return name.schema ? `${name.schema}.${name.name}` : name.name;
}

// table of the top-level FROM (descending one level into a subquery); empty when
// there's no plain table to name
export function getTable(sql: string): string {
  const from = parseSelect(sql)?.from?.[0];
  if (!from) {
    return '';
  }
  if (from.type === 'table') {
    return qualify(from.name);
  }
  if (from.type === 'statement' && from.statement.type === 'select') {
    const inner = from.statement.from?.[0];
    return inner?.type === 'table' ? qualify(inner.name) : '';
  }
  return '';
}

// splice predicate into the top-level WHERE (before GROUP BY): an existing WHERE
// becomes (orig) AND (predicate), else a fresh WHERE goes after the FROM. null when
// there's no plain SELECT/FROM to rewrite
export function injectPredicate(sql: string, predicate: string): string | null {
  const stm = parseSelect(sql);
  if (!stm?.from?.length) {
    return null;
  }
  const where = stm.where?._location;
  if (where) {
    return `${sql.slice(0, where.start)}(${sql.slice(where.start, where.end)}) AND (${predicate})${sql.slice(where.end)}`;
  }
  const fromEnd = Math.max(...stm.from.map((f: From) => f._location?.end ?? -1));
  if (fromEnd < 0) {
    return null;
  }
  return `${sql.slice(0, fromEnd)} WHERE (${predicate})${sql.slice(fromEnd)}`;
}
