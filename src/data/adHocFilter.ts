import { AdHocVariableFilter } from '@grafana/data';

import { getTable, injectPredicate } from './ast';
import { escapeColumnRef, quoteLiteral } from './escape';

// injects dashboard-wide ad-hoc filters into the query's own top-level WHERE
// (constraining rows before GROUP BY), only when the query reads the table the
// filter keys came from (keys are table.column pairs)
//
// adapted from the QuestDB Grafana plugin (Apache-2.0),
// https://github.com/questdb/grafana-questdb-datasource; see NOTICE
export class AdHocFilter {
  // getTagKeys emits un-prefixed table.column keys from this schema, so an
  // un-qualified table name (in a key or in the query) resolves against it
  constructor(private defaultSchema: string) {}

  apply(sql: string, filters: AdHocVariableFilter[]): string {
    if (!sql || !filters || filters.length === 0) {
      return sql;
    }

    const queryTable = getTable(sql);
    if (!queryTable) {
      return sql;
    }
    const queryKey = this.qualify(queryTable);

    // each filter applies only to the query it was keyed for; one targeting a
    // different table (or same name, another schema) is skipped
    const conditions = filters
      .filter((f) => {
        if (!isValid(f)) {
          return false;
        }
        const filterTable = f.key.includes('.') ? f.key.split('.')[0] : '';
        if (!filterTable) {
          return false;
        }
        return this.qualify(filterTable) === queryKey;
      })
      .map((f) => `${escapeColumnRef(stripTablePrefix(f.key))} ${convertOperator(f.operator)} ${buildValue(f)}`)
      .join(' AND ');

    if (conditions === '') {
      return sql;
    }

    const injected = injectPredicate(sql.replace(/;\s*$/, ''), conditions);
    if (injected === null) {
      return sql;
    }
    return injected;
  }

  // lower-cased schema.table; an un-qualified name takes the default schema so
  // doc.nodes and sys.nodes never collide
  private qualify(table: string): string {
    const parts = table.split('.');
    const [schema, name] =
      parts.length >= 2 ? [parts[0], parts.slice(1).join('.')] : [this.defaultSchema, parts[0]];
    return `${schema.toLowerCase()}.${name.toLowerCase()}`;
  }
}

function isValid(filter: AdHocVariableFilter): boolean {
  return (
    filter.key !== undefined &&
    filter.key !== '' &&
    filter.operator !== undefined &&
    OPERATORS[filter.operator] !== undefined &&
    filter.value !== undefined
  );
}

function stripTablePrefix(key: string): string {
  return key.includes('.') ? key.split('.').slice(1).join('.') : key;
}

// always quoted as string literals: CrateDB casts to the column type, so a numeric-
// looking text value (e.g. "0755") stays a string. IN/NOT IN prefer Grafana's
// structured values array (keeps commas in values), else split the flattened string
function buildValue(filter: AdHocVariableFilter): string {
  const { operator, value, values } = filter;
  if (operator === 'IN' || operator === 'NOT IN') {
    const items =
      values && values.length > 0
        ? values
        : (value.length > 2 && value.startsWith('(') && value.endsWith(')') ? value.slice(1, -1) : value)
            .split(',')
            .map((item) => item.trim());
    return `(${items.map(quoteLiteral).join(', ')})`;
  }
  return quoteLiteral(value);
}

// allowlist: the operator is interpolated verbatim and viewers can set it (even
// via the URL), so anything off this list makes the filter invalid
const OPERATORS: Record<string, string> = {
  '=': '=',
  '!=': '!=',
  '<>': '<>',
  '<': '<',
  '<=': '<=',
  '>': '>',
  '>=': '>=',
  '=~': '~',
  '!~': '!~',
  IN: 'IN',
  'NOT IN': 'NOT IN',
};

function convertOperator(operator: string): string {
  return OPERATORS[operator];
}
