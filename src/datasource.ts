import { lastValueFrom, Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import {
  AdHocVariableFilter,
  CoreApp,
  DataQueryRequest,
  DataQueryResponse,
  DataSourceInstanceSettings,
  DataSourceWithSupplementaryQueriesSupport,
  MetricFindValue,
  ScopedVars,
  SupplementaryQueryOptions,
  SupplementaryQueryType,
  TimeRange,
} from '@grafana/data';
import { DataSourceWithBackend, getTemplateSrv } from '@grafana/runtime';

import { InFlightCache } from './data/cache';
import { DEFAULTS } from './constants';
import { AdHocFilter } from './data/adHocFilter';
import { applyConditionalAll } from './data/conditionalAll';
import { escapeColumnRef, escapeIdentifier } from './data/escape';
import { interpolateVariable } from './data/interpolate';
import { splitLogVolumeFrames } from './data/logVolume';
import { attachTimeBoundNotices } from './data/queryHints';
import { defaultBuilderOptions, generateLogVolumeSql } from './data/sqlGenerator';
import { parseSqlToBuilderOptions } from './data/sqlParser';
import { BuilderOptions, ColumnMeta, CrateDBOptions, CrateDBQuery, EditorType, QueryFormat } from './types';
import { CrateDBVariableSupport } from './variables';

// cap for the DISTINCT scan behind ad-hoc value dropdowns
const ADHOC_VALUES_LIMIT = 1000;

// a constant/textbox variable (comma-separated, optionally schema-qualified table
// names) narrows which tables feed the ad-hoc key picker
export const ADHOC_SCOPE_VARIABLE = 'cratedb_adhoc_tables';

function adhocScopeTables(defaultSchema: string): string[] | undefined {
  const variable = getTemplateSrv()
    .getVariables()
    .find((v) => v.name === ADHOC_SCOPE_VARIABLE);
  const value = variable && 'current' in variable ? variable.current.value : undefined;
  const text = Array.isArray(value) ? value.join(',') : String(value ?? '');
  const tables = text
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    // a qualifier matching the default schema is dropped; keys carry bare table names
    .map((entry) => {
      const [schema, ...rest] = entry.split('.');
      return rest.length > 0 && schema === defaultSchema ? rest.join('.') : entry;
    });
  return tables.length > 0 ? tables : undefined;
}

interface Frame {
  fields: Array<{ name: string; values: unknown[] }>;
}

// prefixes a supplementary target's refId so its frames are attributable
const LOG_VOLUME_REFID_PREFIX = 'log-volume-';

export class CrateDBDatasource
  extends DataSourceWithBackend<CrateDBQuery, CrateDBOptions>
  implements DataSourceWithSupplementaryQueriesSupport<CrateDBQuery>
{
  defaultSchema: string;
  adHocFilter: AdHocFilter;
  // coalesce concurrent autocomplete/ad-hoc dropdown bursts into one request
  private completionCache = new InFlightCache<string[]>();
  private columnMetaCache = new InFlightCache<ColumnMeta[]>();
  private tagCache = new InFlightCache<MetricFindValue[]>();

  constructor(instanceSettings: DataSourceInstanceSettings<CrateDBOptions>) {
    super(instanceSettings);
    this.defaultSchema = instanceSettings.jsonData.defaultSchema ?? DEFAULTS.defaultSchema;
    this.adHocFilter = new AdHocFilter(this.defaultSchema);
    this.variables = new CrateDBVariableSupport(this);
    // without this, plugin.json advertises annotations but Grafana never renders the editor
    this.annotations = {};
    // "Min time interval": lower bound for $__interval; unset follows panel resolution
    if (instanceSettings.jsonData.timeInterval) {
      this.interval = instanceSettings.jsonData.timeInterval;
    }
  }

  // new panels open in the visual builder, seeded with the recommended
  // count(*)-per-interval aggregation; nothing runs until a table is picked
  // (blank rawSql is skipped by filterQuery)
  getDefaultQuery(_: CoreApp): Partial<CrateDBQuery> {
    return {
      rawSql: '',
      format: QueryFormat.Timeseries,
      editorType: EditorType.Builder,
      builderOptions: defaultBuilderOptions(this.defaultSchema),
    };
  }

  // post-process super.query: split logs-volume frames per severity, and stamp
  // the "no time macro" hint on frames whose SQL ignores the panel time range
  query(request: DataQueryRequest<CrateDBQuery>): Observable<DataQueryResponse> {
    return super.query(request).pipe(
      map((response) => ({ ...response, data: splitLogVolumeFrames(response.data, LOG_VOLUME_REFID_PREFIX) })),
      map((response) => attachTimeBoundNotices(request, response))
    );
  }

  // all frontend-side SQL rewriting, run per target before the backend expands $__ macros.
  // order is load-bearing: applyConditionalAll first (reads raw "All"-vs-concrete state that
  // replace() would erase); ad-hoc before replace() too (the AST parser tolerates $__interval
  // as a token but not the literal replace() turns it into).
  applyTemplateVariables(query: CrateDBQuery, scopedVars: ScopedVars, filters?: AdHocVariableFilter[]): CrateDBQuery {
    let rawSql = applyConditionalAll(query.rawSql, getTemplateSrv().getVariables());
    rawSql = this.adHocFilter.apply(rawSql, filters ?? []);
    rawSql = getTemplateSrv().replace(rawSql, scopedVars, interpolateVariable);
    return { ...query, rawSql };
  }

  // false skips the target, so a blank new-panel editor doesn't fire an empty query
  filterQuery(query: CrateDBQuery): boolean {
    return !!query.rawSql;
  }

  // ---- supplementary queries: the Explore logs-volume histogram ------------
  // Without these, Explore buckets only the (LIMITed) returned log lines and
  // flags the graph as partial; with them it runs a full-range aggregation.

  getSupportedSupplementaryQueryTypes(): SupplementaryQueryType[] {
    return [SupplementaryQueryType.LogsVolume];
  }

  getSupplementaryQuery(options: SupplementaryQueryOptions, query: CrateDBQuery): CrateDBQuery | undefined {
    if (options.type !== SupplementaryQueryType.LogsVolume) {
      return undefined;
    }
    const logsOptions = this.logsBuilderOptions(query);
    const rawSql = logsOptions ? generateLogVolumeSql(logsOptions) : '';
    if (!rawSql) {
      return undefined;
    }
    return {
      refId: `${LOG_VOLUME_REFID_PREFIX}${query.refId}`,
      rawSql,
      format: QueryFormat.Timeseries,
    };
  }

  getSupplementaryRequest(
    type: SupplementaryQueryType,
    request: DataQueryRequest<CrateDBQuery>
  ): DataQueryRequest<CrateDBQuery> | undefined {
    if (type !== SupplementaryQueryType.LogsVolume) {
      return undefined;
    }
    const targets = request.targets
      .filter((query) => !query.hide)
      .map((query) => this.getSupplementaryQuery({ type }, query))
      .filter((query): query is CrateDBQuery => query !== undefined);
    if (targets.length === 0) {
      return undefined;
    }
    return { ...request, targets, hideFromInspector: true };
  }

  // the logs shape behind a query, whichever surface edits it: builder state
  // directly, or hand-written SQL re-derived through the parser
  private logsBuilderOptions(query: CrateDBQuery): BuilderOptions | undefined {
    if (query.format !== QueryFormat.Logs) {
      return undefined;
    }
    const options =
      query.editorType === EditorType.Builder
        ? query.builderOptions
        : parseSqlToBuilderOptions(query.rawSql, this.defaultSchema);
    return options?.flavor === QueryFormat.Logs ? options : undefined;
  }

  // autocomplete data from the backend's sqlds resource routes
  fetchSchemas(): Promise<string[]> {
    return this.completionCache.get('schemas', () => this.postResource<string[]>('schemas', {}));
  }

  fetchTables(schema?: string): Promise<string[]> {
    const s = schema ?? this.defaultSchema;
    return this.completionCache.get(`tables:${s}`, () => this.postResource<string[]>('tables', { schema: s }));
  }

  fetchColumns(schema: string, table: string): Promise<string[]> {
    return this.completionCache.get(`columns:${schema}.${table}`, () =>
      this.postResource<string[]>('columns', { schema, table })
    );
  }

  // columns with their CrateDB data types, for the query builder's pickers and
  // typed filter value editors
  fetchColumnMeta(schema: string, table: string): Promise<ColumnMeta[]> {
    return this.columnMetaCache.get(`${schema}.${table}`, () =>
      this.postResource<ColumnMeta[]>('column-meta', { schema, table })
    );
  }

  // table.column pairs from the default schema, restricted backend-side to filterable
  // column types; the cratedb_adhoc_tables variable narrows the tables
  getTagKeys(): Promise<MetricFindValue[]> {
    const scope = adhocScopeTables(this.defaultSchema);
    return this.tagCache.get(`keys:${this.defaultSchema}:${scope?.join(',') ?? '*'}`, async () => {
      const keys = await this.postResource<string[]>('adhoc-keys', { schema: this.defaultSchema });
      const scoped = scope ? keys.filter((key) => scope.includes(key.split('.')[0])) : keys;
      return scoped.map((text) => ({ text }));
    });
  }

  getTagValues(options: { key: string }): Promise<MetricFindValue[]> {
    return this.tagCache.get(`values:${options.key}`, async () => {
      const [table, ...columnParts] = options.key.split('.');
      const column = columnParts.join('.');
      if (!table || !column) {
        return [];
      }
      const frame = await this.runTableQuery({
        refId: 'adhoc-metadata',
        rawSql: `SELECT DISTINCT ${escapeColumnRef(column)} AS value FROM ${escapeIdentifier(this.defaultSchema)}.${escapeIdentifier(table)} LIMIT ${ADHOC_VALUES_LIMIT}`,
        format: QueryFormat.Table,
      });
      if (!frame) {
        return [];
      }
      return frame.fields[0].values.filter((value) => value !== null).map((value) => ({ text: String(value) }));
    });
  }

  // run a single table query and return its first frame, if it has fields. The
  // query pipeline interpolates once, so callers pass raw SQL plus any scopedVars.
  private async runTableQuery(
    query: CrateDBQuery,
    options?: { range?: TimeRange; scopedVars?: ScopedVars }
  ): Promise<Frame | undefined> {
    const response = await lastValueFrom(
      this.query({
        targets: [query],
        ...(options?.range ? { range: options.range } : {}),
        ...(options?.scopedVars ? { scopedVars: options.scopedVars } : {}),
      } as Parameters<DataSourceWithBackend<CrateDBQuery, CrateDBOptions>['query']>[0])
    );
    const frame: Frame | undefined = response.data?.[0];
    return frame && frame.fields.length > 0 ? frame : undefined;
  }

  // variable query: one field gives values; two fields (or a __text/__value pair)
  // give text/value entries
  async metricFindQuery(
    rawSql: string,
    options?: { scopedVars?: ScopedVars; range?: TimeRange }
  ): Promise<MetricFindValue[]> {
    if (!rawSql) {
      return [];
    }
    const query: CrateDBQuery = {
      refId: 'variable-query',
      rawSql,
      format: QueryFormat.Table,
    };
    const frame = await this.runTableQuery(query, {
      range: options?.range,
      scopedVars: options?.scopedVars,
    });
    if (!frame) {
      return [];
    }
    if (frame.fields.length === 1) {
      return frame.fields[0].values.map((value) => ({ text: String(value) }));
    }
    const textField = frame.fields.find((f) => f.name === '__text') ?? frame.fields[0];
    const valueField = frame.fields.find((f) => f.name === '__value') ?? frame.fields[1];
    return textField.values.map((text, i) => ({
      text: String(text),
      value: valueField.values[i] as string | number,
    }));
  }
}
