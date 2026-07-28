import { parse, Expr, SelectedColumn as AstSelectedColumn, SelectFromStatement } from 'pgsql-ast-parser';

import {
  AggregateColumn,
  AggregateType,
  BuilderMode,
  BuilderOptions,
  ColumnHint,
  Filter,
  FilterOperator,
  OrderBy,
  QueryFormat,
  SelectedColumn,
} from '../types';
import { generateSql } from './sqlGenerator';

// SQL → builder state, the reverse of sqlGenerator. Macros aren't valid SQL, so
// each $__macro / $var / ${var} is swapped for a content-addressed placeholder
// identifier before parsing and mapped back afterwards (same placeholder for the
// same text, so two parses of equivalent SQL agree).
//
// Fidelity over reach: after extraction the options are regenerated and both
// sides are compared as normalized ASTs. Any construct the builder model can't
// express — joins, subqueries, expressions, CTEs, precedence the flat AND/OR
// filter list can't carry — fails that comparison and yields null instead of a
// silently lossy conversion.

const MACRO_PATTERN = /\$\{[\w:.]+\}|\$[a-zA-Z_]\w*/g;

const AGGREGATE_NAMES = new Set<string>(Object.values(AggregateType).filter((v) => v !== AggregateType.CountDistinct));

const BINARY_OPERATORS: Partial<Record<string, FilterOperator>> = {
  '=': FilterOperator.Equals,
  '!=': FilterOperator.NotEquals,
  '<': FilterOperator.LessThan,
  '<=': FilterOperator.LessThanOrEqual,
  '>': FilterOperator.GreaterThan,
  '>=': FilterOperator.GreaterThanOrEqual,
  LIKE: FilterOperator.Like,
  'NOT LIKE': FilterOperator.NotLike,
  ILIKE: FilterOperator.ILike,
  'NOT ILIKE': FilterOperator.NotILike,
};

interface MacroMap {
  restore(text: string): string;
  original(placeholder: string): string | undefined;
}

function placeholderFor(text: string): string {
  // djb2 over the macro text; placeholders are plain lowercase identifiers
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  }
  return `m${hash.toString(36)}x`;
}

function sanitize(sql: string): { sanitized: string; macros: MacroMap } {
  const byPlaceholder = new Map<string, string>();
  const sanitized = sql.replace(MACRO_PATTERN, (match) => {
    const placeholder = placeholderFor(match);
    byPlaceholder.set(placeholder, match);
    return placeholder;
  });
  return {
    sanitized,
    macros: {
      original: (placeholder) => byPlaceholder.get(placeholder),
      // placeholders can land inside string literals and quoted identifiers;
      // every extracted string is passed back through here
      restore(text: string): string {
        let out = text;
        for (const [placeholder, original] of byPlaceholder) {
          out = out.split(placeholder).join(original);
        }
        return out;
      },
    },
  };
}

function parseSelect(sanitized: string): SelectFromStatement | null {
  let statements;
  try {
    statements = parse(sanitized);
  } catch {
    return null;
  }
  if (statements.length !== 1 || statements[0].type !== 'select') {
    return null;
  }
  return statements[0];
}

// bare column reference, possibly with OBJECT/array subscripts — the shape
// escapeColumnRef reproduces
function columnRefString(expr: Expr, macros: MacroMap): string | null {
  if (expr.type === 'ref') {
    return expr.name !== '*' && !expr.table && macros.original(expr.name) === undefined
      ? macros.restore(expr.name)
      : null;
  }
  if (expr.type === 'arrayIndex') {
    const base = columnRefString(expr.array, macros);
    if (base === null) {
      return null;
    }
    if (expr.index.type === 'integer') {
      return `${base}[${expr.index.value}]`;
    }
    if (expr.index.type === 'string' && !expr.index.value.includes("'")) {
      return `${base}['${macros.restore(expr.index.value)}']`;
    }
  }
  return null;
}

// the column inside a $__timeFilter(col) call, else null
function timeFilterColumn(expr: Expr, macros: MacroMap): string | null {
  if (expr.type !== 'call' || expr.function.schema || expr.args.length !== 1) {
    return null;
  }
  if (macros.original(expr.function.name) !== '$__timeFilter') {
    return null;
  }
  return columnRefString(expr.args[0], macros);
}

function literalValue(expr: Expr, macros: MacroMap): Pick<Filter, 'value' | 'type'> | null {
  switch (expr.type) {
    case 'string':
      return { value: macros.restore(expr.value) };
    case 'integer':
    case 'numeric':
      return { value: String(expr.value), type: 'number' };
    case 'boolean':
      return { value: String(expr.value), type: 'boolean' };
    case 'ref':
      // a macro/variable placeholder passes through as a raw value
      if (!expr.table && expr.name !== '*') {
        const original = macros.original(expr.name);
        if (original !== undefined) {
          return { value: original };
        }
      }
      return null;
    default:
      return null;
  }
}

interface Leaf {
  expr: Expr;
  /** joiner with the preceding leaf; 'AND' on the first */
  condition: 'AND' | 'OR';
}

// in-order flattening of the AND/OR tree; grouping is not recorded, so any
// parenthesization beyond what the generator emits is caught by the final
// AST comparison, not here
function flattenBoolean(expr: Expr, condition: 'AND' | 'OR', out: Leaf[]): void {
  if (expr.type === 'binary' && (expr.op === 'AND' || expr.op === 'OR')) {
    flattenBoolean(expr.left, condition, out);
    flattenBoolean(expr.right, expr.op, out);
    return;
  }
  out.push({ expr, condition });
}

function leafToFilter(leaf: Leaf, macros: MacroMap): Filter | null {
  const { expr } = leaf;
  const timeColumn = timeFilterColumn(expr, macros);
  if (timeColumn !== null) {
    return { column: timeColumn, operator: FilterOperator.WithinTimeRange, condition: leaf.condition };
  }
  if (expr.type === 'unary' && (expr.op === 'IS NULL' || expr.op === 'IS NOT NULL')) {
    const column = columnRefString(expr.operand, macros);
    return column === null
      ? null
      : {
          column,
          operator: expr.op === 'IS NULL' ? FilterOperator.IsNull : FilterOperator.IsNotNull,
          condition: leaf.condition,
        };
  }
  if (expr.type !== 'binary') {
    return null;
  }
  const column = columnRefString(expr.left, macros);
  if (column === null) {
    return null;
  }
  if (expr.op === 'IN' || expr.op === 'NOT IN') {
    // a one-element IN list parses as the bare element, parens collapsed
    const items = expr.right.type === 'list' ? expr.right.expressions : [expr.right];
    const values: string[] = [];
    let type: Filter['type'];
    for (const item of items) {
      const literal = literalValue(item, macros);
      if (literal === null || Array.isArray(literal.value) || literal.value === undefined) {
        return null;
      }
      values.push(literal.value);
      type = type ?? literal.type;
    }
    return {
      column,
      operator: expr.op === 'IN' ? FilterOperator.In : FilterOperator.NotIn,
      value: values,
      type,
      condition: leaf.condition,
    };
  }
  const operator = BINARY_OPERATORS[expr.op];
  if (operator === undefined) {
    return null;
  }
  const literal = literalValue(expr.right, macros);
  if (literal === null) {
    return null;
  }
  return { column, operator, ...literal, condition: leaf.condition };
}

type Projection =
  | { kind: 'star' }
  | { kind: 'timeBucket'; column: string }
  | { kind: 'aggregate'; aggregate: AggregateColumn }
  | { kind: 'column'; column: SelectedColumn };

function classifyProjection(projection: AstSelectedColumn, macros: MacroMap): Projection | null {
  const { expr } = projection;
  const alias = projection.alias ? macros.restore(projection.alias.name) : undefined;

  if (expr.type === 'ref' && expr.name === '*' && !expr.table) {
    return alias === undefined ? { kind: 'star' } : null;
  }

  if (expr.type === 'call' && !expr.function.schema && !expr.over && !expr.filter && !expr.withinGroup && !expr.orderBy) {
    const macro = macros.original(expr.function.name);
    if (macro === '$__timeGroupAlias') {
      // the exact bucket call the generator emits: $__timeGroupAlias(col, $__interval)
      if (alias !== undefined || expr.args.length !== 2 || expr.distinct) {
        return null;
      }
      const column = columnRefString(expr.args[0], macros);
      const interval = expr.args[1];
      if (
        column === null ||
        interval.type !== 'ref' ||
        macros.original(interval.name) !== '$__interval'
      ) {
        return null;
      }
      return { kind: 'timeBucket', column };
    }
    if (macro !== undefined) {
      return null;
    }
    const name = expr.function.name;
    if (!AGGREGATE_NAMES.has(name)) {
      return null;
    }
    if (expr.args.length !== 1) {
      return null;
    }
    const arg = expr.args[0];
    const isStar = arg.type === 'ref' && arg.name === '*' && !arg.table;
    const column = isStar ? '*' : columnRefString(arg, macros);
    if (column === null) {
      return null;
    }
    if (expr.distinct === 'distinct') {
      return name === AggregateType.Count && !isStar
        ? { kind: 'aggregate', aggregate: { aggregateType: AggregateType.CountDistinct, column, alias } }
        : null;
    }
    if (isStar && name !== AggregateType.Count) {
      return null;
    }
    return { kind: 'aggregate', aggregate: { aggregateType: name as AggregateType, column, alias } };
  }

  const column = columnRefString(expr, macros);
  return column === null ? null : { kind: 'column', column: { column, alias } };
}

interface Clauses {
  schema: string;
  table: string;
  projections: Projection[];
  leaves: Leaf[];
  groupBy: Expr[];
  orderBy: Array<{ column: string; dir: 'ASC' | 'DESC'; ordinalOne: boolean }>;
  limit?: number;
}

function extractClauses(stm: SelectFromStatement, macros: MacroMap, defaultSchema: string): Clauses | null {
  if (stm.distinct || stm.having || stm.for || stm.skip || !stm.columns?.length) {
    return null;
  }
  if (stm.from?.length !== 1) {
    return null;
  }
  const from = stm.from[0];
  if (from.type !== 'table' || from.join || from.name.alias || from.name.columnNames?.length) {
    return null;
  }

  const projections: Projection[] = [];
  for (const column of stm.columns) {
    const projection = classifyProjection(column, macros);
    if (projection === null) {
      return null;
    }
    projections.push(projection);
  }

  const leaves: Leaf[] = [];
  if (stm.where) {
    flattenBoolean(stm.where, 'AND', leaves);
  }

  const orderBy: Clauses['orderBy'] = [];
  for (const entry of stm.orderBy ?? []) {
    if (entry.nulls) {
      return null;
    }
    if (entry.by.type === 'integer') {
      if (entry.by.value !== 1) {
        return null;
      }
      orderBy.push({ column: '', dir: entry.order ?? 'ASC', ordinalOne: true });
      continue;
    }
    const column = columnRefString(entry.by, macros);
    if (column === null) {
      return null;
    }
    orderBy.push({ column, dir: entry.order ?? 'ASC', ordinalOne: false });
  }

  let limit: number | undefined;
  if (stm.limit) {
    if (stm.limit.offset || !stm.limit.limit) {
      return null;
    }
    if (stm.limit.limit.type !== 'integer') {
      return null;
    }
    limit = stm.limit.limit.value;
  }

  return {
    schema: from.name.schema ? macros.restore(from.name.schema) : defaultSchema,
    table: macros.restore(from.name.name),
    projections,
    leaves,
    groupBy: stm.groupBy ?? [],
    orderBy,
    limit,
  };
}

// filters after stripping the leading implicit $__timeFilter on the given time
// column; null when the query doesn't open its WHERE with it
function timeBoundFilters(clauses: Clauses, timeColumn: string, macros: MacroMap): Filter[] | null {
  const [first, ...rest] = clauses.leaves;
  if (!first || timeFilterColumn(first.expr, macros) !== timeColumn) {
    return null;
  }
  return filtersFrom(rest, macros);
}

function filtersFrom(leaves: Leaf[], macros: MacroMap): Filter[] | null {
  const filters: Filter[] = [];
  for (const leaf of leaves) {
    const filter = leafToFilter(leaf, macros);
    if (filter === null) {
      return null;
    }
    filters.push(filter);
  }
  return filters;
}

function userOrderBy(entries: Clauses['orderBy']): OrderBy[] {
  return entries.map(({ column, dir }) => ({ column, dir }));
}

function buildOptions(clauses: Clauses, macros: MacroMap): BuilderOptions | null {
  const base = {
    schema: clauses.schema,
    table: clauses.table,
    groupBy: [] as string[],
    filters: [] as Filter[],
    orderBy: [] as OrderBy[],
    limit: clauses.limit,
  };

  const [head, ...tail] = clauses.projections;

  // time series, aggregate: the generator's bucketed shape
  if (head?.kind === 'timeBucket') {
    const aggregates: AggregateColumn[] = [];
    for (const projection of tail) {
      if (projection.kind === 'aggregate') {
        aggregates.push(projection.aggregate);
      } else if (projection.kind !== 'column' || projection.column.alias !== undefined) {
        // plain refs restate the GROUP BY columns; anything else has no slot
        return null;
      }
    }
    const [firstGroup, ...restGroup] = clauses.groupBy;
    if (!firstGroup || firstGroup.type !== 'integer' || firstGroup.value !== 1) {
      return null;
    }
    const groupBy: string[] = [];
    for (const expr of restGroup) {
      const column = columnRefString(expr, macros);
      if (column === null) {
        return null;
      }
      groupBy.push(column);
    }
    const [firstOrder, ...restOrder] = clauses.orderBy;
    if (!firstOrder?.ordinalOne || firstOrder.dir !== 'ASC' || restOrder.some((entry) => entry.ordinalOne)) {
      return null;
    }
    const filters = timeBoundFilters(clauses, head.column, macros);
    if (filters === null) {
      return null;
    }
    return {
      ...base,
      flavor: QueryFormat.Timeseries,
      mode: BuilderMode.Aggregate,
      columns: [{ column: head.column, hint: ColumnHint.Time }],
      aggregates,
      groupBy,
      filters,
      orderBy: userOrderBy(restOrder),
    };
  }

  if (clauses.orderBy.some((entry) => entry.ordinalOne)) {
    return null;
  }

  const columnProjections = clauses.projections.filter(
    (projection): projection is Extract<Projection, { kind: 'column' }> => projection.kind === 'column'
  );
  const aliased = (name: string) => columnProjections.find((projection) => projection.column.alias === name);

  // logs: time + body aliases (level optional), ordered by time descending
  const timeProjection = aliased('time');
  const bodyProjection = aliased('body');
  if (timeProjection && bodyProjection && columnProjections.length === clauses.projections.length) {
    const levelProjection = aliased('level');
    const hinted: SelectedColumn[] = [
      { column: timeProjection.column.column, hint: ColumnHint.Time },
      { column: bodyProjection.column.column, hint: ColumnHint.LogMessage },
      ...(levelProjection ? [{ column: levelProjection.column.column, hint: ColumnHint.LogLevel }] : []),
    ];
    const consumed = new Set([timeProjection, bodyProjection, ...(levelProjection ? [levelProjection] : [])]);
    const extras = columnProjections.filter((projection) => !consumed.has(projection));
    const [order, ...surplus] = clauses.orderBy;
    if (!order || order.column !== timeProjection.column.column || order.dir !== 'DESC' || surplus.length > 0) {
      return null;
    }
    const filters = timeBoundFilters(clauses, timeProjection.column.column, macros);
    if (filters === null || clauses.groupBy.length > 0) {
      return null;
    }
    return {
      ...base,
      flavor: QueryFormat.Logs,
      mode: BuilderMode.Simple,
      columns: [...hinted, ...extras.map((projection) => projection.column)],
      aggregates: [],
      filters,
    };
  }

  // time series, simple: first column aliased time, WHERE opens with its filter
  if (
    timeProjection &&
    clauses.projections[0] === timeProjection &&
    columnProjections.length === clauses.projections.length &&
    clauses.groupBy.length === 0 &&
    timeFilterColumn(clauses.leaves[0]?.expr ?? { type: 'null' }, macros) === timeProjection.column.column
  ) {
    const filters = timeBoundFilters(clauses, timeProjection.column.column, macros);
    const [order, ...restOrder] = clauses.orderBy;
    if (filters === null || !order || order.column !== timeProjection.column.column || order.dir !== 'ASC') {
      return null;
    }
    return {
      ...base,
      flavor: QueryFormat.Timeseries,
      mode: BuilderMode.Simple,
      columns: [
        { column: timeProjection.column.column, hint: ColumnHint.Time },
        ...columnProjections.filter((projection) => projection !== timeProjection).map((p) => p.column),
      ],
      aggregates: [],
      filters,
      orderBy: userOrderBy(restOrder),
    };
  }

  // table
  const filters = filtersFrom(clauses.leaves, macros);
  if (filters === null) {
    return null;
  }
  const aggregates = clauses.projections
    .filter((projection): projection is Extract<Projection, { kind: 'aggregate' }> => projection.kind === 'aggregate')
    .map((projection) => projection.aggregate);
  if (aggregates.length > 0 || clauses.groupBy.length > 0) {
    const groupBy: string[] = [];
    for (const expr of clauses.groupBy) {
      const column = columnRefString(expr, macros);
      if (column === null) {
        return null;
      }
      groupBy.push(column);
    }
    return {
      ...base,
      flavor: QueryFormat.Table,
      mode: BuilderMode.Aggregate,
      columns: [],
      aggregates,
      groupBy,
      filters,
      orderBy: userOrderBy(clauses.orderBy),
    };
  }
  if (clauses.projections.some((projection) => projection.kind === 'star') && clauses.projections.length !== 1) {
    return null;
  }
  return {
    ...base,
    flavor: QueryFormat.Table,
    mode: BuilderMode.Simple,
    columns: columnProjections.map((projection) => projection.column),
    aggregates: [],
    filters,
    orderBy: userOrderBy(clauses.orderBy),
  };
}

// normalized-AST fingerprint used for the round-trip comparison: locations and
// key order neutralized, a missing ORDER BY direction reads as ASC, and an
// unqualified FROM table takes the default schema (CrateDB resolves it there)
function fingerprint(sql: string, defaultSchema: string): string | null {
  const { sanitized } = sanitize(sql);
  const stm = parseSelect(sanitized);
  if (stm === null) {
    return null;
  }
  const from = stm.from?.[0];
  if (from?.type === 'table' && !from.name.schema) {
    from.name.schema = defaultSchema;
  }
  return JSON.stringify(strip(stm));
}

function strip(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(strip);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    if (key === '_location' || record[key] === undefined) {
      continue;
    }
    out[key] = strip(record[key]);
  }
  if ('by' in out && !('order' in out)) {
    out.order = 'ASC';
  }
  return out;
}

/**
 * Interprets SQL as builder state. Succeeds only when the conversion is
 * faithful — regenerating SQL from the result parses back to the same
 * normalized AST as the input — and returns null otherwise.
 */
export function parseSqlToBuilderOptions(rawSql: string, defaultSchema: string): BuilderOptions | null {
  if (!rawSql.trim()) {
    return null;
  }
  const { sanitized, macros } = sanitize(rawSql);
  const stm = parseSelect(sanitized);
  if (stm === null) {
    return null;
  }
  const clauses = extractClauses(stm, macros, defaultSchema);
  if (clauses === null) {
    return null;
  }
  const options = buildOptions(clauses, macros);
  if (options === null) {
    return null;
  }
  const regenerated = generateSql(options);
  if (!regenerated) {
    return null;
  }
  const original = fingerprint(rawSql, defaultSchema);
  const roundTrip = fingerprint(regenerated, defaultSchema);
  return original !== null && original === roundTrip ? options : null;
}
