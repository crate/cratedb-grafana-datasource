package main

import (
	"context"
	"os"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/datasource"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/sqlds/v5"

	"github.com/crate/cratedb-grafana-datasource/pkg/plugin"
)

func main() {
	if err := datasource.Manage("cratedb-cratedb-datasource", newDatasource, datasource.ManageOpts{}); err != nil {
		log.DefaultLogger.Error(err.Error())
		os.Exit(1)
	}
}

func newDatasource(ctx context.Context, settings backend.DataSourceInstanceSettings) (instancemgmt.Instance, error) {
	driver := &plugin.CrateDB{}
	ds := sqlds.NewDatasource(driver)
	// Completable is an explicit field on SQLDatasource (not auto-asserted
	// like the mutator interfaces); wiring it enables the /schemas, /tables
	// and /columns autocomplete resource routes.
	ds.Completable = driver
	return ds.NewDatasource(ctx, settings)
}
