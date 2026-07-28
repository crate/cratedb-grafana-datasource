# Build the plugin

Run from the repo root. The Makefile owns the build logic (mage for the backend, webpack for the
frontend, plus Yarn 4 / mage fallbacks) — call it rather than invoking the tools directly.

```bash
make build
```

This produces `dist/` containing the frontend bundle (`module.js`, `plugin.json`) and the backend
binaries for every platform (`gpx_cratedb_*`). `make build` = `make build-backend` (mage) +
`make build-frontend` (webpack production).

If the build fails, stop and report the error — do not try to hand-roll `webpack`/`mage` around it.

Related: `make dev` (frontend watch), `make lint`, `make check` (lint + unit tests).
