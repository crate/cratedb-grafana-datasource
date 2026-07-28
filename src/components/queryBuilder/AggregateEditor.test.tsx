import React, { useState } from 'react';

import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AggregateColumn, AggregateType, ColumnMeta } from '../../types';
import { AggregateEditor } from './AggregateEditor';

const COLUMNS: ColumnMeta[] = [{ name: 'value', type: 'double precision' }];

function Harness({ initial }: { initial: AggregateColumn[] }) {
  const [aggregates, setAggregates] = useState(initial);
  return <AggregateEditor columns={COLUMNS} value={aggregates} onChange={(next) => setAggregates(next)} />;
}

function sumWithAlias(alias: string): AggregateColumn {
  return { aggregateType: AggregateType.Sum, column: 'value', alias };
}

describe('AggregateEditor', () => {
  it('keeps each row bound to its own alias when a middle row is deleted', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[sumWithAlias('a'), sumWithAlias('b'), sumWithAlias('c')]} />);

    const before = screen.getAllByPlaceholderText('Alias') as HTMLInputElement[];
    expect(before.map((input) => input.value)).toEqual(['a', 'b', 'c']);

    await user.click(screen.getAllByRole('button', { name: 'Remove aggregation' })[1]);

    const after = screen.getAllByPlaceholderText('Alias') as HTMLInputElement[];
    expect(after.map((input) => input.value)).toEqual(['a', 'c']);
  });
});
