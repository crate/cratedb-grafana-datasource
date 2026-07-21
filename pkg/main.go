package main

import (
	"context"
	"encoding/json"
	"net/http"
	"os"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/datasource"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/grafana-plugin-sdk-go/backend/tracing"
	"github.com/grafana/grafana-plugin-sdk-go/data/sqlutil"
	"github.com/grafana/sqlds/v5"
	"go.opentelemetry.io/otel/attribute"

	"github.com/crate/cratedb-grafana-datasource/pkg/macros"
	"github.com/crate/cratedb-grafana-datasource/pkg/plugin"
)

func main() {
	// TracingOpts enables OpenTelemetry when Grafana passes OTLP config.
	opts := datasource.ManageOpts{
		TracingOpts: tracing.Opts{
			CustomAttributes: []attribute.KeyValue{
				attribute.String("datasource.type", "cratedb"),
			},
		},
	}
	if err := datasource.Manage(plugin.PluginID, newDatasource, opts); err != nil {
		log.DefaultLogger.Error(err.Error())
		os.Exit(1)
	}
}

func newDatasource(ctx context.Context, settings backend.DataSourceInstanceSettings) (instancemgmt.Instance, error) {
	driver := &plugin.CrateDB{}
	ds := sqlds.NewDatasource(driver)
	// wiring Completable enables the autocomplete resource routes
	ds.Completable = driver
	// type-aware ad-hoc filter keys (see pkg/plugin/adhoc.go)
	ds.CustomRoutes = map[string]func(http.ResponseWriter, *http.Request){
		"/adhoc-keys": driver.HandleAdHocKeys,
	}
	// classified connect+ping, so config-page failures are actionable
	ds.PreCheckHealth = driver.PreCheckHealth
	ds.EnableRowLimit = true
	// the trailing-comma shorthand runs before macro interpolation
	interpolate := ds.Interpolator
	ds.Interpolator = func(ctx context.Context, query *sqlutil.Query, rawJSON json.RawMessage) (string, error) {
		query.RawSQL = macros.RewriteTrailingTimeGroup(query.RawSQL)
		return interpolate(ctx, query, rawJSON)
	}
	return ds.NewDatasource(ctx, settings)
}
