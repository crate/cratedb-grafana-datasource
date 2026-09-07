// Package macros implements the Grafana SQL macros ($__timeFilter, ...) for
// CrateDB, expanded backend-side via sqlutil.Interpolate. $__interval,
// $__interval_ms, $__table and $__column come from sqlutil.DefaultMacros.
package macros

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/gtime"
	"github.com/grafana/grafana-plugin-sdk-go/data/sqlutil"
)

// templateToken matches an unexpanded Grafana reference ($__macro, ${var}, $var).
// A bare $ before a digit (a value like $100) is not a token.
var templateToken = regexp.MustCompile(`\$(?:__|\{|[a-zA-Z_])`)

// Macros is the full CrateDB macro set, registered by the driver.
var Macros = sqlutil.Macros{
	"dateFilter":          DateFilter,
	"timeFilter":          TimeFilter,
	"timeFrom":            TimeFrom,
	"timeTo":              TimeTo,
	"fromTime":            FromTime,
	"toTime":              ToTime,
	"timeGroup":           TimeGroup,
	"timeGroupAlias":      TimeGroupAlias,
	"time":                Time,
	"timeEpoch":           TimeEpoch,
	"interval_s":          IntervalS,
	"unixEpochFilter":     UnixEpochFilter,
	"unixEpochFrom":       UnixEpochFrom,
	"unixEpochTo":         UnixEpochTo,
	"unixEpochGroup":      UnixEpochGroup,
	"unixEpochGroupAlias": UnixEpochGroupAlias,
	"unixEpochNanoFilter": UnixEpochNanoFilter,
	"unixEpochNanoFrom":   UnixEpochNanoFrom,
	"unixEpochNanoTo":     UnixEpochNanoTo,
	"conditionalAll":      ConditionalAll,
}

// rfc3339Ms is RFC 3339 with millisecond precision, CrateDB's native timestamp resolution.
const rfc3339Ms = "2006-01-02T15:04:05.000Z07:00"

// parseInterval resolves a group macro's interval argument, falling back to the
// query interval when a literal "$__interval" reaches the backend un-expanded
// (the alerting path, where frontend interpolation never ran).
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

func intervalSeconds(interval time.Duration) int64 {
	return max(int64(interval.Seconds()), 1)
}

// intervalLiteral renders the DATE_BIN bucket width. Whole seconds read as "N
// seconds"; sub-second widths use milliseconds so they aren't coarsened to 1s.
func intervalLiteral(interval time.Duration) string {
	ms := max(interval.Milliseconds(), 1)
	if ms%1000 == 0 {
		return fmt.Sprintf("%d seconds", ms/1000)
	}
	return fmt.Sprintf("%d milliseconds", ms)
}

// rangeFilter builds a `col >= from AND col <= to` condition with both bounds formatted by layout.
func rangeFilter(query *sqlutil.Query, args []string, layout string) (string, error) {
	if len(args) != 1 {
		return "", fmt.Errorf("%w: expected 1 argument, received %d", sqlutil.ErrorBadArgumentCount, len(args))
	}
	column := args[0]
	from := query.TimeRange.From.UTC().Format(layout)
	to := query.TimeRange.To.UTC().Format(layout)
	return fmt.Sprintf("%s >= '%s' AND %s <= '%s'", column, from, column, to), nil
}

// TimeFilter expands $__timeFilter(column) to a millisecond-precision RFC 3339 range condition.
func TimeFilter(query *sqlutil.Query, args []string) (string, error) {
	return rangeFilter(query, args, rfc3339Ms)
}

// DateFilter expands $__dateFilter(column) to a date-only range condition, for DATE columns.
func DateFilter(query *sqlutil.Query, args []string) (string, error) {
	return rangeFilter(query, args, time.DateOnly)
}

func timeLiteral(t time.Time, layout, suffix string) string {
	return fmt.Sprintf("'%s'%s", t.UTC().Format(layout), suffix)
}

// TimeFrom expands $__timeFrom() to the panel range start as a millisecond-precision
// RFC 3339 literal (second precision would silently drop up to 999ms of the range).
func TimeFrom(query *sqlutil.Query, args []string) (string, error) {
	return timeLiteral(query.TimeRange.From, rfc3339Ms, ""), nil
}

// TimeTo expands $__timeTo() to the panel range end as a millisecond-precision RFC 3339 literal.
func TimeTo(query *sqlutil.Query, args []string) (string, error) {
	return timeLiteral(query.TimeRange.To, rfc3339Ms, ""), nil
}

// FromTime expands $__fromTime to the range start as a typed TIMESTAMPTZ
// literal, for use inside expressions where a bare string wouldn't infer a type.
func FromTime(query *sqlutil.Query, args []string) (string, error) {
	return timeLiteral(query.TimeRange.From, rfc3339Ms, "::TIMESTAMPTZ"), nil
}

// ToTime expands $__toTime to the range end as a typed TIMESTAMPTZ literal.
func ToTime(query *sqlutil.Query, args []string) (string, error) {
	return timeLiteral(query.TimeRange.To, rfc3339Ms, "::TIMESTAMPTZ"), nil
}

// IntervalS expands $__interval_s to the panel interval as whole seconds (minimum 1).
func IntervalS(query *sqlutil.Query, args []string) (string, error) {
	return fmt.Sprintf("%d", intervalSeconds(query.Interval)), nil
}

// TimeGroup expands $__timeGroup(column, interval[, fill]) to a DATE_BIN bucket
// returning a TIMESTAMPTZ. DATE_BIN cannot fill gaps, so the emitted SQL is the
// same with or without the fill argument and the response step honours it
// (pkg/plugin/timeseries.go); validating it here keeps the error on the
// interpolation path, where the user sees it.
func TimeGroup(query *sqlutil.Query, args []string) (string, error) {
	if len(args) < 2 || len(args) > 3 {
		return "", fmt.Errorf("%w: macro $__timeGroup needs a time column, an interval and an optional fill value (NULL, previous or a number)", sqlutil.ErrorBadArgumentCount)
	}
	interval, err := parseInterval(query, args[1])
	if err != nil {
		return "", err
	}
	if len(args) == 3 {
		if _, err := ParseFill(args[2]); err != nil {
			return "", err
		}
	}
	return fmt.Sprintf("DATE_BIN('%s'::INTERVAL, %s, 0)", intervalLiteral(interval), args[0]), nil
}

// TimeGroupAlias is TimeGroup aliased to "time" (the column Grafana's time-series frames expect).
func TimeGroupAlias(query *sqlutil.Query, args []string) (string, error) {
	expr, err := TimeGroup(query, args)
	if err != nil {
		return "", err
	}
	return expr + ` AS "time"`, nil
}

// Time expands $__time(column) to the column under the "time" alias.
func Time(query *sqlutil.Query, args []string) (string, error) {
	if len(args) != 1 {
		return "", fmt.Errorf("%w: expected 1 argument, received %d", sqlutil.ErrorBadArgumentCount, len(args))
	}
	return args[0] + ` AS "time"`, nil
}

// TimeEpoch expands $__timeEpoch(column) to epoch seconds under the "time"
// alias; the response step turns that numeric column into the frame's time field.
func TimeEpoch(query *sqlutil.Query, args []string) (string, error) {
	if len(args) != 1 {
		return "", fmt.Errorf("%w: expected 1 argument, received %d", sqlutil.ErrorBadArgumentCount, len(args))
	}
	return fmt.Sprintf(`EXTRACT(EPOCH FROM %s) AS "time"`, args[0]), nil
}

// epochUnit renders an instant as a whole number at one resolution.
type epochUnit func(time.Time) int64

func epochSeconds(t time.Time) int64 { return t.UTC().Unix() }

func epochNanoseconds(t time.Time) int64 { return t.UTC().UnixNano() }

// epochFilter builds a `col >= from AND col <= to` condition over integer
// timestamps at the unit's resolution.
func epochFilter(query *sqlutil.Query, args []string, unit epochUnit) (string, error) {
	if len(args) != 1 {
		return "", fmt.Errorf("%w: expected 1 argument, received %d", sqlutil.ErrorBadArgumentCount, len(args))
	}
	column := args[0]
	return fmt.Sprintf("%s >= %d AND %s <= %d",
		column, unit(query.TimeRange.From), column, unit(query.TimeRange.To)), nil
}

func epochBound(t time.Time, unit epochUnit) string {
	return strconv.FormatInt(unit(t), 10)
}

// UnixEpochFilter expands $__unixEpochFilter(column) for BIGINT epoch-seconds columns.
func UnixEpochFilter(query *sqlutil.Query, args []string) (string, error) {
	return epochFilter(query, args, epochSeconds)
}

// UnixEpochNanoFilter expands $__unixEpochNanoFilter(column) for BIGINT epoch-nanosecond columns.
func UnixEpochNanoFilter(query *sqlutil.Query, args []string) (string, error) {
	return epochFilter(query, args, epochNanoseconds)
}

// UnixEpochFrom expands $__unixEpochFrom() to the range start in epoch seconds.
func UnixEpochFrom(query *sqlutil.Query, args []string) (string, error) {
	return epochBound(query.TimeRange.From, epochSeconds), nil
}

// UnixEpochTo expands $__unixEpochTo() to the range end in epoch seconds.
func UnixEpochTo(query *sqlutil.Query, args []string) (string, error) {
	return epochBound(query.TimeRange.To, epochSeconds), nil
}

// UnixEpochNanoFrom expands $__unixEpochNanoFrom() to the range start in epoch nanoseconds.
func UnixEpochNanoFrom(query *sqlutil.Query, args []string) (string, error) {
	return epochBound(query.TimeRange.From, epochNanoseconds), nil
}

// UnixEpochNanoTo expands $__unixEpochNanoTo() to the range end in epoch nanoseconds.
func UnixEpochNanoTo(query *sqlutil.Query, args []string) (string, error) {
	return epochBound(query.TimeRange.To, epochNanoseconds), nil
}

// UnixEpochGroup expands $__unixEpochGroup(column, interval[, fill]) for
// epoch-seconds columns. The fill argument is honoured on the response, like
// $__timeGroup's.
func UnixEpochGroup(query *sqlutil.Query, args []string) (string, error) {
	if len(args) < 2 || len(args) > 3 {
		return "", fmt.Errorf("%w: macro $__unixEpochGroup needs a time column, an interval and an optional fill value (NULL, previous or a number)", sqlutil.ErrorBadArgumentCount)
	}
	interval, err := parseInterval(query, args[1])
	if err != nil {
		return "", err
	}
	if len(args) == 3 {
		if _, err := ParseFill(args[2]); err != nil {
			return "", err
		}
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

// ConditionalAll backs $__conditionalAll(condition, $var) on the alerting path,
// where frontend interpolation never ran: an empty or still-unexpanded variable
// means no concrete selection reached the backend, so the filter drops to 1=1.
func ConditionalAll(query *sqlutil.Query, args []string) (string, error) {
	if len(args) != 2 {
		return "", fmt.Errorf("%w: macro $__conditionalAll needs a condition and a variable", sqlutil.ErrorBadArgumentCount)
	}
	variable := strings.TrimSpace(args[1])
	if variable == "" || templateToken.MatchString(variable) {
		return "1=1", nil
	}
	return args[0], nil
}
