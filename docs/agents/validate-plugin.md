# Validate the plugin

Run from the repo root. This mirrors the gate grafana.com applies on catalog submission, so run it
before tagging a release.

```bash
make validate
```

`make validate` packages `dist/` into `cratedb-cratedb-datasource-<version>.zip` (via `make
package`) and runs `@grafana/plugin-validator@0.44.2` against it with `-sourceCodeUri` pointing at
the working tree. It needs a built `dist/` — run `make build` first if you haven't.

After it runs, summarize the validator output: total errors/warnings, each with its title and
detail, and an actionable fix for each. A leftover `*.zip` is created in the repo root — mention
it and let the user delete it.
