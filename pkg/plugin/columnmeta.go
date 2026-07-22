package plugin

// /column-meta resource route: column names with their CrateDB data types, which
// the query builder needs to pick default time/log columns and shape filter value
// editors. Registered via sqlds.CustomRoutes in pkg/main.go. The names-only
// /columns route stays as sqlds defines it for autocomplete.

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/grafana/grafana-plugin-sdk-go/backend/tracing"
)

const columnMetaQuery = `SELECT column_name, data_type FROM information_schema.columns
	WHERE table_schema = $1 AND table_name = $2
	ORDER BY ordinal_position`

type columnMeta struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

// schemaCache stores flat string slices, so each row is packed into one entry;
// NUL can't occur in an identifier or a type name
const pairSeparator = "\x00"

func encodePair(meta columnMeta) string {
	return meta.Name + pairSeparator + meta.Type
}

func decodePair(encoded string) columnMeta {
	name, typ, _ := strings.Cut(encoded, pairSeparator)
	return columnMeta{Name: name, Type: typ}
}

// ColumnMeta lists the columns of schema.table in table order, with data types,
// defaulting to the datasource's configured default schema.
func (d *CrateDB) ColumnMeta(ctx context.Context, schema, table string) ([]columnMeta, error) {
	if schema == "" {
		schema = d.defaultSchema
	}

	ctx, span := tracing.DefaultTracer().Start(ctx, "cratedb.introspection")
	defer span.End()
	if d.db == nil {
		return nil, ErrNotConnected
	}
	key := cacheKey(columnMetaQuery, schema, table)
	if cached := d.schemaCache.get(key); cached != nil {
		return decodePairs(cached), nil
	}
	rows, err := d.db.QueryContext(ctx, columnMetaQuery, schema, table)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	encoded := []string{}
	for rows.Next() {
		var name, typ sql.NullString
		if err := rows.Scan(&name, &typ); err != nil {
			return nil, err
		}
		if name.Valid {
			encoded = append(encoded, encodePair(columnMeta{Name: name.String, Type: typ.String}))
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	d.schemaCache.put(key, encoded)
	return decodePairs(encoded), nil
}

func decodePairs(encoded []string) []columnMeta {
	// non-nil so an empty result marshals as JSON []
	result := make([]columnMeta, 0, len(encoded))
	for _, entry := range encoded {
		result = append(result, decodePair(entry))
	}
	return result
}

// HandleColumnMeta backs the /column-meta resource route.
// Body: {"schema": "...", "table": "..."}.
func (d *CrateDB) HandleColumnMeta(rw http.ResponseWriter, req *http.Request) {
	options := map[string]string{}
	if err := json.NewDecoder(req.Body).Decode(&options); err != nil {
		http.Error(rw, err.Error(), http.StatusBadRequest)
		return
	}
	meta, err := d.ColumnMeta(req.Context(), options["schema"], options["table"])
	if err != nil {
		http.Error(rw, err.Error(), http.StatusBadRequest)
		return
	}
	rw.Header().Add("Content-Type", "application/json")
	if err := json.NewEncoder(rw).Encode(meta); err != nil {
		http.Error(rw, err.Error(), http.StatusBadRequest)
	}
}
