import React from 'react';

import { Combobox, ComboboxOption } from '@grafana/ui';

import { columnKind } from '../../data/columnTypes';
import { ColumnKind, ColumnMeta } from '../../types';

interface Props {
  columns: ColumnMeta[];
  value?: string;
  onChange: (column: string | undefined) => void;
  /** restrict the options to these kinds; custom values stay allowed */
  kinds?: ColumnKind[];
  placeholder?: string;
  width?: number;
}

// single-column picker; custom values are allowed everywhere so OBJECT
// subscripts (tags['source']) and columns missing from metadata stay reachable
export function ColumnSelect({ columns, value, onChange, kinds, placeholder, width }: Props) {
  const options: Array<ComboboxOption<string>> = columns
    .filter((column) => !kinds || kinds.includes(columnKind(column.type)))
    .map((column) => ({ label: column.name, value: column.name, description: column.type }));
  return (
    <Combobox
      options={options}
      value={value ?? null}
      onChange={(selected) => onChange(selected?.value)}
      createCustomValue
      isClearable
      placeholder={placeholder ?? 'Column'}
      width={width ?? 25}
    />
  );
}
