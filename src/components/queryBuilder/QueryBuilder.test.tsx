import React from 'react';

import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { defaultBuilderOptions, generateSql } from '../../data/sqlGenerator';
import { CrateDBDatasource } from '../../datasource';
import { BuilderOptions, ColumnHint, QueryFormat } from '../../types';
import { QueryBuilder } from './QueryBuilder';

function makeDatasource() {
  return {
    defaultSchema: 'doc',
    fetchSchemas: jest.fn().mockResolvedValue(['doc', 'sys']),
    fetchTables: jest.fn().mockResolvedValue(['demo_metrics', 'demo_logs']),
    fetchColumnMeta: jest.fn().mockResolvedValue([
      { name: 'ts', type: 'timestamp with time zone' },
      { name: 'message', type: 'text' },
      { name: 'level', type: 'text' },
      { name: 'value', type: 'double precision' },
    ]),
  } as unknown as CrateDBDatasource;
}

function makeProps(options: Partial<BuilderOptions>) {
  return {
    datasource: makeDatasource(),
    options: { ...defaultBuilderOptions('doc'), ...options },
    onChange: jest.fn(),
  };
}

describe('QueryBuilder', () => {
  it('previews the SQL the current state generates', () => {
    const options = {
      ...defaultBuilderOptions('doc'),
      table: 'demo_metrics',
      columns: [{ column: 'ts', hint: ColumnHint.Time }],
    };
    render(<QueryBuilder {...makeProps(options)} />);

    expect(screen.getByTestId('sql-preview')).toHaveTextContent('$__timeGroupAlias("ts", $__interval)');
    expect(screen.getByTestId('sql-preview').textContent).toBe(generateSql(options));
  });

  it('explains the empty state instead of previewing SQL', () => {
    render(<QueryBuilder {...makeProps({ table: '' })} />);

    expect(screen.getByTestId('sql-preview')).toHaveTextContent(/select a table/);
  });

  it('fills the time column from table metadata when none is assigned', async () => {
    const props = makeProps({ table: 'demo_metrics', columns: [] });
    render(<QueryBuilder {...props} />);

    await waitFor(() =>
      expect(props.onChange).toHaveBeenCalledWith(
        expect.objectContaining({ columns: [{ column: 'ts', hint: ColumnHint.Time }] })
      )
    );
  });

  it('fills time, message and level for the logs flavor', async () => {
    const props = makeProps({
      ...defaultBuilderOptions('doc', QueryFormat.Logs),
      table: 'demo_logs',
    });
    render(<QueryBuilder {...props} />);

    await waitFor(() =>
      expect(props.onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          columns: [
            { column: 'ts', hint: ColumnHint.Time },
            { column: 'message', hint: ColumnHint.LogMessage },
            { column: 'level', hint: ColumnHint.LogLevel },
          ],
        })
      )
    );
  });

  it('keeps a deliberately cleared picker cleared', async () => {
    const props = makeProps({ table: 'demo_metrics', columns: [{ column: 'ts', hint: ColumnHint.Time }] });
    const { rerender } = render(<QueryBuilder {...props} />);

    // metadata is in; the user clears the time column afterwards
    await waitFor(() => expect(props.datasource.fetchColumnMeta).toHaveBeenCalled());
    rerender(<QueryBuilder {...props} options={{ ...props.options, columns: [] }} />);

    expect(props.onChange).not.toHaveBeenCalled();
  });

  it('carries table, filters and the time column across a flavor switch', async () => {
    const options: BuilderOptions = {
      ...defaultBuilderOptions('doc'),
      table: 'demo_metrics',
      columns: [{ column: 'ts', hint: ColumnHint.Time }],
      filters: [{ column: 'level', operator: '=' as never, value: 'error', condition: 'AND' }],
    };
    const props = makeProps(options);
    render(<QueryBuilder {...props} />);

    await userEvent.click(screen.getByRole('radio', { name: 'Logs' }));

    expect(props.onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        flavor: QueryFormat.Logs,
        table: 'demo_metrics',
        columns: [{ column: 'ts', hint: ColumnHint.Time }],
        filters: options.filters,
        aggregates: [],
      })
    );
  });

  it('renders the view matching the flavor', () => {
    const { rerender } = render(<QueryBuilder {...makeProps({ table: 'demo_metrics' })} />);

    // time series exposes the time column picker
    expect(screen.getByText('Time column')).toBeInTheDocument();

    rerender(<QueryBuilder {...makeProps({ ...defaultBuilderOptions('doc', QueryFormat.Logs), table: 'demo_logs' })} />);
    expect(screen.getByText('Message column')).toBeInTheDocument();

    rerender(
      <QueryBuilder {...makeProps({ ...defaultBuilderOptions('doc', QueryFormat.Table), table: 'demo_metrics' })} />
    );
    expect(screen.getByText('Mode')).toBeInTheDocument();
  });
});
