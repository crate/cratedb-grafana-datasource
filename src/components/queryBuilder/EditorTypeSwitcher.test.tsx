import React from 'react';

import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { defaultBuilderOptions, generateSql } from '../../data/sqlGenerator';
import { CrateDBDatasource } from '../../datasource';
import { BuilderOptions, ColumnHint, CrateDBQuery, EditorType, QueryFormat } from '../../types';
import { EditorTypeSwitcher } from './EditorTypeSwitcher';

const datasource = { defaultSchema: 'doc' } as unknown as CrateDBDatasource;

function builderState(): BuilderOptions {
  return {
    ...defaultBuilderOptions('doc'),
    table: 'demo_metrics',
    columns: [{ column: 'ts', hint: ColumnHint.Time }],
  };
}

function makeProps(query: Partial<CrateDBQuery>) {
  return {
    datasource,
    query: { refId: 'A', rawSql: '', format: QueryFormat.Table, ...query } as CrateDBQuery,
    onChange: jest.fn(),
    onRunQuery: jest.fn(),
  };
}

describe('EditorTypeSwitcher', () => {
  it('shows a query without editorType as SQL', () => {
    render(<EditorTypeSwitcher {...makeProps({ rawSql: 'SELECT 1' })} />);

    expect(screen.getByRole('radio', { name: 'SQL' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Builder' })).not.toBeChecked();
  });

  it('hands generated SQL over and stashes the builder state on switch to SQL', async () => {
    const options = builderState();
    const props = makeProps({
      editorType: EditorType.Builder,
      builderOptions: options,
      rawSql: generateSql(options),
      format: QueryFormat.Timeseries,
    });
    render(<EditorTypeSwitcher {...props} />);

    await userEvent.click(screen.getByRole('radio', { name: 'SQL' }));

    expect(props.onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        editorType: EditorType.SQL,
        selectedFormat: QueryFormat.Timeseries,
        meta: { builderOptions: options },
      })
    );
    expect(props.onChange.mock.calls[0][0].builderOptions).toBeUndefined();
  });

  it('restores the stash silently when the SQL is untouched', async () => {
    const options = builderState();
    const props = makeProps({
      editorType: EditorType.SQL,
      rawSql: generateSql(options),
      meta: { builderOptions: options },
    });
    render(<EditorTypeSwitcher {...props} />);

    await userEvent.click(screen.getByRole('radio', { name: 'Builder' }));

    expect(props.onChange).toHaveBeenCalledWith(
      expect.objectContaining({ editorType: EditorType.Builder, builderOptions: options })
    );
    expect(props.onRunQuery).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('converts hand-written SQL through the parser without asking', async () => {
    const props = makeProps({ rawSql: `SELECT host FROM demo_metrics WHERE region = 'eu'` });
    render(<EditorTypeSwitcher {...props} />);

    await userEvent.click(screen.getByRole('radio', { name: 'Builder' }));

    expect(props.onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        editorType: EditorType.Builder,
        builderOptions: expect.objectContaining({ schema: 'doc', table: 'demo_metrics' }),
      })
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('asks before replacing SQL the builder cannot represent, restoring the stash on confirm', async () => {
    const options = builderState();
    const props = makeProps({
      editorType: EditorType.SQL,
      rawSql: 'SELECT a FROM t JOIN u ON t.id = u.id',
      meta: { builderOptions: options },
    });
    render(<EditorTypeSwitcher {...props} />);

    await userEvent.click(screen.getByRole('radio', { name: 'Builder' }));
    expect(props.onChange).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Switch' }));
    expect(props.onChange).toHaveBeenCalledWith(
      expect.objectContaining({ editorType: EditorType.Builder, builderOptions: options })
    );
  });

  it('keeps the SQL when the replace dialog is dismissed', async () => {
    const props = makeProps({ rawSql: 'SELECT a FROM t JOIN u ON t.id = u.id' });
    render(<EditorTypeSwitcher {...props} />);

    await userEvent.click(screen.getByRole('radio', { name: 'Builder' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(props.onChange).not.toHaveBeenCalled();
  });

  it('starts a fresh builder for unconvertible SQL without a stash, keeping the format', async () => {
    const props = makeProps({ rawSql: 'SELECT a FROM t JOIN u ON t.id = u.id', format: QueryFormat.Logs });
    render(<EditorTypeSwitcher {...props} />);

    await userEvent.click(screen.getByRole('radio', { name: 'Builder' }));
    await userEvent.click(screen.getByRole('button', { name: 'Switch' }));

    expect(props.onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        editorType: EditorType.Builder,
        builderOptions: expect.objectContaining({ schema: 'doc', flavor: QueryFormat.Logs }),
      })
    );
    // nothing runnable yet — no table picked
    expect(props.onRunQuery).not.toHaveBeenCalled();
  });

  it('switches an empty query silently', async () => {
    const props = makeProps({ rawSql: '' });
    render(<EditorTypeSwitcher {...props} />);

    await userEvent.click(screen.getByRole('radio', { name: 'Builder' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(props.onChange).toHaveBeenCalledWith(expect.objectContaining({ editorType: EditorType.Builder }));
    expect(props.onRunQuery).not.toHaveBeenCalled();
  });
});
