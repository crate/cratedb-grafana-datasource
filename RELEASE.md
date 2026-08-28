# Releasing

The release flow is tag-driven and mostly automated (`.github/workflows/cd.yml`); this
document covers the manual steps around it and how to test the whole pipeline safely.

## TL;DR

```bash
# 1. In a normal PR: bump the version + write the changelog section
#    - package.json "version": "X.Y.Z"        (stamped into plugin.json at build time)
#    - CHANGELOG.md: add the "## X.Y.Z" section
make check-version VERSION=X.Y.Z              # asserts the bump landed
make release-notes VERSION=X.Y.Z              # preview what the release body will be

# 2. After the PR merges:
git tag vX.Y.Z && git push origin vX.Y.Z
```

The tag triggers the release workflow, which:

1. **Verifies** — tag matches `package.json`, full build, integration + e2e tests against a
   real CrateDB and Grafana.
2. **Builds** — `grafana/plugin-actions/build-plugin` produces
   `cratedb-cratedb-datasource-X.Y.Z.zip` (+ `.sha1`, with build attestation). The zip is
   **unsigned**: signing runs only when the `GRAFANA_ACCESS_POLICY_TOKEN` repository secret is
   set, and there is none (see [Distribution](#distribution)).
3. **Validates** — `@grafana/plugin-validator` runs the same checks grafana.com applies on
   submission.
4. **Drafts** — a draft GitHub release with the zip and the tagged CHANGELOG section as notes.

Nothing is published without a human: review the draft release, then publish it.

## Versioning

Semantic versioning. `%VERSION%` and `%TODAY%` in `src/plugin.json` are replaced at build time
from `package.json` — the version lives in exactly one place.

Pre-1.0, minor bumps may include breaking changes; note them prominently in the CHANGELOG.

## Distribution

Releases are unsigned, and Grafana loads an unsigned plugin only where an admin allows the plugin
id explicitly — self-hosted instances, never Grafana Cloud. The README's *Installation* section is
what users follow.

Grafana signs a plugin offered by a for-profit business at the `commercial` level, which carries a
paid Commercial Plugin Subscription ([plugin policy](https://grafana.com/legal/plugins/)). Signing
would also need a [grafana.com](https://grafana.com) organization whose slug matches the plugin id
prefix (`cratedb-`) and an access-policy token with the `plugins:write` scope stored as
`GRAFANA_ACCESS_POLICY_TOKEN`. The tooling is already wired for that day:

```bash
make build
GRAFANA_ACCESS_POLICY_TOKEN=... make sign
make package
```

## Testing the release pipeline on a fork

The workflow can be exercised end to end without touching this repository:

1. Fork the repo and enable GitHub Actions on the fork.
2. Push a tag; with no `GRAFANA_ACCESS_POLICY_TOKEN` secret the fork exercises the same unsigned
   path as a real release.
3. Push a pre-release tag to the fork: `git tag v0.0.1-fork.1 && git push fork v0.0.1-fork.1`.
4. Inspect the draft release on the fork; delete the tag and draft when done.

## Checklist

- [ ] CHANGELOG section exists for the version (`make release-notes VERSION=X.Y.Z` prints it)
- [ ] `make check-version VERSION=X.Y.Z` passes on main
- [ ] CI green on main (including the CrateDB version matrix)
- [ ] `make validate` green locally (the same plugin-validator gate the release workflow runs)
- [ ] Screenshots still match the current UI (`make screenshots` regenerates them)
- [ ] Tag pushed; release workflow green; draft release reviewed and published
