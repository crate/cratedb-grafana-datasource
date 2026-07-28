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
2. **Builds and signs** — `grafana/plugin-actions/build-plugin` produces
   `cratedb-cratedb-datasource-X.Y.Z.zip` (+ `.sha1`, with build attestation). Signing uses the
   `GRAFANA_ACCESS_POLICY_TOKEN` repository secret; when the secret is absent the zip is
   packaged **unsigned** (fine for betas, unusable for catalog submission).
3. **Validates** — `@grafana/plugin-validator` runs the same checks grafana.com applies on
   submission.
4. **Drafts** — a draft GitHub release with the zip and the tagged CHANGELOG section as notes.

Nothing is published without a human: review the draft release, then publish it.

## Versioning

Semantic versioning. `%VERSION%` and `%TODAY%` in `src/plugin.json` are replaced at build time
from `package.json` — the version lives in exactly one place.

Pre-1.0, minor bumps may include breaking changes; note them prominently in the CHANGELOG.

## Signing (one-time setup)

Community-plugin signing requires:

1. A [grafana.com](https://grafana.com) organization whose **slug matches the plugin id
   prefix** (`cratedb-`).
2. An access policy token with the `plugins:write` scope, created under that org:
   <https://grafana.com/developers/plugin-tools/publish-a-plugin/sign-a-plugin>
3. The token stored as the `GRAFANA_ACCESS_POLICY_TOKEN` repository secret.

To sign locally instead (e.g. to inspect the signed artifact):

```bash
make build
GRAFANA_ACCESS_POLICY_TOKEN=... make sign
make package
```

## Catalog submission

First release only; updates re-use the same listing.

1. Publish the draft GitHub release so the zip URL is public.
2. Submit at <https://grafana.com/plugins/submit> with the zip URL and its sha1
   (both attached to the release).
3. The review pipeline runs the plugin validator (already green in CI) plus a human review.

Listing content comes from the plugin itself: `src/plugin.json` (description, keywords, links,
screenshots) and the top of `README.md`. Review both before submitting.

## Testing the release pipeline on a fork

The workflow can be exercised end to end without touching this repository:

1. Fork the repo and enable GitHub Actions on the fork.
2. (Optional) add a `GRAFANA_ACCESS_POLICY_TOKEN` secret — omit it to test the unsigned path.
3. Push a pre-release tag to the fork: `git tag v0.0.1-fork.1 && git push fork v0.0.1-fork.1`.
4. Inspect the draft release on the fork; delete the tag and draft when done.

## Checklist

- [ ] CHANGELOG section exists for the version (`make release-notes VERSION=X.Y.Z` prints it)
- [ ] `make check-version VERSION=X.Y.Z` passes on main
- [ ] CI green on main (including the CrateDB version matrix)
- [ ] `make validate` green locally (the same plugin-validator gate the release workflow runs)
- [ ] Screenshots still match the current UI (`make screenshots` regenerates them)
- [ ] Tag pushed; release workflow green; draft release reviewed and published
- [ ] (First release) catalog submission filed
