//go:build integration

// Integration test against a real CrateDB instance via testcontainers-go.
// Excluded from the default `go test ./...` run; execute with:
//
//	go test -tags=integration ./pkg/plugin/
//
// SPIKE(S6): this test is part of the spike verification; it has not been
// run yet in the paper-skeleton phase.
package plugin

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/data/sqlutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/crate/cratedb-grafana-datasource/pkg/macros"
)

const crateImage = "crate/crate:latest"

func startCrateDB(t *testing.T) (testcontainers.Container, string) {
	t.Helper()
	ctx := context.Background()

	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        crateImage,
			ExposedPorts: []string{"4200/tcp", "5432/tcp"},
			Cmd:          []string{"crate", "-Cdiscovery.type=single-node"},
			WaitingFor:   wait.ForHTTP("/").WithPort("4200/tcp").WithStartupTimeout(2 * time.Minute),
		},
		Started: true,
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = container.Terminate(ctx) })

	host, err := container.Host(ctx)
	require.NoError(t, err)
	port, err := container.MappedPort(ctx, "5432/tcp")
	require.NoError(t, err)

	return container, fmt.Sprintf(`{"server": "%s", "port": %d}`, host, port.Int())
}

func TestIntegration(t *testing.T) {
	_, jsonData := startCrateDB(t)
	ctx := context.Background()

	driver := &CrateDB{}
	db, err := driver.Connect(ctx, backend.DataSourceInstanceSettings{
		JSONData: []byte(jsonData),
	}, nil)
	require.NoError(t, err)
	defer func() { _ = db.Close() }()

	t.Run("connects and pings", func(t *testing.T) {
		require.NoError(t, db.PingContext(ctx))
	})

	t.Run("runs the interpolated default template", func(t *testing.T) {
		_, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS doc.metrics
			(ts TIMESTAMPTZ, location TEXT, value DOUBLE PRECISION)`)
		require.NoError(t, err)
		_, err = db.ExecContext(ctx,
			`INSERT INTO doc.metrics (ts, location, value) VALUES (now(), 'test', 42.0)`)
		require.NoError(t, err)
		_, err = db.ExecContext(ctx, `REFRESH TABLE doc.metrics`)
		require.NoError(t, err)

		query := &sqlutil.Query{
			RawSQL: `SELECT $__timeGroupAlias("ts", 1m), count(*) AS value
				FROM "doc"."metrics" WHERE $__timeFilter("ts") GROUP BY 1 ORDER BY 1`,
			Interval: time.Minute,
			TimeRange: backend.TimeRange{
				From: time.Now().Add(-time.Hour),
				To:   time.Now().Add(time.Hour),
			},
		}
		interpolated, err := sqlutil.Interpolate(query, macros.Macros)
		require.NoError(t, err)

		rows, err := db.QueryContext(ctx, interpolated)
		require.NoError(t, err)
		defer func() { _ = rows.Close() }()
		assert.True(t, rows.Next(), "expected at least one bucket row")
	})

	t.Run("completable introspection", func(t *testing.T) {
		schemas, err := driver.Schemas(ctx, nil)
		require.NoError(t, err)
		assert.Contains(t, schemas, "doc")
		assert.Contains(t, schemas, "sys")

		tables, err := driver.Tables(ctx, map[string]string{"schema": "doc"})
		require.NoError(t, err)
		assert.Contains(t, tables, "metrics")

		columns, err := driver.Columns(ctx, map[string]string{"schema": "doc", "table": "metrics"})
		require.NoError(t, err)
		assert.Equal(t, []string{"ts", "location", "value"}, columns)
	})
}
