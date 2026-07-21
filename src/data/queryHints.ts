import { DataQueryRequest, DataQueryResponse, QueryResultMetaNotice } from '@grafana/data';

import { CrateDBQuery } from '../types';
import { stripComments } from './formatDetection';

// the macros that bind a query to the panel time range
const TIME_BOUND_MACRO = /\$__(?:timeFilter|dateFilter|unixEpochFilter|timeFrom|timeTo|fromTime|toTime)\b/;

// refIds of the plugin's internal lookups (ad-hoc values, variable queries),
// which legitimately never carry a time bound
const INTERNAL_REF_IDS = new Set(['adhoc-metadata', 'variable-query']);

export function hasTimeBound(rawSql: string): boolean {
  return TIME_BOUND_MACRO.test(stripComments(rawSql));
}

const NOTICE: QueryResultMetaNotice = {
  severity: 'info',
  text:
    'This query has no time-range macro, so it ignores the panel time range and cannot prune ' +
    'partitions. Add $__timeFilter("<time column>") to bound it.',
};

// stamps an info notice on the first frame of every visible target whose SQL has
// no time-range macro. Info, not warning: hand-written time predicates (e.g.
// ts > now() - '1 day'::INTERVAL) are legitimate, so this stays gentle.
export function attachTimeBoundNotices(
  request: DataQueryRequest<CrateDBQuery>,
  response: DataQueryResponse
): DataQueryResponse {
  const unbounded = new Set(
    request.targets
      .filter((t) => !t.hide && !INTERNAL_REF_IDS.has(t.refId) && t.rawSql && !hasTimeBound(t.rawSql))
      .map((t) => t.refId)
  );
  if (unbounded.size === 0) {
    return response;
  }
  const seen = new Set<string>();
  for (const frame of response.data ?? []) {
    if (!frame?.refId || !unbounded.has(frame.refId) || seen.has(frame.refId)) {
      continue;
    }
    seen.add(frame.refId);
    frame.meta = { ...frame.meta, notices: [...(frame.meta?.notices ?? []), NOTICE] };
  }
  return response;
}
