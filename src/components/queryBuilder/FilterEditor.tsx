import React from 'react';

import { Button, Combobox, ComboboxOption, IconButton, Input, MultiCombobox, RadioButtonGroup, Stack } from '@grafana/ui';

import { columnKind } from '../../data/columnTypes';
import { ColumnKind, ColumnMeta, Filter, FilterOperator } from '../../types';
import { ColumnSelect } from './ColumnSelect';

// filter-row editor: column, operator (narrowed by the column's kind), a value
// editor matching the operator, and the AND/OR joiner with the previous row
//
// adapted from the ClickHouse datasource (Apache-2.0),
// https://github.com/grafana/clickhouse-datasource; see NOTICE

interface Props {
  columns: ColumnMeta[];
  value: Filter[];
  onChange: (filters: Filter[], run?: boolean) => void;
}

const NULL_OPERATORS = [FilterOperator.IsNull, FilterOperator.IsNotNull];
const COMPARISONS = [
  FilterOperator.Equals,
  FilterOperator.NotEquals,
  FilterOperator.LessThan,
  FilterOperator.LessThanOrEqual,
  FilterOperator.GreaterThan,
  FilterOperator.GreaterThanOrEqual,
];
const TEXT_OPERATORS = [
  FilterOperator.Equals,
  FilterOperator.NotEquals,
  FilterOperator.Like,
  FilterOperator.NotLike,
  FilterOperator.ILike,
  FilterOperator.NotILike,
  FilterOperator.In,
  FilterOperator.NotIn,
];

function operatorsFor(kind: ColumnKind | undefined): FilterOperator[] {
  switch (kind) {
    case 'time':
      return [FilterOperator.WithinTimeRange, ...COMPARISONS, ...NULL_OPERATORS];
    case 'number':
      return [...COMPARISONS, FilterOperator.In, FilterOperator.NotIn, ...NULL_OPERATORS];
    case 'boolean':
      return [FilterOperator.Equals, FilterOperator.NotEquals, ...NULL_OPERATORS];
    case 'string':
      return [...TEXT_OPERATORS, ...NULL_OPERATORS];
    default:
      return [...TEXT_OPERATORS, ...COMPARISONS, FilterOperator.WithinTimeRange, ...NULL_OPERATORS];
  }
}

const CONDITIONS = [
  { label: 'AND', value: 'AND' as const },
  { label: 'OR', value: 'OR' as const },
];

const BOOLEAN_VALUES: Array<ComboboxOption<string>> = [
  { label: 'true', value: 'true' },
  { label: 'false', value: 'false' },
];

function valueless(operator: FilterOperator): boolean {
  return NULL_OPERATORS.includes(operator) || operator === FilterOperator.WithinTimeRange;
}

function ValueEditor({
  filter,
  kind,
  onCommit,
}: {
  filter: Filter;
  kind: ColumnKind | undefined;
  onCommit: (value: string | string[]) => void;
}) {
  if (valueless(filter.operator)) {
    return null;
  }
  if (filter.operator === FilterOperator.In || filter.operator === FilterOperator.NotIn) {
    const values = Array.isArray(filter.value) ? filter.value : filter.value ? [filter.value] : [];
    return (
      <MultiCombobox
        options={values.map((entry) => ({ label: entry, value: entry }))}
        value={values}
        onChange={(picked) => onCommit(picked.map((entry) => entry.value))}
        createCustomValue
        placeholder="Values"
        width={30}
      />
    );
  }
  if (kind === 'boolean') {
    const value = Array.isArray(filter.value) ? undefined : filter.value;
    return (
      <Combobox options={BOOLEAN_VALUES} value={value ?? null} onChange={(v) => onCommit(v.value)} width={12} />
    );
  }
  const value = Array.isArray(filter.value) ? '' : (filter.value ?? '');
  return (
    <Input
      defaultValue={value}
      placeholder="Value"
      width={25}
      onBlur={(event) => onCommit(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          onCommit(event.currentTarget.value);
        }
      }}
    />
  );
}

export function FilterEditor({ columns, value, onChange }: Props) {
  const kindOf = (name: string): ColumnKind | undefined => {
    const meta = columns.find((column) => column.name === name);
    return meta ? columnKind(meta.type) : undefined;
  };

  const update = (index: number, patch: Partial<Filter>, run = true) => {
    onChange(
      value.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)),
      run
    );
  };

  // a filter that arrived without a stored kind (e.g. re-derived from SQL)
  // still gets kind-aware operators and value editing via column metadata
  const effectiveKind = (filter: Filter): ColumnKind | undefined => filter.type ?? kindOf(filter.column);

  return (
    <Stack direction="column" gap={0.5}>
      {value.map((filter, index) => (
        <Stack key={index} gap={0.5} alignItems="center">
          {index > 0 && (
            <RadioButtonGroup
              options={CONDITIONS}
              value={filter.condition}
              onChange={(condition) => update(index, { condition })}
            />
          )}
          <ColumnSelect
            columns={columns}
            kinds={['time', 'number', 'string', 'boolean']}
            value={filter.column}
            onChange={(column) =>
              // a new column resets the value; the old one rarely fits its type
              update(index, { column: column ?? '', type: kindOf(column ?? ''), value: '' }, false)
            }
          />
          <Combobox
            options={operatorsFor(effectiveKind(filter)).map((operator) => ({ label: operator, value: operator }))}
            value={filter.operator}
            onChange={(selected) =>
              update(index, { operator: selected.value, ...(valueless(selected.value) ? { value: undefined } : {}) })
            }
            width={22}
          />
          <ValueEditor filter={filter} kind={effectiveKind(filter)} onCommit={(next) => update(index, { value: next })} />
          <IconButton
            name="trash-alt"
            tooltip="Remove filter"
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          />
        </Stack>
      ))}
      <Stack>
        <Button
          icon="plus"
          variant="secondary"
          size="sm"
          onClick={() =>
            onChange([...value, { column: '', operator: FilterOperator.Equals, value: '', condition: 'AND' }], false)
          }
        >
          Filter
        </Button>
      </Stack>
    </Stack>
  );
}
