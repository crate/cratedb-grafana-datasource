import React from 'react';

import { Button, Combobox, ComboboxOption, IconButton, Input, Stack } from '@grafana/ui';

import { columnKind } from '../../data/columnTypes';
import { AggregateColumn, AggregateType, ColumnMeta } from '../../types';

interface Props {
  columns: ColumnMeta[];
  value: AggregateColumn[];
  onChange: (aggregates: AggregateColumn[], run?: boolean) => void;
}

const FUNCTIONS: Array<ComboboxOption<AggregateType>> = [
  { label: 'count', value: AggregateType.Count },
  { label: 'count distinct', value: AggregateType.CountDistinct },
  { label: 'sum', value: AggregateType.Sum },
  { label: 'avg', value: AggregateType.Avg },
  { label: 'min', value: AggregateType.Min },
  { label: 'max', value: AggregateType.Max },
];

export function AggregateEditor({ columns, value, onChange }: Props) {
  // count takes any column or *; the arithmetic functions want numbers, but the
  // list is a suggestion, not a gate — custom entries stay allowed
  const argOptions = (aggregateType: AggregateType): Array<ComboboxOption<string>> => {
    const numericOnly = aggregateType === AggregateType.Sum || aggregateType === AggregateType.Avg;
    const named = columns
      .filter((column) => !numericOnly || columnKind(column.type) === 'number')
      .map((column) => ({ label: column.name, value: column.name, description: column.type }));
    return aggregateType === AggregateType.Count ? [{ label: '*', value: '*' }, ...named] : named;
  };

  const update = (index: number, patch: Partial<AggregateColumn>, run = true) => {
    onChange(
      value.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)),
      run
    );
  };

  return (
    <Stack direction="column" gap={0.5}>
      {value.map((aggregate, index) => (
        <Stack key={index} gap={0.5} alignItems="center">
          <Combobox
            options={FUNCTIONS}
            value={aggregate.aggregateType}
            onChange={(selected) => {
              // '*' is an argument only count accepts; the row waits for a real
              // column instead of running with an invalid call
              const keepsColumn = aggregate.column !== '*' || selected.value === AggregateType.Count;
              update(
                index,
                { aggregateType: selected.value, ...(keepsColumn ? {} : { column: '' }) },
                keepsColumn
              );
            }}
            width={16}
          />
          <Combobox
            options={argOptions(aggregate.aggregateType)}
            value={aggregate.column || null}
            onChange={(selected) => update(index, { column: selected.value })}
            createCustomValue
            placeholder="Column"
            width={25}
          />
          <Input
            defaultValue={aggregate.alias ?? ''}
            placeholder="Alias"
            width={16}
            onBlur={(event) => update(index, { alias: event.currentTarget.value || undefined })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                update(index, { alias: event.currentTarget.value || undefined });
              }
            }}
          />
          <IconButton
            name="trash-alt"
            tooltip="Remove aggregation"
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          />
        </Stack>
      ))}
      <Stack>
        <Button
          icon="plus"
          variant="secondary"
          size="sm"
          onClick={() => onChange([...value, { aggregateType: AggregateType.Count, column: '*' }], false)}
        >
          Aggregation
        </Button>
      </Stack>
    </Stack>
  );
}
