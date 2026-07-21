//go:build integration || e2e

package plugin

import "os"

// crateImage returns the CrateDB image for container-based tests. Override with
// CRATEDB_IMAGE, required on ARM hosts where release tags are amd64-only (the
// Makefile defaults it to crate/crate:nightly there):
//
//	CRATEDB_IMAGE=crate/crate:nightly go test -tags=integration ./pkg/plugin/
func crateImage() string {
	if img := os.Getenv("CRATEDB_IMAGE"); img != "" {
		return img
	}
	return "crate/crate:latest"
}
