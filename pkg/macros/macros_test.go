package macros

import (
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/data/sqlutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func testQuery(rawSQL string) *sqlutil.Query {
	return &sqlutil.Query{
		RawSQL:   rawSQL,
		Interval: time.Minute,
		TimeRange: backend.TimeRange{
			From: time.Date(2026, 7, 3, 10, 0, 0, 0, time.UTC),
			To:   time.Date(2026, 7, 3, 16, 0, 0, 0, time.UTC),
		},
	}
}

func TestTimeFilter(t *testing.T) {
	q := testQuery("")
	q.TimeRange.To = time.Date(2026, 7, 3, 16, 0, 0, int(250*time.Millisecond), time.UTC)
	got, err := TimeFilter(q, []string{`"ts"`})
	require.NoError(t, err)
	// millisecond precision: the sub-second component must survive
	assert.Equal(t, `"ts" >= '2026-07-03T10:00:00.000Z' AND "ts" <= '2026-07-03T16:00:00.250Z'`, got)
}

func TestTimeBoundaryMacros(t *testing.T) {
	// all boundaries carry millisecond precision, consistent with $__timeFilter
	// (a second-precision bound would silently drop up to 999ms of the panel range)
	cases := []struct {
		name  string
		macro sqlutil.MacroFunc
		want  string
	}{
		{"timeFrom", TimeFrom, `'2026-07-03T10:00:00.000Z'`},
		{"timeTo", TimeTo, `'2026-07-03T16:00:00.000Z'`},
		{"fromTime", FromTime, `'2026-07-03T10:00:00.000Z'::TIMESTAMPTZ`},
		{"toTime", ToTime, `'2026-07-03T16:00:00.000Z'::TIMESTAMPTZ`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := tc.macro(testQuery(""), nil)
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestTimeGroup(t *testing.T) {
	t.Run("literal interval", func(t *testing.T) {
		got, err := TimeGroup(testQuery(""), []string{`"ts"`, "1m"})
		require.NoError(t, err)
		assert.Equal(t, `DATE_BIN('60 seconds'::INTERVAL, "ts", 0)`, got)
	})

	t.Run("alias variant", func(t *testing.T) {
		got, err := TimeGroupAlias(testQuery(""), []string{`"ts"`, "5m"})
		require.NoError(t, err)
		assert.Equal(t, `DATE_BIN('300 seconds'::INTERVAL, "ts", 0) AS "time"`, got)
	})

	t.Run("falls back to query interval for unexpanded $__interval", func(t *testing.T) {
		// alerting never runs frontend interpolation, so the literal survives into the args
		got, err := TimeGroup(testQuery(""), []string{`"ts"`, "$__interval"})
		require.NoError(t, err)
		assert.Equal(t, `DATE_BIN('60 seconds'::INTERVAL, "ts", 0)`, got)
	})

	t.Run("sub-second interval keeps millisecond resolution", func(t *testing.T) {
		got, err := TimeGroup(testQuery(""), []string{`"ts"`, "200ms"})
		require.NoError(t, err)
		assert.Equal(t, `DATE_BIN('200 milliseconds'::INTERVAL, "ts", 0)`, got)
	})

	t.Run("fractional-second interval keeps millisecond resolution", func(t *testing.T) {
		got, err := TimeGroup(testQuery(""), []string{`"ts"`, "1500ms"})
		require.NoError(t, err)
		assert.Equal(t, `DATE_BIN('1500 milliseconds'::INTERVAL, "ts", 0)`, got)
	})

	t.Run("fill argument leaves the emitted SQL alone", func(t *testing.T) {
		for _, fill := range []string{"NULL", "previous", "0", "-1.5"} {
			got, err := TimeGroupAlias(testQuery(""), []string{`"ts"`, "1m", fill})
			require.NoError(t, err, fill)
			assert.Equal(t, `DATE_BIN('60 seconds'::INTERVAL, "ts", 0) AS "time"`, got, fill)
		}
	})

	t.Run("unrecognized fill argument names the accepted values", func(t *testing.T) {
		for _, fill := range []string{"linear", "NaN", "Inf", "-Inf"} {
			_, err := TimeGroup(testQuery(""), []string{`"ts"`, "1m", fill})
			require.Error(t, err, fill)
			assert.Contains(t, err.Error(), "expected NULL, previous or a number", fill)
		}
	})

	t.Run("wrong arg count names the accepted fill values", func(t *testing.T) {
		_, err := TimeGroup(testQuery(""), []string{`"ts"`})
		assert.ErrorIs(t, err, sqlutil.ErrorBadArgumentCount)

		_, err = TimeGroup(testQuery(""), []string{`"ts"`, "1m", "0", "extra"})
		assert.ErrorIs(t, err, sqlutil.ErrorBadArgumentCount)
		assert.Contains(t, err.Error(), "NULL, previous or a number")
	})
}

func TestGroupFill(t *testing.T) {
	cases := []struct {
		name     string
		sql      string
		wantOK   bool
		interval time.Duration
		fill     Fill
	}{
		{
			name:   "two-argument form asks for no fill",
			sql:    `SELECT $__timeGroupAlias("ts", '1m'), count(*) FROM t`,
			wantOK: false,
		},
		{
			name:     "aliased three-argument form",
			sql:      `SELECT $__timeGroupAlias("ts", '5m', previous), count(*) FROM t`,
			wantOK:   true,
			interval: 5 * time.Minute,
			fill:     Fill{Mode: FillPrevious},
		},
		{
			name:     "bare three-argument form",
			sql:      `SELECT $__timeGroup("ts", '1m', 0), count(*) FROM t`,
			wantOK:   true,
			interval: time.Minute,
			fill:     Fill{Mode: FillValue},
		},
		{
			name:     "numeric fill keeps its decimals",
			sql:      `SELECT $__timeGroupAlias("ts", '1m', 2.5), avg(v) FROM t`,
			wantOK:   true,
			interval: time.Minute,
			fill:     Fill{Mode: FillValue, Value: 2.5},
		},
		{
			name:     "NULL fill",
			sql:      `SELECT $__timeGroupAlias("ts", '1m', NULL), avg(v) FROM t`,
			wantOK:   true,
			interval: time.Minute,
			fill:     Fill{Mode: FillNull},
		},
		{
			name:     "unexpanded $__interval resolves from the query",
			sql:      `SELECT $__timeGroupAlias("ts", $__interval, NULL), avg(v) FROM t`,
			wantOK:   true,
			interval: time.Minute,
			fill:     Fill{Mode: FillNull},
		},
		{
			name:   "an unrecognized fill is left for interpolation to reject",
			sql:    `SELECT $__timeGroupAlias("ts", '1m', linear), avg(v) FROM t`,
			wantOK: false,
		},
		{
			name:     "epoch-seconds bucketing carries a fill too",
			sql:      `SELECT $__unixEpochGroupAlias("epoch", '1m', 0), count(*) FROM t`,
			wantOK:   true,
			interval: time.Minute,
			fill:     Fill{Mode: FillValue},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			interval, fill, ok := GroupFill(testQuery(tc.sql))
			assert.Equal(t, tc.wantOK, ok)
			if !tc.wantOK {
				return
			}
			assert.Equal(t, tc.interval, interval)
			assert.Equal(t, tc.fill, fill)
		})
	}
}

func TestDateFilter(t *testing.T) {
	got, err := DateFilter(testQuery(""), []string{`"day"`})
	require.NoError(t, err)
	assert.Equal(t, `"day" >= '2026-07-03' AND "day" <= '2026-07-03'`, got)
}

func TestIntervalS(t *testing.T) {
	got, err := IntervalS(testQuery(""), nil)
	require.NoError(t, err)
	assert.Equal(t, "60", got)

	sub := testQuery("")
	sub.Interval = 100 * time.Millisecond
	got, err = IntervalS(sub, nil)
	require.NoError(t, err)
	assert.Equal(t, "1", got)
}

func TestTimeColumnAndEpochMacros(t *testing.T) {
	cases := []struct {
		name  string
		macro sqlutil.MacroFunc
		args  []string
		want  string
	}{
		{"unixEpochFilter", UnixEpochFilter, []string{"epoch_col"},
			"epoch_col >= 1783072800 AND epoch_col <= 1783094400"},
		{"unixEpochFrom", UnixEpochFrom, nil, "1783072800"},
		{"unixEpochTo", UnixEpochTo, nil, "1783094400"},
		{"unixEpochNanoFilter", UnixEpochNanoFilter, []string{"nano_col"},
			"nano_col >= 1783072800000000000 AND nano_col <= 1783094400000000000"},
		{"unixEpochNanoFrom", UnixEpochNanoFrom, nil, "1783072800000000000"},
		{"unixEpochNanoTo", UnixEpochNanoTo, nil, "1783094400000000000"},
		{"unixEpochGroupAlias", UnixEpochGroupAlias, []string{"epoch_col", "1m"},
			`FLOOR(epoch_col/60)*60 AS "time"`},
		{"time", Time, []string{`"ts"`}, `"ts" AS "time"`},
		{"timeEpoch", TimeEpoch, []string{`"ts"`}, `EXTRACT(EPOCH FROM "ts") AS "time"`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := tc.macro(testQuery(""), tc.args)
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}

	t.Run("column macros reject the wrong arity", func(t *testing.T) {
		for _, macro := range []sqlutil.MacroFunc{Time, TimeEpoch, UnixEpochFilter, UnixEpochNanoFilter} {
			_, err := macro(testQuery(""), []string{"a", "b"})
			assert.ErrorIs(t, err, sqlutil.ErrorBadArgumentCount)
		}
	})
}

func TestConditionalAll(t *testing.T) {
	t.Run("keeps the condition when the variable resolved to a concrete value", func(t *testing.T) {
		// Grafana substituted $loc before the query reached the backend
		got, err := ConditionalAll(testQuery(""), []string{"location IN ('Berlin')", "'Berlin'"})
		require.NoError(t, err)
		assert.Equal(t, "location IN ('Berlin')", got)
	})

	t.Run("drops to 1=1 when the variable is still unexpanded (alerting)", func(t *testing.T) {
		got, err := ConditionalAll(testQuery(""), []string{"location IN ($loc)", "$loc"})
		require.NoError(t, err)
		assert.Equal(t, "1=1", got)
	})

	t.Run("drops to 1=1 for an empty variable", func(t *testing.T) {
		got, err := ConditionalAll(testQuery(""), []string{"location IN ('x')", ""})
		require.NoError(t, err)
		assert.Equal(t, "1=1", got)
	})

	t.Run("keeps the condition when the resolved value merely contains a dollar sign", func(t *testing.T) {
		// a currency value like $100 is a concrete selection, not an unexpanded token
		got, err := ConditionalAll(testQuery(""), []string{"price = '$100'", "'$100'"})
		require.NoError(t, err)
		assert.Equal(t, "price = '$100'", got)
	})

	t.Run("wrong arg count", func(t *testing.T) {
		_, err := ConditionalAll(testQuery(""), []string{"only one"})
		assert.ErrorIs(t, err, sqlutil.ErrorBadArgumentCount)
	})

	t.Run("expands through the interpolation engine on the alerting path", func(t *testing.T) {
		query := testQuery("SELECT * FROM t WHERE $__conditionalAll(location IN ($loc), $loc)")
		interpolated, err := sqlutil.Interpolate(query, Macros)
		require.NoError(t, err)
		assert.Equal(t, "SELECT * FROM t WHERE 1=1", interpolated)
	})
}

// TestInterpolateDefaultTemplate runs the macro engine over the default query template.
func TestInterpolateDefaultTemplate(t *testing.T) {
	query := testQuery(`SELECT
  $__timeGroupAlias("ts", 1m),
  count(*) AS value
FROM "doc"."demo_metrics"
WHERE $__timeFilter("ts")
GROUP BY 1
ORDER BY 1`)

	interpolated, err := sqlutil.Interpolate(query, Macros)
	require.NoError(t, err)
	assert.Contains(t, interpolated, `DATE_BIN('60 seconds'::INTERVAL, "ts", 0) AS "time"`)
	assert.Contains(t, interpolated, `"ts" >= '2026-07-03T10:00:00.000Z' AND "ts" <= '2026-07-03T16:00:00.000Z'`)
	assert.NotContains(t, interpolated, "$__")
}
