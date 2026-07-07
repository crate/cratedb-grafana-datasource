package plugin

// sqlds.Completable implementation: powers the /schemas, /tables and
// /columns resource routes the query editor's autocomplete calls.
//
// The introspection deliberately targets information_schema rather than
// pg_catalog: CrateDB's pg_catalog emulation is partial, while its
// information_schema is first-class. This is also why the plugin does not
// reuse Grafana core's parse_ident()-based postgres meta-queries.

import (
	"context"
	"database/sql"

	"github.com/grafana/sqlds/v5"
)

const (
	// sys is included deliberately: CrateDB cluster-monitoring dashboards
	// are built on sys.* tables. Only machinery schemas are hidden.
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

// Schemas lists all user-visible schemas (including sys).
func (d *CrateDB) Schemas(ctx context.Context, options sqlds.Options) ([]string, error) {
	return d.queryStrings(ctx, schemasQuery)
}

// Tables lists tables of options["schema"], defaulting to the datasource's
// configured default schema.
func (d *CrateDB) Tables(ctx context.Context, options sqlds.Options) ([]string, error) {
	schema := options["schema"]
	if schema == "" {
		schema = d.defaultSchema
	}
	return d.queryStrings(ctx, tablesQuery, schema)
}

// Columns lists columns of options["schema"].options["table"] in table order.
func (d *CrateDB) Columns(ctx context.Context, options sqlds.Options) ([]string, error) {
	schema := options["schema"]
	if schema == "" {
		schema = d.defaultSchema
	}
	return d.queryStrings(ctx, columnsQuery, schema, options["table"])
}

func (d *CrateDB) queryStrings(ctx context.Context, query string, args ...interface{}) ([]string, error) {
	if d.db == nil {
		return nil, ErrorNotConnected
	}
	rows, err := d.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var result []string
	for rows.Next() {
		var value sql.NullString
		if err := rows.Scan(&value); err != nil {
			return nil, err
		}
		if value.Valid {
			result = append(result, value.String)
		}
	}
	return result, rows.Err()
}
