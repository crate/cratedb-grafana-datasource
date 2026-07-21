//go:build mage

package main

import (
	// mage:import
	build "github.com/grafana/grafana-plugin-sdk-go/build"
)

// Default builds the backend plugin binaries for all platforms
// (dist/gpx_cratedb_<os>_<arch>).
var Default = build.BuildAll
