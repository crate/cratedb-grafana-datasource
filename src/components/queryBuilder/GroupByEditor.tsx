import React from 'react';

import { ComboboxOption, MultiCombobox } from '@grafana/ui';

import { columnKind } from '../../data/columnTypes';
import { ColumnMeta } from '../../types';

interface Props {
  columns: ColumnMeta[];
  value: string[];
  onChange: (groupBy: string[]) => void;
}

export function GroupByEditor({ columns, value, onChange }: Props) {
  // grouping on containers has no meaning; anything else is fair game
  const options: Array<ComboboxOption<string>> = columns
    .filter((column) => columnKind(column.type) !== 'other')
    .map((column) => ({ label: column.name, value: column.name, description: column.type }));
  return (
    <MultiCombobox
      options={options}
      value={value}
      onChange={(picked) => onChange(picked.map((entry) => entry.value))}
      createCustomValue
      placeholder="(none)"
    />
  );
}
