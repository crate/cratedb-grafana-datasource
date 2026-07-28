import React from 'react';

import { Button, IconButton, RadioButtonGroup, Stack } from '@grafana/ui';

import { ColumnMeta, OrderBy } from '../../types';
import { ColumnSelect } from './ColumnSelect';

interface Props {
  columns: ColumnMeta[];
  value: OrderBy[];
  onChange: (orderBy: OrderBy[], run?: boolean) => void;
}

const DIRECTIONS = [
  { label: 'ASC', value: 'ASC' as const },
  { label: 'DESC', value: 'DESC' as const },
];

export function OrderByEditor({ columns, value, onChange }: Props) {
  const update = (index: number, patch: Partial<OrderBy>) => {
    onChange(value.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
  };

  return (
    <Stack direction="column" gap={0.5}>
      {value.map((entry, index) => (
        <Stack key={index} gap={0.5} alignItems="center">
          <ColumnSelect
            columns={columns}
            value={entry.column}
            onChange={(column) => update(index, { column: column ?? '' })}
          />
          <RadioButtonGroup options={DIRECTIONS} value={entry.dir} onChange={(dir) => update(index, { dir })} />
          <IconButton
            name="trash-alt"
            tooltip="Remove order"
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          />
        </Stack>
      ))}
      <Stack>
        <Button
          icon="plus"
          variant="secondary"
          size="sm"
          onClick={() => onChange([...value, { column: columns[0]?.name ?? '', dir: 'ASC' }], false)}
        >
          Order by
        </Button>
      </Stack>
    </Stack>
  );
}
