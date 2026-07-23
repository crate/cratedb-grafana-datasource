import { QueryFormat } from '../types';

// Detects the Auto query format. Default is table; time series when the first
// projection is aliased "time" (or a group macro that expands to it) plus at least
// one more column; logs when a `body` column accompanies a `time` column. Logs is
// checked first, since a logs query also aliases its timestamp "time".
//
// A string scan, not pgsql-ast-parser: raw Grafana macros aren't valid SQL.

const TIME_ALIAS = /\bas\s+(?:"time"|time)\s*$/i;
// `body` identifies the logs frame; `level` is optional, so it plays no part
const BODY_ALIAS = /\bas\s+(?:"body"|body)\s*$/i;
// macros that expand to `... AS "time"` backend-side
const TIME_ALIAS_MACROS = /\$__(?:timeGroupAlias|unixEpochGroupAlias)\s*\(/i;
// a bare $__timeGroup(...) projection; the trailing-comma shorthand aliases it
// backend-side. Args allow one level of nested parens (e.g. date_trunc(...)).
const BARE_TIME_GROUP = /^\$__timeGroup\s*\((?:[^()]|\([^()]*\))*\)$/i;
// query plans render as rows of text, never as a time series
const EXPLAIN = /^\s*explain\b/i;

export function detectFormat(
  rawSql: string | undefined
): QueryFormat.Timeseries | QueryFormat.Table | QueryFormat.Logs {
  const stripped = stripComments(rawSql ?? '');
  if (EXPLAIN.test(stripped)) {
    return QueryFormat.Table;
  }
  const projections = selectProjections(stripped);
  if (projections.some((p) => BODY_ALIAS.test(p)) && projections.some((p) => TIME_ALIAS.test(p))) {
    return QueryFormat.Logs;
  }
  if (projections.length >= 2) {
    const first = projections[0];
    if (TIME_ALIAS.test(first) || TIME_ALIAS_MACROS.test(first) || BARE_TIME_GROUP.test(first)) {
      return QueryFormat.Timeseries;
    }
  }
  return QueryFormat.Table;
}

export function stripComments(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') {
        i++;
      }
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      // PostgreSQL block comments nest
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      out += ' ';
      continue;
    }
    if (ch === "'" || ch === '"') {
      // copy quoted content verbatim so it can't be mistaken for a comment opener
      const end = skipQuoted(sql, i);
      out += sql.slice(i, end);
      i = end;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** returns the index just past the closing quote (doubled quotes escape) */
function skipQuoted(sql: string, start: number): number {
  const quote = sql[start];
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === quote) {
      if (sql[i + 1] === quote) {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i++;
  }
  return i;
}

function isWordChar(ch: string | undefined): boolean {
  return !!ch && /[\w$]/.test(ch);
}

/**
 * Projection list of the first top-level SELECT, split on commas outside parens
 * and quotes. Subquery SELECT/FROM/commas sit at depth > 0, so they stay intact.
 */
function selectProjections(sql: string): string[] {
  const lower = sql.toLowerCase();
  const projections: string[] = [];
  let current = '';
  let depth = 0;
  let selecting = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" || ch === '"') {
      const end = skipQuoted(sql, i);
      if (selecting) {
        current += sql.slice(i, end);
      }
      i = end - 1;
      continue;
    }
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
    }

    if (depth === 0 && !isWordChar(sql[i - 1])) {
      if (!selecting && lower.startsWith('select', i) && !isWordChar(sql[i + 6])) {
        selecting = true;
        i += 5;
        continue;
      }
      if (selecting && lower.startsWith('from', i) && !isWordChar(sql[i + 4])) {
        break;
      }
    }
    if (!selecting) {
      continue;
    }
    if (ch === ',' && depth === 0) {
      projections.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) {
    projections.push(current.trim());
  }
  return selecting ? projections : [];
}
