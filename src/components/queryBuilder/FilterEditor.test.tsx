import React, { useState } from 'react';

import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ColumnMeta, Filter, FilterOperator } from '../../types';
import { FilterEditor } from './FilterEditor';

const COLUMNS: ColumnMeta[] = [{ name: 'city', type: 'text' }];

// parent-owned state, so the editor's value prop tracks onChange the way the
// real query builder wires it
function Harness({ initial }: { initial: Filter[] }) {
  const [filters, setFilters] = useState(initial);
  return <FilterEditor columns={COLUMNS} value={filters} onChange={(next) => setFilters(next)} />;
}

function stringFilter(value: string): Filter {
  return { column: 'city', operator: FilterOperator.Equals, value, condition: 'AND' };
}

describe('FilterEditor', () => {
  it('keeps each row bound to its own value when a middle row is deleted', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[stringFilter('x'), stringFilter('y'), stringFilter('z')]} />);

    const before = screen.getAllByPlaceholderText('Value') as HTMLInputElement[];
    expect(before.map((input) => input.value)).toEqual(['x', 'y', 'z']);

    await user.click(screen.getAllByRole('button', { name: 'Remove filter' })[1]);

    const after = screen.getAllByPlaceholderText('Value') as HTMLInputElement[];
    expect(after.map((input) => input.value)).toEqual(['x', 'z']);
  });
});
