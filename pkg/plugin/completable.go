package plugin

// sqlds.Completable: powers the /schemas, /tables and /columns autocomplete routes.
// Targets information_schema, not pg_catalog (CrateDB's pg_catalog emulation is partial).

import (
	"context"
	"database/sql"

	"github.com/grafana/grafana-plugin-sdk-go/backend/tracing"
	"github.com/grafana/sqlds/v5"
)

const (
	// sys is kept: cluster-monitoring dashboards query sys.*; only machinery schemas are hidden
	schemasQuery = `SELECT schema_name FROM information_schema.schemata
		WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'blob')
		ORDER BY schema_name`

	tablesQuery = `SELECT table_name FROM information_schema.tables
		WHERE table_schema = $1
		ORDER BY table_name`

	columnsQuery = `SELECT column_name FROM information_schema.columns
		WHERE table_schema = $1 AND table_name = $2
		ORDER BY ordinal_position`
)

// Schemas lists all user-visible schemas.
func (d *CrateDB) Schemas(ctx context.Context, options sqlds.Options) ([]string, error) {
	return d.queryStrings(ctx, schemasQuery)
}

// Tables lists tables of options["schema"], defaulting to the datasource's
// configured default schema.
func (d *CrateDB) Tables(ctx context.Context, options sqlds.Options) ([]string, error) {
	schema := options["schema"]
	if schema == "" {
		schema = d.schema()
	}
	return d.queryStrings(ctx, tablesQuery, schema)
}

// Columns lists columns of options["schema"].options["table"] in table order.
func (d *CrateDB) Columns(ctx context.Context, options sqlds.Options) ([]string, error) {
	schema := options["schema"]
	if schema == "" {
		schema = d.schema()
	}
	return d.queryStrings(ctx, columnsQuery, schema, options["table"])
}

func (d *CrateDB) queryStrings(ctx context.Context, query string, args ...interface{}) ([]string, error) {
	ctx, span := tracing.DefaultTracer().Start(ctx, "cratedb.introspection")
	defer span.End()
	db := d.conn()
	if db == nil {
		return nil, ErrNotConnected
	}
	key := cacheKey(query, args...)
	if cached := d.schemaCache.get(key); cached != nil {
		return cached, nil
	}
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	// non-nil so an empty result marshals as JSON []
	result := []string{}
	for rows.Next() {
		var value sql.NullString
		if err := rows.Scan(&value); err != nil {
			return nil, err
		}
		if value.Valid {
			result = append(result, value.String)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	d.schemaCache.put(key, result)
	return result, nil
}
