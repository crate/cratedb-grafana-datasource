import { from, Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { CustomVariableSupport, DataQueryRequest, DataQueryResponse, toDataFrame } from '@grafana/data';

import { VariableQueryEditor } from './components/VariableQueryEditor';
import type { CrateDBDatasource } from './datasource';
import { CrateDBOptions, CrateDBQuery, CrateDBVariableQuery } from './types';

// dashboards written against generic SQL datasources — and hand-provisioned
// JSON — store the variable query as a bare SQL string rather than the
// {rawSql} model; both shapes must resolve
export function variableRawSql(query: CrateDBVariableQuery | string | undefined): string {
  if (typeof query === 'string') {
    return query;
  }
  return query?.rawSql ?? '';
}

// Query-variable support: renders VariableQueryEditor and resolves values through
// metricFindQuery (which handles the single-column and __text/__value conventions).
// Registered via CrateDBDatasource.variables, the replacement for setVariableQueryEditor.
export class CrateDBVariableSupport extends CustomVariableSupport<
  CrateDBDatasource,
  CrateDBVariableQuery,
  CrateDBQuery,
  CrateDBOptions
> {
  constructor(private datasource: CrateDBDatasource) {
    super();
  }

  editor = VariableQueryEditor;

  query(request: DataQueryRequest<CrateDBVariableQuery>): Observable<DataQueryResponse> {
    const rawSql = variableRawSql(request.targets[0] as CrateDBVariableQuery | string | undefined);
    return from(
      this.datasource.metricFindQuery(rawSql, { range: request.range, scopedVars: request.scopedVars })
    ).pipe(map((values) => ({ data: [toDataFrame(values)] })));
  }
}
