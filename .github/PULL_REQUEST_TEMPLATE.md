## Summary / why

<!-- What changed and why. -->

Fixes #…

## Checklist (things CI can't check)

- [ ] `CHANGELOG.md` entry added under the unreleased heading
- [ ] Macros changed? Synced all three places: `pkg/macros/macros.go`,
      `src/editor/macros.ts`, `docs/macros.md`
- [ ] Touched `driver`/`converters`/`completable`/`macros`? Ran
      `make test-integration && make e2e` locally
- [ ] UI change? Screenshot attached
