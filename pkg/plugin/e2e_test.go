//go:build e2e

// End-to-end test of the deployed plugin: Grafana loads the unsigned plugin from
// dist/, spawns the compiled binary, and serves queries and autocomplete over HTTP.
//
// Two modes:
//   - hermetic (default): boots CrateDB + Grafana via testcontainers with dist/
//     and provisioning/ mounted. needs a built dist/ (make build). ARM hosts need
//     CRATEDB_IMAGE=crate/crate:nightly (make e2e sets this).
//   - attached: set GRAFANA_URL (and optionally CRATEDB_URL) to run against an
//     already-running compose stack:
//     GRAFANA_URL=http://localhost:3000 go test -tags=e2e ./pkg/plugin/
//
// Not covered: alert-rule evaluation (the backend $__interval path it needs IS
// covered below), the TLS matrix (needs an SSL CrateDB), and Monaco rendering
// (see tests/smoke/).
package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/moby/moby/api/types/container"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/network"
	"github.com/testcontainers/testcontainers-go/wait"
)

const (
	e2eDatasourceUID = "cratedb-dev" // provisioned by provisioning/datasources/cratedb.yaml
	e2eFixture       = "doc.e2e_probe"
)

type e2eEnv struct {
	grafanaURL string
	cratedbURL string
}

func grafanaImage() string {
	if img := os.Getenv("GRAFANA_IMAGE"); img != "" {
		return img
	}
	return "grafana/grafana:latest"
}

// setupEnv returns an attached environment when GRAFANA_URL is set, and
// otherwise boots the full stack hermetically via testcontainers.
func setupEnv(t *testing.T) e2eEnv {
	t.Helper()

	if grafanaURL := os.Getenv("GRAFANA_URL"); grafanaURL != "" {
		cratedbURL := os.Getenv("CRATEDB_URL")
		if cratedbURL == "" {
			cratedbURL = "http://localhost:4200"
		}
		t.Logf("attached mode: grafana=%s cratedb=%s", grafanaURL, cratedbURL)
		return e2eEnv{grafanaURL: grafanaURL, cratedbURL: cratedbURL}
	}

	repoRoot, err := filepath.Abs("../..")
	require.NoError(t, err)
	distDir := filepath.Join(repoRoot, "dist")
	if _, err := os.Stat(filepath.Join(distDir, "plugin.json")); err != nil {
		t.Fatalf("dist/ is not a built plugin (%v); run `make build` first", err)
	}

	ctx := context.Background()

	net, err := network.New(ctx)
	require.NoError(t, err)
	t.Cleanup(func() { _ = net.Remove(ctx) })

	crate, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        crateImage(),
			ExposedPorts: []string{"4200/tcp"},
			Cmd:          []string{"crate", "-Cdiscovery.type=single-node"},
			Networks:     []string{net.Name},
			// provisioned datasource points at server "cratedb", the compose service name
			NetworkAliases: map[string][]string{net.Name: {"cratedb"}},
			WaitingFor:     wait.ForHTTP("/").WithPort("4200/tcp").WithStartupTimeout(2 * time.Minute),
		},
		Started: true,
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = crate.Terminate(ctx) })

	grafana, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        grafanaImage(),
			ExposedPorts: []string{"3000/tcp"},
			Networks:     []string{net.Name},
			Env: map[string]string{
				"GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS": PluginID,
				"GF_SECURITY_ADMIN_PASSWORD":                "admin",
			},
			HostConfigModifier: func(hc *container.HostConfig) {
				hc.Binds = append(hc.Binds,
					distDir+":/var/lib/grafana/plugins/"+PluginID,
					filepath.Join(repoRoot, "provisioning")+":/etc/grafana/provisioning",
				)
			},
			WaitingFor: wait.ForHTTP("/api/health").WithPort("3000/tcp").WithStartupTimeout(2 * time.Minute),
		},
		Started: true,
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = grafana.Terminate(ctx) })

	grafanaHost, err := grafana.Host(ctx)
	require.NoError(t, err)
	grafanaPort, err := grafana.MappedPort(ctx, "3000/tcp")
	require.NoError(t, err)
	crateHost, err := crate.Host(ctx)
	require.NoError(t, err)
	cratePort, err := crate.MappedPort(ctx, "4200/tcp")
	require.NoError(t, err)

	return e2eEnv{
		grafanaURL: fmt.Sprintf("http://%s:%d", grafanaHost, grafanaPort.Num()),
		cratedbURL: fmt.Sprintf("http://%s:%d", crateHost, cratePort.Num()),
	}
}

func (e e2eEnv) grafana(t *testing.T, method, path string, body any, out any) int {
	t.Helper()
	var payload []byte
	if body != nil {
		var err error
		payload, err = json.Marshal(body)
		require.NoError(t, err)
	}
	req, err := http.NewRequest(method, e.grafanaURL+path, bytes.NewReader(payload))
	require.NoError(t, err)
	req.SetBasicAuth("admin", "admin") // Grafana >=13: anonymous is Viewer-only
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()
	if out != nil {
		require.NoError(t, json.NewDecoder(resp.Body).Decode(out))
	}
	return resp.StatusCode
}

func (e e2eEnv) crateSQL(t *testing.T, stmt string) {
	t.Helper()
	payload, err := json.Marshal(map[string]string{"stmt": stmt})
	require.NoError(t, err)
	resp, err := http.Post(e.cratedbURL+"/_sql", "application/json", bytes.NewReader(payload))
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()
	require.Equal(t, http.StatusOK, resp.StatusCode, "CrateDB _sql failed: %s", stmt)
}

// dsQueryResult mirrors the dataframe JSON of /api/ds/query.
type dsQueryResult struct {
	Error  string `json:"error"`
	Frames []struct {
		Schema struct {
			Meta struct {
				ExecutedQueryString    string `json:"executedQueryString"`
				PreferredVisualization string `json:"preferredVisualisationType"`
			} `json:"meta"`
			Fields []struct {
				Name     string `json:"name"`
				TypeInfo struct {
					Frame string `json:"frame"`
				} `json:"typeInfo"`
			} `json:"fields"`
		} `json:"schema"`
		Data struct {
			Values [][]any `json:"values"`
		} `json:"data"`
	} `json:"frames"`
}

func (e e2eEnv) dsQuery(t *testing.T, rawSQL string, format int, extra map[string]any) dsQueryResult {
	t.Helper()
	query := map[string]any{
		"refId":      "A",
		"datasource": map[string]string{"uid": e2eDatasourceUID},
		"rawSql":     rawSQL,
		"format":     format,
	}
	for k, v := range extra {
		query[k] = v
	}
	var out struct {
		Results map[string]dsQueryResult `json:"results"`
	}
	e.grafana(t, "POST", "/api/ds/query", map[string]any{
		"queries": []any{query}, "from": "now-1h", "to": "now",
	}, &out)
	return out.Results["A"]
}

func (e e2eEnv) resource(t *testing.T, route string, body map[string]string) []string {
	t.Helper()
	// decode into json.RawMessage first so a JSON null is distinguishable from an empty list
	var raw json.RawMessage
	e.grafana(t, "POST", fmt.Sprintf("/api/datasources/uid/%s/resources/%s", e2eDatasourceUID, route), body, &raw)
	if string(raw) == "null" {
		return nil // nil, not []string{}: the caller asserts on this
	}
	var out []string
	require.NoError(t, json.Unmarshal(raw, &out))
	return out
}

func fieldTypes(r dsQueryResult) map[string]string {
	types := map[string]string{}
	for _, f := range r.Frames[0].Schema.Fields {
		types[f.Name] = f.TypeInfo.Frame
	}
	return types
}

func fieldNames(r dsQueryResult) []string {
	names := []string{}
	for _, f := range r.Frames[0].Schema.Fields {
		names = append(names, f.Name)
	}
	return names
}

func TestE2E(t *testing.T) {
	e := setupEnv(t)

	t.Run("grafana reachable", func(t *testing.T) {
		var health struct {
			Database string `json:"database"`
		}
		status := e.grafana(t, "GET", "/api/health", nil, &health)
		require.Equal(t, http.StatusOK, status)
		assert.Equal(t, "ok", health.Database)
	})

	t.Run("plugin registered", func(t *testing.T) {
		// /api/plugins/<id> is 404 in Grafana >=13; the settings endpoint remains.
		var plugin struct {
			ID string `json:"id"`
		}
		status := e.grafana(t, "GET", "/api/plugins/"+PluginID+"/settings", nil, &plugin)
		require.Equal(t, http.StatusOK, status)
		assert.Equal(t, PluginID, plugin.ID)
	})

	t.Run("datasource provisioned", func(t *testing.T) {
		var ds struct {
			Type string `json:"type"`
		}
		status := e.grafana(t, "GET", "/api/datasources/uid/"+e2eDatasourceUID, nil, &ds)
		require.Equal(t, http.StatusOK, status)
		assert.Equal(t, PluginID, ds.Type)
	})

	t.Run("datasource health", func(t *testing.T) {
		var h struct {
			Status  string `json:"status"`
			Message string `json:"message"`
		}
		status := e.grafana(t, "GET", "/api/datasources/uid/"+e2eDatasourceUID+"/health", nil, &h)
		require.Equal(t, http.StatusOK, status)
		assert.Equal(t, "OK", h.Status, h.Message)
	})

	// Fixture for the query and autocomplete checks.
	e.crateSQL(t, "DROP TABLE IF EXISTS "+e2eFixture)
	e.crateSQL(t, "CREATE TABLE "+e2eFixture+" (ts TIMESTAMPTZ, location TEXT, value DOUBLE PRECISION, tags OBJECT)")
	e.crateSQL(t, "INSERT INTO "+e2eFixture+" SELECT now() - (n || ' minutes')::INTERVAL,"+
		" 'loc-' || (n % 2), n * 1.5, {source='e2e'} FROM generate_series(1, 30) AS n")
	e.crateSQL(t, "REFRESH TABLE "+e2eFixture)
	t.Cleanup(func() { e.crateSQL(t, "DROP TABLE IF EXISTS "+e2eFixture) })

	t.Run("table query, frame types, OBJECT as structured JSON", func(t *testing.T) {
		result := e.dsQuery(t, "SELECT * FROM "+e2eFixture+" ORDER BY ts LIMIT 5", 1, nil)
		require.Empty(t, result.Error)
		types := fieldTypes(result)
		assert.Equal(t, "time.Time", types["ts"])
		assert.Equal(t, "float64", types["value"])
		assert.Equal(t, "json.RawMessage", types["tags"])

		tagsIdx := -1
		for i, name := range fieldNames(result) {
			if name == "tags" {
				tagsIdx = i
			}
		}
		require.GreaterOrEqual(t, tagsIdx, 0)
		// a JSON field's values arrive inline in the frame JSON, not as strings
		assert.Equal(t, map[string]any{"source": "e2e"}, result.Frames[0].Data.Values[tagsIdx][0])
	})

	t.Run("logs format stamps the logs visualization", func(t *testing.T) {
		// format 2 = sqlutil.FormatOptionLogs; sqlds sets the frame meta, and
		// the aliases follow the column conventions Grafana's logs panel detects
		result := e.dsQuery(t, `SELECT "ts" AS time, location AS body, 'info' AS level FROM `+
			e2eFixture+` ORDER BY "ts" DESC LIMIT 10`, 2, nil)
		require.Empty(t, result.Error)
		assert.Equal(t, "logs", result.Frames[0].Schema.Meta.PreferredVisualization)
		assert.Equal(t, []string{"time", "body", "level"}, fieldNames(result))
		types := fieldTypes(result)
		assert.Equal(t, "time.Time", types["time"])
		assert.Equal(t, "string", types["body"])
	})

	t.Run("time-series frame shape", func(t *testing.T) {
		result := e.dsQuery(t, `SELECT DATE_BIN('60 seconds'::INTERVAL, "ts", 0) AS "time",`+
			` avg(value) AS value FROM `+e2eFixture+
			` WHERE "ts" >= now() - '1 hour'::INTERVAL GROUP BY 1 ORDER BY 1`, 0, nil)
		require.Empty(t, result.Error)
		assert.Equal(t, []string{"time", "value"}, fieldNames(result)[:2])
	})

	t.Run("literal $__interval expands backend-side", func(t *testing.T) {
		// alerting path: no frontend templateSrv runs
		result := e.dsQuery(t, `SELECT $__timeGroupAlias("ts", $__interval), avg(value) AS value`+
			` FROM `+e2eFixture+` WHERE $__timeFilter("ts") GROUP BY 1 ORDER BY 1`,
			0, map[string]any{"intervalMs": 60000, "maxDataPoints": 100})
		require.Empty(t, result.Error)
		// the inspector's "executed query" is the fully interpolated SQL: both
		// the group macro and the time filter appear expanded
		executed := result.Frames[0].Schema.Meta.ExecutedQueryString
		assert.Contains(t, executed, "DATE_BIN('60 seconds'", executed)
		assert.Regexp(t, `"ts" >= '\d{4}-\d{2}-\d{2}T.* AND "ts" <= '`, executed)
		assert.NotContains(t, executed, "$__", executed)
	})

	t.Run("$__timeGroup with trailing comma gets the time alias", func(t *testing.T) {
		result := e.dsQuery(t, `SELECT $__timeGroup("ts", $__interval), avg(value) AS value`+
			` FROM `+e2eFixture+` WHERE $__timeFilter("ts") GROUP BY 1 ORDER BY 1`,
			0, map[string]any{"intervalMs": 60000, "maxDataPoints": 100})
		require.Empty(t, result.Error)
		assert.Contains(t, result.Frames[0].Schema.Meta.ExecutedQueryString, `AS "time"`)
		assert.Equal(t, []string{"time", "value"}, fieldNames(result)[:2])
	})

	t.Run("EXPLAIN returns the plan as a table", func(t *testing.T) {
		for _, stmt := range []string{"EXPLAIN", "EXPLAIN ANALYZE"} {
			result := e.dsQuery(t, stmt+` SELECT * FROM `+e2eFixture+` WHERE $__timeFilter("ts")`, 1, nil)
			require.Empty(t, result.Error, stmt)
			require.NotEmpty(t, result.Frames, stmt)
			require.NotEmpty(t, result.Frames[0].Schema.Fields, stmt)
		}
	})

	t.Run("autocomplete resource routes", func(t *testing.T) {
		schemas := e.resource(t, "schemas", map[string]string{})
		assert.Contains(t, schemas, "doc")
		assert.Contains(t, schemas, "sys")
		for _, hidden := range []string{"information_schema", "pg_catalog", "blob"} {
			assert.NotContains(t, schemas, hidden)
		}

		tables := e.resource(t, "tables", map[string]string{}) // default-schema fallback
		assert.Contains(t, tables, "e2e_probe")

		sysTables := e.resource(t, "tables", map[string]string{"schema": "sys"})
		assert.Contains(t, sysTables, "nodes")

		// CrateDB lists OBJECT sub-columns as their own rows (tags['source']), directly queryable
		columns := e.resource(t, "columns", map[string]string{"schema": "doc", "table": "e2e_probe"})
		assert.Equal(t, []string{"ts", "location", "value", "tags", "tags['source']"}, columns)

		// empty must be [], not JSON null (a nil slice would crash the frontend's .map())
		empty := e.resource(t, "columns", map[string]string{"schema": "doc", "table": "no_such_table"})
		require.NotNil(t, empty, "empty column list must marshal as [], not null")
		assert.Empty(t, empty)
	})

	t.Run("adhoc-keys resource route is type-aware", func(t *testing.T) {
		keys := e.resource(t, "adhoc-keys", map[string]string{})
		assert.Contains(t, keys, "e2e_probe.location")
		// the OBJECT container is excluded, its primitive sub-column stays
		assert.Contains(t, keys, "e2e_probe.tags['source']")
		assert.NotContains(t, keys, "e2e_probe.tags")
	})
}
