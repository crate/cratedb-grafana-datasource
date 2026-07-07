// Package macros implements the Grafana SQL macros ($__timeFilter, ...) for
// CrateDB. Macro expansion happens backend-side via sqlutil.Interpolate;
// $__interval, $__interval_ms, $__table and $__column are provided by
// sqlutil.DefaultMacros and need no implementation here.
//
// Macro idioms adapted from the Redshift datasource (Apache-2.0),
// https://github.com/grafana/redshift-datasource — see NOTICE.
package macros

import (
	"fmt"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/gtime"
	"github.com/grafana/grafana-plugin-sdk-go/data/sqlutil"
)

// Macros is the full CrateDB macro set, registered by the driver.
var Macros = sqlutil.Macros{
	"timeFilter":          TimeFilter,
	"timeFrom":            TimeFrom,
	"timeTo":              TimeTo,
	"timeGroup":           TimeGroup,
	"timeGroupAlias":      TimeGroupAlias,
	"unixEpochFilter":     UnixEpochFilter,
	"unixEpochGroup":      UnixEpochGroup,
	"unixEpochGroupAlias": UnixEpochGroupAlias,
}

// parseInterval resolves the interval argument of a group macro. In panels,
// the frontend template engine replaces $__interval before the query reaches
// the backend. In backend-only paths (alerting, recorded queries) the literal
// "$__interval" survives — and because sqlutil.Interpolate applies longer
// macro names first, timeGroup sees it un-expanded. Fall back to the
// query-model interval in that case.
func parseInterval(query *sqlutil.Query, arg string) (time.Duration, error) {
	arg = strings.Trim(arg, `'" `)
	if strings.Contains(arg, "$__interval") {
		if query.Interval > 0 {
			return query.Interval, nil
		}
		return 0, fmt.Errorf("cannot resolve $__interval: query has no interval")
	}
	interval, err := gtime.ParseInterval(arg)
	if err != nil {
		return 0, fmt.Errorf("error parsing interval %q: %w", arg, err)
	}
	return interval, nil
}

// intervalSeconds renders a duration as whole seconds, minimum 1.
// SPIKE(S2): sub-second grouping intervals are rounded up; decide whether to
// emit millisecond INTERVAL literals instead once verified on a live cluster.
func intervalSeconds(interval time.Duration) int64 {
	seconds := int64(interval.Seconds())
	if seconds < 1 {
		seconds = 1
	}
	return seconds
}

// TimeFilter expands $__timeFilter(column) to a range condition with RFC 3339
// UTC literals; CrateDB casts the strings to TIMESTAMPTZ in the comparison.
func TimeFilter(query *sqlutil.Query, args []string) (string, error) {
	if len(args) != 1 {
		return "", fmt.Errorf("%w: expected 1 argument, received %d", sqlutil.ErrorBadArgumentCount, len(args))
	}
	var (
		column = args[0]
		from   = query.TimeRange.From.UTC().Format(time.RFC3339)
		to     = query.TimeRange.To.UTC().Format(time.RFC3339)
	)
	return fmt.Sprintf("%s >= '%s' AND %s <= '%s'", column, from, column, to), nil
}

// TimeFrom expands $__timeFrom() to the panel range start as an RFC 3339 literal.
func TimeFrom(query *sqlutil.Query, args []string) (string, error) {
	return fmt.Sprintf("'%s'", query.TimeRange.From.UTC().Format(time.RFC3339)), nil
}

// TimeTo expands $__timeTo() to the panel range end as an RFC 3339 literal.
func TimeTo(query *sqlutil.Query, args []string) (string, error) {
	return fmt.Sprintf("'%s'", query.TimeRange.To.UTC().Format(time.RFC3339)), nil
}

// TimeGroup expands $__timeGroup(column, interval) to a DATE_BIN bucket that
// returns a real TIMESTAMPTZ — the server-side downsampling that keeps result
// sets proportional to panel pixels instead of raw row counts.
//
// SPIKE(S2): verify the numeric origin literal (0 = epoch) and the minimum
// CrateDB version shipping DATE_BIN; documented fallback for older clusters:
//
//	FLOOR(EXTRACT(EPOCH FROM %s)/%d)*%d
func TimeGroup(query *sqlutil.Query, args []string) (string, error) {
	if len(args) != 2 {
		return "", fmt.Errorf("%w: macro $__timeGroup needs time column and interval", sqlutil.ErrorBadArgumentCount)
	}
	interval, err := parseInterval(query, args[1])
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("DATE_BIN('%d seconds'::INTERVAL, %s, 0)", intervalSeconds(interval), args[0]), nil
}

// TimeGroupAlias is TimeGroup aliased to "time", the column name Grafana's
// time-series frame conversion looks for.
func TimeGroupAlias(query *sqlutil.Query, args []string) (string, error) {
	expr, err := TimeGroup(query, args)
	if err != nil {
		return "", err
	}
	return expr + ` AS "time"`, nil
}

// UnixEpochFilter expands $__unixEpochFilter(column) for BIGINT epoch-seconds columns.
func UnixEpochFilter(query *sqlutil.Query, args []string) (string, error) {
	if len(args) != 1 {
		return "", fmt.Errorf("%w: expected 1 argument, received %d", sqlutil.ErrorBadArgumentCount, len(args))
	}
	var (
		column = args[0]
		from   = query.TimeRange.From.UTC().Unix()
		to     = query.TimeRange.To.UTC().Unix()
	)
	return fmt.Sprintf("%s >= %d AND %s <= %d", column, from, column, to), nil
}

// UnixEpochGroup expands $__unixEpochGroup(column, interval) for epoch-seconds columns.
func UnixEpochGroup(query *sqlutil.Query, args []string) (string, error) {
	if len(args) != 2 {
		return "", fmt.Errorf("%w: macro $__unixEpochGroup needs time column and interval", sqlutil.ErrorBadArgumentCount)
	}
	interval, err := parseInterval(query, args[1])
	if err != nil {
		return "", err
	}
	seconds := intervalSeconds(interval)
	return fmt.Sprintf("FLOOR(%s/%d)*%d", args[0], seconds, seconds), nil
}

// UnixEpochGroupAlias is UnixEpochGroup aliased to "time".
func UnixEpochGroupAlias(query *sqlutil.Query, args []string) (string, error) {
	expr, err := UnixEpochGroup(query, args)
	if err != nil {
		return "", err
	}
	return expr + ` AS "time"`, nil
}
