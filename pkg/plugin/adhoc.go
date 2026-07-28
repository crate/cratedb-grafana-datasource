package plugin

// /adhoc-keys resource route: the table.column pairs of one schema an ad-hoc filter
// can meaningfully target. Registered via sqlds.CustomRoutes in pkg/main.go.

import (
	"context"
	"encoding/json"
	"net/http"
)

// Container-ish types are excluded: OBJECT/GEO have no equality literal and arrays
// don't compare with =/IN. OBJECT sub-columns (tags['source']) carry their primitive
// data_type and stay included.
const adhocKeysQuery = `SELECT table_name || '.' || column_name FROM information_schema.columns
	WHERE table_schema = $1
	  AND data_type NOT IN ('object', 'geo_point', 'geo_shape')
	  AND data_type NOT LIKE '%_array'
	ORDER BY table_name, ordinal_position`

// AdHocKeys lists the ad-hoc filterable table.column pairs of a schema,
// defaulting to the datasource's configured default schema.
func (d *CrateDB) AdHocKeys(ctx context.Context, schema string) ([]string, error) {
	if schema == "" {
		schema = d.schema()
	}
	return d.queryStrings(ctx, adhocKeysQuery, schema)
}

// HandleAdHocKeys backs the /adhoc-keys resource route. Body: {"schema": "..."}.
func (d *CrateDB) HandleAdHocKeys(rw http.ResponseWriter, req *http.Request) {
	options := map[string]string{}
	if err := json.NewDecoder(req.Body).Decode(&options); err != nil {
		http.Error(rw, err.Error(), http.StatusBadRequest)
		return
	}
	keys, err := d.AdHocKeys(req.Context(), options["schema"])
	if err != nil {
		writeResourceError(rw, err)
		return
	}
	rw.Header().Add("Content-Type", "application/json")
	if err := json.NewEncoder(rw).Encode(keys); err != nil {
		http.Error(rw, err.Error(), http.StatusBadRequest)
	}
}
