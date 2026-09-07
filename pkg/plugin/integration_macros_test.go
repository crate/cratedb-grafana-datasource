//go:build integration

// Macro expansion checked against a real CrateDB: the SQL each macro emits has
// to parse and return the column types the response step assumes. Run with:
//
//	go test -tags=integration ./pkg/plugin/
package plugin

import (
	"context"
	"database/sql"
	"encoding/json"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/data"
	"github.com/grafana/grafana-plugin-sdk-go/data/sqlutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/crate/cratedb-grafana-datasource/pkg/macros"
)

// queryFrame walks one query through the stages sqlds drives: plan, rewrite,
// interpolate, execute, frame, mutate.
func queryFrame(ctx context.Context, t *testing.T, db *sql.DB, rawSQL string, timeRange backend.TimeRange) *data.Frame {
	t.Helper()
	driver := &CrateDB{}

	body, err := json.Marshal(struct {
		RawSQL string                    `json:"rawSql"`
		Format sqlutil.FormatQueryOption `json:"format"`
	}{rawSQL, sqlutil.FormatOptionTimeSeries})
	require.NoError(t, err)

	planCtx, req := driver.MutateQueryData(ctx, &backend.QueryDataRequest{
		Queries: []backend.DataQuery{{
			RefID:     "A",
			JSON:      body,
			Interval:  time.Minute,
			TimeRange: timeRange,
		}},
	})

	query, err := sqlutil.GetQuery(req.Queries[0])
	require.NoError(t, err)
	query.RawSQL = macros.RewriteTrailingTimeGroup(query.RawSQL)
	interpolated, err := sqlutil.Interpolate(query, driver.Macros())
	require.NoError(t, err)

	rows, err := db.QueryContext(ctx, interpolated)
	require.NoError(t, err, interpolated)
	defer func() { _ = rows.Close() }()

	frame, err := sqlutil.FrameFromRows(rows, -1, driver.Converters()...)
	require.NoError(t, err)
	frame.Name = "A"

	frames, err := driver.MutateResponse(planCtx, data.Frames{frame})
	require.NoError(t, err)
	require.Len(t, frames, 1)
	return frames[0]
}

func TestIntegrationTimeGroupFillsEmptyBuckets(t *testing.T) {
	_, jsonData := startCrateDB(t)
	ctx := context.Background()

	driver := &CrateDB{}
	db, err := driver.Connect(ctx, backend.DataSourceInstanceSettings{JSONData: []byte(jsonData)}, nil)
	require.NoError(t, err)
	defer func() { _ = db.Close() }()

	_, err = db.ExecContext(ctx, `CREATE TABLE doc.sparse (ts TIMESTAMPTZ)`)
	require.NoError(t, err)

	// two of the five one-minute buckets carry a row
	start := time.Now().UTC().Truncate(time.Minute).Add(-10 * time.Minute)
	for _, offset := range []int{0, 3} {
		_, err = db.ExecContext(ctx, `INSERT INTO doc.sparse (ts) VALUES (?)`,
			start.Add(time.Duration(offset)*time.Minute))
		require.NoError(t, err)
	}
	_, err = db.ExecContext(ctx, `REFRESH TABLE doc.sparse`)
	require.NoError(t, err)

	frame := queryFrame(ctx, t, db, `SELECT $__timeGroupAlias("ts", '1m', 0), count(*) AS "value"
		FROM doc.sparse WHERE $__timeFilter("ts") GROUP BY 1 ORDER BY 1`,
		backend.TimeRange{From: start, To: start.Add(5*time.Minute - time.Millisecond)})

	rows, err := frame.RowLen()
	require.NoError(t, err)
	require.Equal(t, 5, rows)

	counts := make([]int64, 0, rows)
	for row := 0; row < rows; row++ {
		at, ok := frame.ConcreteAt(0, row)
		require.True(t, ok)
		assert.Equal(t, start.Add(time.Duration(row)*time.Minute), at.(time.Time).UTC())

		count, ok := frame.ConcreteAt(1, row)
		require.True(t, ok)
		counts = append(counts, count.(int64))
	}
	assert.Equal(t, []int64{1, 0, 0, 1, 0}, counts)
}

func TestIntegrationEpochMacrosYieldATimeAxis(t *testing.T) {
	_, jsonData := startCrateDB(t)
	ctx := context.Background()

	driver := &CrateDB{}
	db, err := driver.Connect(ctx, backend.DataSourceInstanceSettings{JSONData: []byte(jsonData)}, nil)
	require.NoError(t, err)
	defer func() { _ = db.Close() }()

	_, err = db.ExecContext(ctx, `CREATE TABLE doc.epochs (ts TIMESTAMPTZ, seconds BIGINT, nanos BIGINT)`)
	require.NoError(t, err)

	stamp := time.Now().UTC().Truncate(time.Minute).Add(-time.Minute)
	_, err = db.ExecContext(ctx, `INSERT INTO doc.epochs (ts, seconds, nanos) VALUES (?, ?, ?)`,
		stamp, stamp.Unix(), stamp.UnixNano())
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `REFRESH TABLE doc.epochs`)
	require.NoError(t, err)

	timeRange := backend.TimeRange{From: stamp.Add(-time.Hour), To: stamp.Add(time.Hour)}

	cases := []struct {
		name string
		sql  string
	}{
		{
			"timeEpoch",
			`SELECT $__timeEpoch("ts"), count(*) AS "value" FROM doc.epochs
				WHERE $__timeFilter("ts") GROUP BY 1 ORDER BY 1`,
		},
		{
			"time",
			`SELECT $__time("ts"), count(*) AS "value" FROM doc.epochs
				WHERE $__timeFilter("ts") GROUP BY 1 ORDER BY 1`,
		},
		{
			"unixEpochGroupAlias",
			`SELECT $__unixEpochGroupAlias("seconds", '1m'), count(*) AS "value" FROM doc.epochs
				WHERE $__unixEpochFilter("seconds") GROUP BY 1 ORDER BY 1`,
		},
		{
			"unixEpochNanoFilter",
			`SELECT $__unixEpochGroupAlias("seconds", '1m'), count(*) AS "value" FROM doc.epochs
				WHERE "nanos" BETWEEN $__unixEpochNanoFrom() AND $__unixEpochNanoTo()
				AND $__unixEpochNanoFilter("nanos") GROUP BY 1 ORDER BY 1`,
		},
		{
			"millisecond column",
			`SELECT "ts"::bigint AS "time", count(*) AS "value" FROM doc.epochs
				WHERE $__timeFilter("ts") GROUP BY 1 ORDER BY 1`,
		},
		{
			"nanosecond column",
			`SELECT "nanos" AS "time", count(*) AS "value" FROM doc.epochs
				WHERE $__unixEpochNanoFilter("nanos") GROUP BY 1 ORDER BY 1`,
		},
		{
			"unixEpoch bounds",
			`SELECT $__time("ts"), count(*) AS "value" FROM doc.epochs
				WHERE "seconds" BETWEEN $__unixEpochFrom() AND $__unixEpochTo() GROUP BY 1 ORDER BY 1`,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			frame := queryFrame(ctx, t, db, tc.sql, timeRange)

			rows, err := frame.RowLen()
			require.NoError(t, err)
			require.Equal(t, 1, rows)
			assert.True(t, frame.Fields[0].Type().Time(), "field type %s", frame.Fields[0].Type())

			at, ok := frame.ConcreteAt(0, 0)
			require.True(t, ok)
			assert.Equal(t, stamp, at.(time.Time).UTC())
		})
	}
}
