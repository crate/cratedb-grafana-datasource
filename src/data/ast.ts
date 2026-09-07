import { From, parse, SelectFromStatement, Statement } from 'pgsql-ast-parser';

// SQL analysis via pgsql-ast-parser (CrateDB speaks the postgres dialect). Macros
// aren't valid SQL, so they're swapped for equal-length placeholders before parsing;
// offsets stay aligned with the original, which is what gets spliced (never the copy).

// equal-length placeholders for ${var}, $__macro, $var; $ before a letter/underscore
// only, leaving $5 and $$ alone
function sanitizeForParse(sql: string): string {
  return sql.replace(/\$\{[\w:.]+\}|\$[a-zA-Z_]\w*/g, (match) => 'g'.padEnd(match.length, 'x'));
}

function parseStatement(sql: string): Statement | null {
  try {
    return parse(sanitizeForParse(sql), { locationTracking: true })[0] ?? null;
  } catch {
    return null;
  }
}

function parseSelect(sql: string): SelectFromStatement | null {
  const stm = parseStatement(sql);
  return stm?.type === 'select' ? stm : null;
}

function qualify(name: { schema?: string; name: string }): string {
  return name.schema ? `${name.schema}.${name.name}` : name.name;
}

// table of the top-level FROM, empty when there's no single plain table to name. A
// subquery FROM returns empty: its columns aren't reachable from an outer WHERE, so
// ad-hoc injection is skipped rather than spliced at the wrong level. A join or comma
// join also returns empty: an unqualified column would be ambiguous between relations.
export function getTable(sql: string): string {
  const from = parseSelect(sql)?.from;
  return from?.length === 1 && from[0].type === 'table' ? qualify(from[0].name) : '';
}

// splice predicate into the top-level WHERE (before GROUP BY): an existing WHERE
// becomes (orig) AND (predicate), else a fresh WHERE goes after the FROM. null when
// there's no single-table SELECT/FROM to rewrite (a join or comma join makes an
// unqualified predicate column ambiguous between relations)
export function injectPredicate(sql: string, predicate: string): string | null {
  const stm = parseSelect(sql);
  if (stm?.from?.length !== 1 || stm.from[0].type !== 'table') {
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

// every table the statement names, across union branches, derived tables and CTE
// bodies. A name bound by a WITH resolves to that CTE rather than to a table, so it
// is dropped from the result.
export function referencedTables(sql: string): string[] {
  const tables: string[] = [];
  const bound = new Set<string>();
  collectTables(parseStatement(sql), tables, bound);
  return tables.filter((table) => !bound.has(table));
}

function collectTables(stm: Statement | null | undefined, tables: string[], bound: Set<string>): void {
  switch (stm?.type) {
    case 'select':
      for (const from of stm.from ?? []) {
        if (from.type === 'table') {
          tables.push(qualify(from.name));
        } else if (from.type === 'statement') {
          collectTables(from.statement, tables, bound);
        }
      }
      return;
    case 'union':
    case 'union all':
      collectTables(stm.left, tables, bound);
      collectTables(stm.right, tables, bound);
      return;
    case 'with':
      for (const bind of stm.bind) {
        bound.add(bind.alias.name);
        collectTables(bind.statement, tables, bound);
      }
      collectTables(stm.in, tables, bound);
      return;
    case 'with recursive':
      bound.add(stm.alias.name);
      collectTables(stm.bind, tables, bound);
      collectTables(stm.in, tables, bound);
      return;
    default:
      return;
  }
}
