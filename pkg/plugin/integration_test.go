//go:build integration

// In-process driver test against a real CrateDB via testcontainers-go: connect,
// interpolate the default query template, and read the result back — no Grafana
// and no built dist/ (the deployed-plugin path is covered by e2e_test.go).
// Excluded from the default `go test ./...` run; execute with:
//
//	go test -tags=integration ./pkg/plugin/
//
// On ARM hosts set CRATEDB_IMAGE=crate/crate:nightly (release tags are amd64-only).
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

func startCrateDB(t *testing.T) (testcontainers.Container, string) {
	t.Helper()
	ctx := context.Background()

	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        crateImage(),
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

	return container, fmt.Sprintf(`{"server": "%s", "port": %d}`, host, port.Num())
}

func TestIntegrationDriverRoundTrip(t *testing.T) {
	_, jsonData := startCrateDB(t)
	ctx := context.Background()

	driver := &CrateDB{}
	db, err := driver.Connect(ctx, backend.DataSourceInstanceSettings{
		JSONData: []byte(jsonData),
	}, nil)
	require.NoError(t, err)
	defer func() { _ = db.Close() }()

	_, err = db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS doc.metrics
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
}

func TestIntegrationAdHocKeys(t *testing.T) {
	_, jsonData := startCrateDB(t)
	ctx := context.Background()

	driver := &CrateDB{}
	db, err := driver.Connect(ctx, backend.DataSourceInstanceSettings{
		JSONData: []byte(jsonData),
	}, nil)
	require.NoError(t, err)
	defer func() { _ = db.Close() }()

	_, err = db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS doc.adhoc_types (
		ts TIMESTAMPTZ,
		location TEXT,
		reading DOUBLE PRECISION,
		tags OBJECT AS (source TEXT),
		position GEO_POINT,
		area GEO_SHAPE,
		samples ARRAY(DOUBLE PRECISION)
	)`)
	require.NoError(t, err)

	keys, err := driver.AdHocKeys(ctx, "doc")
	require.NoError(t, err)

	assert.Contains(t, keys, "adhoc_types.ts")
	assert.Contains(t, keys, "adhoc_types.location")
	assert.Contains(t, keys, "adhoc_types.reading")
	// OBJECT sub-columns carry their primitive data_type and stay filterable
	assert.Contains(t, keys, "adhoc_types.tags['source']")
	// containers can't back an equality/IN filter
	assert.NotContains(t, keys, "adhoc_types.tags")
	assert.NotContains(t, keys, "adhoc_types.position")
	assert.NotContains(t, keys, "adhoc_types.area")
	assert.NotContains(t, keys, "adhoc_types.samples")

	// empty schema falls back to the datasource default
	fallback, err := driver.AdHocKeys(ctx, "")
	require.NoError(t, err)
	assert.Equal(t, keys, fallback)
}
