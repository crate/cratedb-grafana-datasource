# Contributing

Thank you for your interest in contributing! This document covers contribution
etiquette; **everything technical lives in [DEVELOPMENT.md](DEVELOPMENT.md)**
(setup, build, test tiers, dev stack, CI, release flow).

## Issues

- Upvoting existing issues (👍 reactions) helps us prioritize.
- Bug reports and feature requests use the issue forms — the bug form asks for
  the plugin/Grafana/CrateDB version triple and the executed query, which is
  most of a diagnosis.
- Not sure it's a bug? The [CrateDB community forum](https://community.cratedb.com)
  is a good first stop.
- [ROADMAP.md](ROADMAP.md) lists what is already planned for 0.2 and why each item
  waits, which is the fastest way to see whether an idea is on the way already.

## Pull requests

Before we can accept pull requests, we need you to agree to our
[CLA](https://crate.io/community/contribute/cla/).

- For anything non-trivial, open an issue first so we can agree on the
  direction before you invest time. [docs/architecture.md](docs/architecture.md)
  explains how the plugin is put together and why.
- Work on a feature branch, rebase onto `origin/main` before opening the PR,
  and squash related commits.
- Be descriptive in the PR and commit messages: what is it for, why is it
  needed.
- The PR template's checklist covers the repo-specific traps CI cannot catch
  (CHANGELOG entry, the macro sync rule, live-test tiers) — please walk
  through it honestly.
- `make check` locally mirrors what CI enforces; `make help` lists everything
  else.

### Testing CI on your fork

The workflows carry no required secrets, so a fork runs the full pipeline:
enable GitHub Actions on your fork and push your branch — lint, unit tests,
the CrateDB version matrix, and the Playwright smoke tests all run there. To
exercise the release workflow too, see
[RELEASE.md](RELEASE.md#testing-the-release-pipeline-on-a-fork).

## Security

Please do not report security vulnerabilities as public issues — see
[SECURITY.md](SECURITY.md).
