import React from 'react';

import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CrateDBDatasource } from '../datasource';
import * as completionData from '../editor/useCompletionData';
import { CrateDBQuery, QueryFormat } from '../types';
import { QueryEditor } from './QueryEditor';

// re-export as a plain writable object so single tests can spy on the hook;
// __esModule keeps the namespace import identical to what the component sees
jest.mock('../editor/useCompletionData', () => ({
  __esModule: true,
  ...jest.requireActual('../editor/useCompletionData'),
}));

// Monaco does not run under jsdom; a textarea is enough to drive onChange.
// Ctrl/Cmd+Enter mirrors SQLEditor's binding: onChange with processQuery=true.
jest.mock('@grafana/plugin-ui', () => ({
  ...jest.requireActual('@grafana/plugin-ui'),
  SQLEditor: ({ query, onChange }: { query: string; onChange: (sql: string, processQuery?: boolean) => void }) => (
    <textarea
      data-testid="sql-editor"
      value={query}
      onChange={(e) => onChange(e.currentTarget.value)}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          onChange(e.currentTarget.value, true);
        }
      }}
    />
  ),
}));

function makeProps(query: Partial<CrateDBQuery>) {
  const datasource = {
    defaultSchema: 'doc',
    fetchSchemas: jest.fn().mockResolvedValue([]),
    fetchTables: jest.fn().mockResolvedValue([]),
    fetchColumns: jest.fn().mockResolvedValue([]),
  } as unknown as CrateDBDatasource;
  return {
    datasource,
    query: { refId: 'A', rawSql: '', format: QueryFormat.Timeseries, ...query } as CrateDBQuery,
    onChange: jest.fn(),
    onRunQuery: jest.fn(),
  };
}

describe('QueryEditor format selection', () => {
  it('editing SQL re-resolves the format while Auto is selected', () => {
    const props = makeProps({
      rawSql: 'SELECT ts AS time, v FROM t',
      selectedFormat: QueryFormat.Auto,
      format: QueryFormat.Timeseries,
    });
    render(<QueryEditor {...props} />);

    fireEvent.change(screen.getByTestId('sql-editor'), { target: { value: 'SELECT * FROM t' } });

    expect(props.onChange).toHaveBeenCalledWith(
      expect.objectContaining({ rawSql: 'SELECT * FROM t', format: QueryFormat.Table })
    );
  });

  it('editing SQL keeps an explicitly chosen format', () => {
    const props = makeProps({ rawSql: 'SELECT * FROM t', format: QueryFormat.Table });
    render(<QueryEditor {...props} />);

    fireEvent.change(screen.getByTestId('sql-editor'), { target: { value: 'SELECT ts AS time, v FROM t' } });

    expect(props.onChange).toHaveBeenCalledWith(expect.objectContaining({ format: QueryFormat.Table }));
  });

  it('picking Auto resolves the format from the current SQL', async () => {
    const props = makeProps({ rawSql: 'SELECT * FROM t', format: QueryFormat.Timeseries });
    render(<QueryEditor {...props} />);

    await userEvent.click(screen.getByRole('radio', { name: 'Auto' }));

    expect(props.onChange).toHaveBeenCalledWith(
      expect.objectContaining({ selectedFormat: QueryFormat.Auto, format: QueryFormat.Table })
    );
    expect(props.onRunQuery).toHaveBeenCalled();
  });

  it('picking an explicit format stores it in both fields', async () => {
    const props = makeProps({ rawSql: 'SELECT * FROM t', selectedFormat: QueryFormat.Auto });
    render(<QueryEditor {...props} />);

    await userEvent.click(screen.getByRole('radio', { name: 'Logs' }));

    expect(props.onChange).toHaveBeenCalledWith(
      expect.objectContaining({ selectedFormat: QueryFormat.Logs, format: QueryFormat.Logs })
    );
  });

  it('shows the explicit format when no picker choice is stored', () => {
    const props = makeProps({ rawSql: 'SELECT * FROM t', format: QueryFormat.Table });
    render(<QueryEditor {...props} />);

    expect(screen.getByRole('radio', { name: 'Table' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Auto' })).not.toBeChecked();
  });

  it('shows what Auto resolves to next to the picker', () => {
    const props = makeProps({
      rawSql: 'SELECT ts AS time, v FROM t',
      selectedFormat: QueryFormat.Auto,
      format: QueryFormat.Timeseries,
    });
    render(<QueryEditor {...props} />);

    expect(screen.getByTestId('resolved-format')).toHaveTextContent('Time series');
  });

  it('resolved-format indicator follows the SQL', () => {
    const props = makeProps({
      rawSql: 'SELECT * FROM t',
      selectedFormat: QueryFormat.Auto,
      format: QueryFormat.Table,
    });
    render(<QueryEditor {...props} />);

    expect(screen.getByTestId('resolved-format')).toHaveTextContent('Table');
  });

  it('hides the resolved-format indicator for explicit formats', () => {
    const props = makeProps({ rawSql: 'SELECT * FROM t', format: QueryFormat.Table });
    render(<QueryEditor {...props} />);

    expect(screen.queryByTestId('resolved-format')).not.toBeInTheDocument();
  });
});

describe('QueryEditor run shortcut', () => {
  it('runs the query when the editor reports processQuery', () => {
    const props = makeProps({ rawSql: 'SELECT 1' });
    render(<QueryEditor {...props} />);

    fireEvent.keyDown(screen.getByTestId('sql-editor'), { key: 'Enter', ctrlKey: true });

    expect(props.onRunQuery).toHaveBeenCalled();
  });

  it('plain edits do not run the query', () => {
    const props = makeProps({ rawSql: 'SELECT 1' });
    render(<QueryEditor {...props} />);

    fireEvent.change(screen.getByTestId('sql-editor'), { target: { value: 'SELECT 2' } });

    expect(props.onRunQuery).not.toHaveBeenCalled();
  });
});

describe('QueryEditor autocomplete failure notice', () => {
  it('shows a fallback message when schema lookups fail', () => {
    const spy = jest.spyOn(completionData, 'useCompletionData').mockReturnValue({
      getSchemas: jest.fn().mockResolvedValue([]),
      getTables: jest.fn().mockResolvedValue([]),
      getColumns: jest.fn().mockResolvedValue([]),
      error: true,
    });

    render(<QueryEditor {...makeProps({ rawSql: 'SELECT 1' })} />);

    expect(screen.getByText(/Autocomplete is unavailable/)).toBeInTheDocument();
    spy.mockRestore();
  });

  it('shows nothing while lookups succeed', () => {
    render(<QueryEditor {...makeProps({ rawSql: 'SELECT 1' })} />);

    expect(screen.queryByText(/Autocomplete is unavailable/)).not.toBeInTheDocument();
  });
});
