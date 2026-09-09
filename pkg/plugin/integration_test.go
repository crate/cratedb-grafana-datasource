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
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/data"
	"github.com/grafana/grafana-plugin-sdk-go/data/sqlutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/crate/cratedb-grafana-datasource/pkg/converters"
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

func TestIntegrationFrameTypesAcrossCrateDBTypes(t *testing.T) {
	_, jsonData := startCrateDB(t)
	ctx := context.Background()

	driver := &CrateDB{}
	db, err := driver.Connect(ctx, backend.DataSourceInstanceSettings{
		JSONData: []byte(jsonData),
	}, nil)
	require.NoError(t, err)
	defer func() { _ = db.Close() }()

	_, err = db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS doc.frame_types (
		id INTEGER,
		tags OBJECT AS (source TEXT),
		samples ARRAY(BIGINT),
		counter BIGINT,
		amount NUMERIC(20, 4),
		naive TIMESTAMP WITHOUT TIME ZONE,
		addr IP
	)`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO doc.frame_types
		(id, tags, samples, counter, amount, naive, addr) VALUES
		(1, {source = 'sensor'}, [1, 2], 9007199254740993, 12345.6789, '2026-07-03T12:30:00', '10.0.0.7'),
		(2, NULL, NULL, NULL, NULL, NULL, NULL)`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `REFRESH TABLE doc.frame_types`)
	require.NoError(t, err)

	rows, err := db.QueryContext(ctx,
		`SELECT tags, samples, counter, amount, naive, addr FROM doc.frame_types ORDER BY id`)
	require.NoError(t, err)
	defer func() { _ = rows.Close() }()

	frame, err := sqlutil.FrameFromRows(rows, -1, converters.CrateDBConverters...)
	require.NoError(t, err)
	require.Equal(t, 2, frame.Rows())

	byName := func(name string) *data.Field {
		field, idx := frame.FieldByName(name)
		require.GreaterOrEqual(t, idx, 0, "no field named %s", name)
		return field
	}

	// OBJECT arrives as JSON text and becomes a structured JSON field
	assert.Equal(t, data.FieldTypeJSON, byName("tags").Type())
	assert.JSONEq(t, `{"source":"sensor"}`, string(byName("tags").At(0).(json.RawMessage)))

	// arrays keep their pg text form; panels render them as strings
	assert.Equal(t, data.FieldTypeNullableString, byName("samples").Type())
	assert.Equal(t, `{"1","2"}`, *byName("samples").At(0).(*string))

	// bigints stay exact past 2^53
	assert.Equal(t, data.FieldTypeNullableInt64, byName("counter").Type())
	assert.Equal(t, int64(9007199254740993), *byName("counter").At(0).(*int64))

	assert.Equal(t, data.FieldTypeNullableFloat64, byName("amount").Type())
	assert.InDelta(t, 12345.6789, *byName("amount").At(0).(*float64), 0.0001)

	// a timestamp without time zone is read as UTC
	assert.Equal(t, data.FieldTypeNullableTime, byName("naive").Type())
	assert.Equal(t, time.Date(2026, 7, 3, 12, 30, 0, 0, time.UTC), byName("naive").At(0).(*time.Time).UTC())

	// IP has no pg type of its own and falls through to the string default
	assert.Equal(t, data.FieldTypeNullableString, byName("addr").Type())
	assert.Equal(t, "10.0.0.7", *byName("addr").At(0).(*string))

	for _, field := range frame.Fields {
		if field.Nullable() {
			_, ok := field.ConcreteAt(1)
			assert.False(t, ok, "%s must carry NULL as an empty value", field.Name)
			continue
		}
		// a JSON field is not nullable; NULL reaches it as a nil RawMessage
		assert.Nil(t, field.At(1), "%s must carry NULL as an empty value", field.Name)
	}
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
		samples ARRAY(DOUBLE PRECISION),
		embedding FLOAT_VECTOR(4),
		flags BIT(4)
	)`)
	require.NoError(t, err)

	keys, err := driver.AdHocKeys(ctx, "doc")
	require.NoError(t, err)

	assert.Contains(t, keys, "adhoc_types.ts")
	assert.Contains(t, keys, "adhoc_types.location")
	assert.Contains(t, keys, "adhoc_types.reading")
	// OBJECT sub-columns carry their primitive data_type and stay filterable
	assert.Contains(t, keys, "adhoc_types.tags['source']")
	// containers can't back an equality/IN filter, and neither vectors nor bit
	// strings accept the text literal an ad-hoc value arrives as
	assert.NotContains(t, keys, "adhoc_types.tags")
	assert.NotContains(t, keys, "adhoc_types.position")
	assert.NotContains(t, keys, "adhoc_types.area")
	assert.NotContains(t, keys, "adhoc_types.samples")
	assert.NotContains(t, keys, "adhoc_types.embedding")
	assert.NotContains(t, keys, "adhoc_types.flags")

	// empty schema falls back to the datasource default
	fallback, err := driver.AdHocKeys(ctx, "")
	require.NoError(t, err)
	assert.Equal(t, keys, fallback)
}

func TestIntegrationColumnMeta(t *testing.T) {
	_, jsonData := startCrateDB(t)
	ctx := context.Background()

	driver := &CrateDB{}
	db, err := driver.Connect(ctx, backend.DataSourceInstanceSettings{
		JSONData: []byte(jsonData),
	}, nil)
	require.NoError(t, err)
	defer func() { _ = db.Close() }()

	_, err = db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS doc.meta_types (
		ts TIMESTAMPTZ,
		location TEXT,
		reading DOUBLE PRECISION,
		tags OBJECT AS (source TEXT)
	)`)
	require.NoError(t, err)

	meta, err := driver.ColumnMeta(ctx, "doc", "meta_types")
	require.NoError(t, err)

	assert.Contains(t, meta, columnMeta{Name: "ts", Type: "timestamp with time zone"})
	assert.Contains(t, meta, columnMeta{Name: "location", Type: "text"})
	assert.Contains(t, meta, columnMeta{Name: "reading", Type: "double precision"})
	// OBJECT sub-columns surface with their primitive types
	assert.Contains(t, meta, columnMeta{Name: "tags['source']", Type: "text"})

	// empty schema falls back to the datasource default
	fallback, err := driver.ColumnMeta(ctx, "", "meta_types")
	require.NoError(t, err)
	assert.Equal(t, meta, fallback)
}
