import React from 'react';

import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DEFAULT_QUERY_TEMPLATE, LOGS_QUERY_TEMPLATE } from '../constants';
import { MACROS } from '../editor/macros';
import { QueryFormat } from '../types';
import { CheatSheet } from './CheatSheet';

function renderSheet() {
  const onClickExample = jest.fn();
  render(
    <CheatSheet
      onClickExample={onClickExample}
      query={{ refId: 'A', rawSql: '', format: QueryFormat.Timeseries }}
      datasource={{} as never}
    />
  );
  return { onClickExample };
}

describe('CheatSheet template buttons', () => {
  it('loads the recommended time-series template as a time-series query', async () => {
    const { onClickExample } = renderSheet();

    await userEvent.click(screen.getByRole('button', { name: /recommended template/i }));

    expect(onClickExample).toHaveBeenCalledWith(
      expect.objectContaining({ rawSql: DEFAULT_QUERY_TEMPLATE, format: QueryFormat.Timeseries })
    );
  });

  it('loads the logs template as a logs query', async () => {
    const { onClickExample } = renderSheet();

    await userEvent.click(screen.getByRole('button', { name: /logs template/i }));

    expect(onClickExample).toHaveBeenCalledWith(
      expect.objectContaining({ rawSql: LOGS_QUERY_TEMPLATE, format: QueryFormat.Logs })
    );
  });
});

describe('CheatSheet reference content', () => {
  it('documents every macro with its description', () => {
    renderSheet();

    // one table row per macro; the id in a <code> cell and the description text
    for (const macro of MACROS) {
      expect(screen.getByText(macro.id)).toBeInTheDocument();
      expect(screen.getByText(macro.description)).toBeInTheDocument();
    }
  });

  it('covers the differentiating features (logs, ad-hoc scoping, EXPLAIN, sys)', () => {
    renderSheet();

    expect(screen.getByText('cratedb_adhoc_tables')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /query plans/i })).toBeInTheDocument();
    // EXPLAIN guidance and the sys-schema monitoring note are the CrateDB-specific hooks
    expect(screen.getAllByText(/EXPLAIN/).length).toBeGreaterThan(0);
    expect(screen.getByText(/sys\.jobs_log/)).toBeInTheDocument();
  });
});
