import React, { useState } from 'react';

import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CommitOnBlurInput } from './CommitOnBlurInput';

function Harness({ onCommit }: { onCommit: (value: string, run: boolean) => void }) {
  const [value, setValue] = useState('');
  return (
    <CommitOnBlurInput
      value={value}
      placeholder="Alias"
      onCommit={(next, run) => {
        setValue(next);
        onCommit(next, run);
      }}
    />
  );
}

describe('CommitOnBlurInput', () => {
  it('reports every keystroke without asking for a run', async () => {
    const user = userEvent.setup();
    const onCommit = jest.fn();
    render(<Harness onCommit={onCommit} />);

    await user.type(screen.getByPlaceholderText('Alias'), 'ab');

    expect(onCommit.mock.calls).toEqual([
      ['a', false],
      ['ab', false],
    ]);
  });

  it('asks for a run when the field loses focus', async () => {
    const user = userEvent.setup();
    const onCommit = jest.fn();
    render(<Harness onCommit={onCommit} />);

    await user.type(screen.getByPlaceholderText('Alias'), 'x');
    await user.tab();

    expect(onCommit).toHaveBeenLastCalledWith('x', true);
  });

  it('asks for a run when Enter is pressed', async () => {
    const user = userEvent.setup();
    const onCommit = jest.fn();
    render(<Harness onCommit={onCommit} />);

    await user.type(screen.getByPlaceholderText('Alias'), 'x{Enter}');

    expect(onCommit).toHaveBeenLastCalledWith('x', true);
  });
});
