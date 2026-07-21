import React from 'react';

import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';

import { CrateDBDatasource } from '../datasource';
import * as completionData from '../editor/useCompletionData';
import { CrateDBVariableQuery } from '../types';
import { VariableQueryEditor } from './VariableQueryEditor';

// re-export as a plain writable object so single tests can spy on the hook;
// __esModule keeps the namespace import identical to what the component sees
jest.mock('../editor/useCompletionData', () => ({
  __esModule: true,
  ...jest.requireActual('../editor/useCompletionData'),
}));

// Monaco does not run under jsdom; a textarea is enough to drive onChange.
jest.mock('@grafana/plugin-ui', () => ({
  ...jest.requireActual('@grafana/plugin-ui'),
  SQLEditor: ({ query, onChange }: { query: string; onChange: (sql: string) => void }) => (
    <textarea data-testid="sql-editor" value={query} onChange={(e) => onChange(e.currentTarget.value)} />
  ),
}));

function makeProps(query: Partial<CrateDBVariableQuery>) {
  const datasource = {
    defaultSchema: 'doc',
    fetchSchemas: jest.fn().mockResolvedValue([]),
    fetchTables: jest.fn().mockResolvedValue([]),
    fetchColumns: jest.fn().mockResolvedValue([]),
  } as unknown as CrateDBDatasource;
  return {
    datasource,
    query: { refId: 'A', rawSql: '', ...query } as CrateDBVariableQuery,
    onChange: jest.fn(),
    onRunQuery: jest.fn(),
  };
}

describe('VariableQueryEditor', () => {
  it('renders the incoming query string in the editor', () => {
    render(<VariableQueryEditor {...makeProps({ rawSql: 'SELECT name FROM sys.nodes' })} />);

    expect(screen.getByTestId('sql-editor')).toHaveValue('SELECT name FROM sys.nodes');
  });

  it('emits the edited SQL back on the query object', () => {
    const props = makeProps({ rawSql: 'SELECT 1' });
    render(<VariableQueryEditor {...props} />);

    fireEvent.change(screen.getByTestId('sql-editor'), { target: { value: 'SELECT name FROM sys.nodes' } });

    expect(props.onChange).toHaveBeenCalledWith(
      expect.objectContaining({ refId: 'A', rawSql: 'SELECT name FROM sys.nodes' })
    );
  });

  it('renders an empty new variable without crashing', () => {
    render(<VariableQueryEditor {...makeProps({ rawSql: undefined })} />);

    expect(screen.getByTestId('sql-editor')).toHaveValue('');
  });

  it('documents the __text/__value column convention', () => {
    render(<VariableQueryEditor {...makeProps({ rawSql: 'SELECT 1' })} />);

    expect(screen.getByText(/__text/)).toBeInTheDocument();
    expect(screen.getByText(/__value/)).toBeInTheDocument();
  });

  it('shows a fallback message when schema lookups fail', () => {
    const spy = jest.spyOn(completionData, 'useCompletionData').mockReturnValue({
      getSchemas: jest.fn().mockResolvedValue([]),
      getTables: jest.fn().mockResolvedValue([]),
      getColumns: jest.fn().mockResolvedValue([]),
      error: true,
    });

    render(<VariableQueryEditor {...makeProps({ rawSql: 'SELECT 1' })} />);

    expect(screen.getByText(/Autocomplete is unavailable/)).toBeInTheDocument();
    spy.mockRestore();
  });
});
