#!/bin/sh
# Builds dist/ from inside the compose stack (see docker/plugin-build.Dockerfile),
# so `docker compose up` on a fresh clone yields a loadable plugin without a host
# Go/Node toolchain.
#
# Only the container's own platform is targeted — Grafana runs in this same
# architecture. `make build` covers all platforms for release.
#
# An existing build is left alone; `make clean` (or deleting dist/) forces a rebuild.
set -eu

if [ -f dist/plugin.json ] && ls dist/gpx_cratedb_linux_* >/dev/null 2>&1; then
  echo "dist/ already holds a built plugin — skipping build"
  exit 0
fi

echo "Building the plugin into dist/ ..."
yarn install --immutable
yarn build
go run github.com/magefile/mage@v1.15.0 -v build:backend

# dist/ is bind-mounted from the host; hand it back to the source tree's owner so
# host tooling can clean it. No-op where the mount virtualizes ownership (macOS).
chown -R "$(stat -c '%u:%g' /src)" dist
