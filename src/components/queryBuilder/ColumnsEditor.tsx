import React from 'react';

import { ComboboxOption, MultiCombobox } from '@grafana/ui';

import { ColumnMeta, SelectedColumn } from '../../types';

interface Props {
  columns: ColumnMeta[];
  value: SelectedColumn[];
  onChange: (columns: SelectedColumn[]) => void;
}

// multi-column picker for the plain (unhinted) selections; existing aliases
// survive reselection, and custom values keep OBJECT subscripts reachable
export function ColumnsEditor({ columns, value, onChange }: Props) {
  const options: Array<ComboboxOption<string>> = columns.map((column) => ({
    label: column.name,
    value: column.name,
    description: column.type,
  }));
  return (
    <MultiCombobox
      options={options}
      value={value.map((column) => column.column)}
      onChange={(picked) =>
        onChange(picked.map(({ value: name }) => value.find((column) => column.column === name) ?? { column: name }))
      }
      createCustomValue
      placeholder="All columns (*)"
    />
  );
}
