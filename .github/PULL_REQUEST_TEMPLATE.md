## Summary / why

<!-- What changed and why. If the design changed, link the relevant
     docs/architecture.md section. -->

Fixes #…

## Checklist (things CI can't check)

- [ ] `CHANGELOG.md` entry added under the unreleased heading
- [ ] Macros changed? Synced all four places: `pkg/macros/macros.go`,
      `src/editor/macros.ts`, `README.md`, `docs/architecture.md`
- [ ] Touched `driver`/`converters`/`completable`/`macros`? Ran
      `make test-integration && make e2e` locally
- [ ] UI change? Screenshot attached
