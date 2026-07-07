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
	got, err := TimeFilter(testQuery(""), []string{`"ts"`})
	require.NoError(t, err)
	assert.Equal(t, `"ts" >= '2026-07-03T10:00:00Z' AND "ts" <= '2026-07-03T16:00:00Z'`, got)
}

func TestTimeFromTo(t *testing.T) {
	from, err := TimeFrom(testQuery(""), nil)
	require.NoError(t, err)
	assert.Equal(t, `'2026-07-03T10:00:00Z'`, from)

	to, err := TimeTo(testQuery(""), nil)
	require.NoError(t, err)
	assert.Equal(t, `'2026-07-03T16:00:00Z'`, to)
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
		// Backend-only paths (alerting) never run frontend template
		// interpolation, so the literal survives into the macro args.
		got, err := TimeGroup(testQuery(""), []string{`"ts"`, "$__interval"})
		require.NoError(t, err)
		assert.Equal(t, `DATE_BIN('60 seconds'::INTERVAL, "ts", 0)`, got)
	})

	t.Run("wrong arg count", func(t *testing.T) {
		_, err := TimeGroup(testQuery(""), []string{`"ts"`})
		assert.ErrorIs(t, err, sqlutil.ErrorBadArgumentCount)
	})
}

func TestUnixEpochMacros(t *testing.T) {
	got, err := UnixEpochFilter(testQuery(""), []string{"epoch_col"})
	require.NoError(t, err)
	assert.Equal(t, "epoch_col >= 1783072800 AND epoch_col <= 1783094400", got)

	got, err = UnixEpochGroupAlias(testQuery(""), []string{"epoch_col", "1m"})
	require.NoError(t, err)
	assert.Equal(t, `FLOOR(epoch_col/60)*60 AS "time"`, got)
}

// TestInterpolateDefaultTemplate runs the full macro engine over the default
// query template the frontend ships, proving the round trip end to end.
func TestInterpolateDefaultTemplate(t *testing.T) {
	query := testQuery(`SELECT
  $__timeGroupAlias("ts", 1m),
  count(*) AS value
FROM "doc"."my_table"
WHERE $__timeFilter("ts")
GROUP BY 1
ORDER BY 1`)

	interpolated, err := sqlutil.Interpolate(query, Macros)
	require.NoError(t, err)
	assert.Contains(t, interpolated, `DATE_BIN('60 seconds'::INTERVAL, "ts", 0) AS "time"`)
	assert.Contains(t, interpolated, `"ts" >= '2026-07-03T10:00:00Z' AND "ts" <= '2026-07-03T16:00:00Z'`)
	assert.NotContains(t, interpolated, "$__")
}
