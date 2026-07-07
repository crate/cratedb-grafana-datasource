import { lastValueFrom } from 'rxjs';

import { CoreApp, DataSourceInstanceSettings, MetricFindValue, ScopedVars } from '@grafana/data';
import { DataSourceWithBackend, getTemplateSrv } from '@grafana/runtime';

import { DEFAULT_QUERY_TEMPLATE, DEFAULTS } from './constants';
import { CrateDBOptions, CrateDBQuery, QueryFormat } from './types';

export class CrateDBDatasource extends DataSourceWithBackend<CrateDBQuery, CrateDBOptions> {
  defaultSchema: string;

  constructor(instanceSettings: DataSourceInstanceSettings<CrateDBOptions>) {
    super(instanceSettings);
    this.defaultSchema = instanceSettings.jsonData.defaultSchema ?? DEFAULTS.defaultSchema;
  }

  /**
   * The query-guidance hook: every new panel query starts from the safe
   * server-side aggregation template instead of an empty editor.
   */
  getDefaultQuery(_: CoreApp): Partial<CrateDBQuery> {
    return {
      rawSql: DEFAULT_QUERY_TEMPLATE,
      format: QueryFormat.Timeseries,
    };
  }

  applyTemplateVariables(query: CrateDBQuery, scopedVars: ScopedVars): CrateDBQuery {
    return {
      ...query,
      rawSql: getTemplateSrv().replace(query.rawSql, scopedVars),
    };
  }

  filterQuery(query: CrateDBQuery): boolean {
    return !!query.rawSql;
  }

  /**
   * Autocomplete data, served by the backend's sqlds resource routes
   * (sqlds.Completable in pkg/plugin/completable.go).
   */
  fetchSchemas(): Promise<string[]> {
    return this.postResource<string[]>('schemas', {});
  }

  fetchTables(schema?: string): Promise<string[]> {
    return this.postResource<string[]>('tables', { schema: schema ?? this.defaultSchema });
  }

  fetchColumns(schema: string, table: string): Promise<string[]> {
    return this.postResource<string[]>('columns', { schema, table });
  }

  /**
   * Template variable support: run the variable query as a table query and
   * flatten the first frame. One field → values; a "__text"/"__value" pair
   * (or two fields) → text/value entries.
   */
  async metricFindQuery(rawSql: string, options?: { scopedVars?: ScopedVars }): Promise<MetricFindValue[]> {
    if (!rawSql) {
      return [];
    }
    const query: CrateDBQuery = {
      refId: 'variable-query',
      rawSql,
      format: QueryFormat.Table,
    };
    const response = await lastValueFrom(
      this.query({
        targets: [this.applyTemplateVariables(query, options?.scopedVars ?? {})],
      } as Parameters<DataSourceWithBackend<CrateDBQuery, CrateDBOptions>['query']>[0])
    );
    const frame = response.data?.[0];
    if (!frame || frame.fields.length === 0) {
      return [];
    }
    if (frame.fields.length === 1) {
      return frame.fields[0].values.map((value: unknown) => ({ text: String(value) }));
    }
    const textField = frame.fields.find((f: { name: string }) => f.name === '__text') ?? frame.fields[0];
    const valueField = frame.fields.find((f: { name: string }) => f.name === '__value') ?? frame.fields[1];
    return textField.values.map((text: unknown, i: number) => ({
      text: String(text),
      value: valueField.values[i],
    }));
  }
}
