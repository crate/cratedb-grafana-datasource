# dev and ci/cd tasks
# Backend = Go (pkg/), frontend = TS (src/); both build into a single dist/.
# `make help` lists all targets.

# Yarn 4 is required by @grafana/plugin-ui (engines field; yarn 1 hard-fails).
# If the local yarn is not v4 (or missing), fall back to a pinned one-shot via npx.
YARN := $(shell yarn --version 2>/dev/null | grep -q '^4\.' && echo yarn || echo npx -y -p @yarnpkg/cli-dist@4.17.0 yarn)

# Mage drives the plugin SDK's backend build; fall back to go run if not installed.
MAGE := $(shell command -v mage >/dev/null 2>&1 && echo mage || echo go run github.com/magefile/mage@v1.15.0)

# CrateDB release images are amd64-only; default to nightly on ARM hosts.
# Override explicitly with CRATEDB_IMAGE=crate/crate:<tag>.
CRATEDB_IMAGE ?= $(shell [ "$$(uname -m)" = "arm64" ] || [ "$$(uname -m)" = "aarch64" ] && echo crate/crate:nightly || echo crate/crate:latest)
# The compose stack takes just the tag; derive it so `make up` inherits the
# same per-arch default.
CRATEDB_VERSION ?= $(lastword $(subst :, ,$(CRATEDB_IMAGE)))

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"} \
		/^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5); next } \
		/^[a-zA-Z0-9_-]+:.*##/ { printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

##@ Setup

.PHONY: install
install: ## Install dependencies (yarn + go modules)
	$(YARN) install
	go mod download

.PHONY: clean
clean: ## Remove build outputs and caches
	rm -rf dist coverage .eslintcache

##@ Build

.PHONY: build
build: build-backend build-frontend ## Build backend + frontend into dist/

.PHONY: build-backend
build-backend: ## Backend binaries for all platforms (mage)
	$(MAGE) -v

.PHONY: build-frontend
build-frontend: ## Frontend bundle (webpack production)
	$(YARN) build

.PHONY: dev
dev: ## Frontend watch mode (webpack development)
	$(YARN) dev

# Package dist/ into the installable zip Grafana expects (an id-named folder
# wrapping plugin.json, module.js, gpx_* binaries) plus a .sha1 next to it.
# Requires a built dist/ (`make build`). Releases package independently via
# grafana/plugin-actions/build-plugin; this target is for CI artifacts and
# for handing someone an installable build.
.PHONY: package
package: ## Zip dist/ into an installable plugin archive (+ .sha1)
	@test -f dist/plugin.json || { echo "dist/ is not a built plugin — run 'make build' first"; exit 1; }
	@id=$$(jq -r .id dist/plugin.json); \
	version=$$(jq -r .info.version dist/plugin.json); \
	archive="$$id-$$version.zip"; \
	staging=$$(mktemp -d); \
	cp -R dist "$$staging/$$id"; \
	(cd "$$staging" && zip -qr "$$archive" "$$id"); \
	mv "$$staging/$$archive" .; \
	rm -rf "$$staging"; \
	(sha1sum "$$archive" 2>/dev/null || shasum -a 1 "$$archive") | cut -f1 -d' ' > "$$archive.sha1"; \
	echo "packaged $$archive ($$(cat "$$archive.sha1"))"

##@ Quality

.PHONY: lint
lint: ## Lint everything (gofmt, go vet, golangci-lint, actionlint, eslint, tsc)
	@fmt_out="$$(gofmt -l pkg/ Magefile.go)"; \
	if [ -n "$$fmt_out" ]; then echo "$$fmt_out"; echo "gofmt: files need formatting (run 'make format')"; exit 1; fi
	go vet ./pkg/...
	go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.12.2 run ./pkg/...
	go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12 .github/workflows/*.yml
	$(YARN) lint
	$(YARN) typecheck

.PHONY: format
format: ## Auto-format Go and TS sources
	gofmt -w pkg/ Magefile.go
	$(YARN) prettier --write src/

.PHONY: test
test: test-backend test-frontend ## Unit tests (go + jest)

.PHONY: test-backend
test-backend: ## Go unit tests
	go test -race ./pkg/...

.PHONY: test-frontend
test-frontend: ## Jest tests (CI mode)
	$(YARN) test:ci

.PHONY: check
check: lint test ## lint + unit tests

##@ Live tests (Docker)

.PHONY: test-integration
test-integration: ## In-process driver tests vs a real CrateDB (testcontainers)
	CRATEDB_IMAGE=$(CRATEDB_IMAGE) go test -tags=integration -v -count=1 ./pkg/plugin/

# The deployed-plugin tiers run whatever is in dist/, so a stale build silently
# tests old code. Locally, rebuild when dist/ is missing or older than any
# source file; in CI (CI=true) the dist artifact from the check job is
# authoritative — a rebuild there would be redundant and the job lacks the
# frontend toolchain. dist/plugin.json is the freshness marker because the
# frontend bundle writes it as the last step of `make build`.
.PHONY: ensure-dist
ensure-dist:
	@if [ -n "$$CI" ]; then exit 0; \
	elif [ ! -f dist/plugin.json ]; then \
		echo "dist/ missing — running make build"; $(MAKE) build; \
	elif [ -n "$$(find pkg src go.mod go.sum package.json -newer dist/plugin.json -print -quit 2>/dev/null)" ]; then \
		echo "dist/ is stale — running make build"; $(MAKE) build; \
	fi

# Hermetic by default (boots CrateDB + Grafana via testcontainers). Set
# GRAFANA_URL to attach to a running `make up` stack instead.
# The chmod self-heals executable bits lost in transport (CI artifacts, rsync)
# — Grafana must be able to spawn the backend binary; no-op in attached mode.
.PHONY: e2e
e2e: ensure-dist ## Deployed-plugin tests vs CrateDB + Grafana (set GRAFANA_URL to attach)
	@chmod +x dist/gpx_cratedb_* 2>/dev/null || true
	CRATEDB_IMAGE=$(CRATEDB_IMAGE) go test -tags=e2e -v -count=1 -timeout=10m ./pkg/plugin/

# Boots (or reuses) the compose stack, seeds demo data, and drives a real
# Grafana in headless Chromium via @grafana/plugin-e2e. Chromium is downloaded
# on first run (~100 MB) — deliberately not part of `make install`.
.PHONY: e2e-browser
e2e-browser: ensure-dist ## Browser smoke tests vs the compose stack (Playwright)
	@chmod +x dist/gpx_cratedb_* 2>/dev/null || true
	CRATEDB_VERSION=$(CRATEDB_VERSION) docker compose up -d --build --wait
	./scripts/seed.sh
	$(YARN) playwright install chromium
	$(YARN) e2e:browser

##@ Dev stack (Docker Compose)

.PHONY: up
up: ## Start Grafana (:3000) + CrateDB (:4200/:5432) with dist/ mounted
	CRATEDB_VERSION=$(CRATEDB_VERSION) docker compose up -d --build

.PHONY: down
down: ## Stop the dev stack
	docker compose down

.PHONY: logs
logs: ## Tail dev stack logs
	docker compose logs -f

.PHONY: seed
seed: ## Load demo data for the Getting Started dashboard into CrateDB
	./scripts/seed.sh

# Regenerates the catalog screenshots referenced by src/plugin.json from the
# dev stack (started + seeded if needed). Kiosk-mode dashboard URLs render
# anonymously. Editor views are not captured here: Monaco text does not
# rasterize in headless Chromium (glyphs measure zero-width without the web
# fonts), so those need a manual capture if ever wanted.
.PHONY: screenshots
screenshots: ## Regenerate src/img/screenshots/*.png from the dev stack
	CRATEDB_VERSION=$(CRATEDB_VERSION) docker compose up -d --build --wait
	./scripts/seed.sh
	$(YARN) playwright install chromium
	$(YARN) playwright screenshot --viewport-size=1600,1400 --wait-for-timeout=9000 \
		'http://localhost:3000/d/cratedb-cluster-health?kiosk' src/img/screenshots/cluster-health.png
	$(YARN) playwright screenshot --viewport-size=1600,1300 --wait-for-timeout=9000 \
		'http://localhost:3000/d/cratedb-getting-started?kiosk' src/img/screenshots/getting-started.png

##@ Release

# Guard: the given VERSION must match package.json (the value that gets
# stamped into plugin.json at build time). The release workflow runs this
# with the pushed tag — catches "tagged vX.Y.Z, forgot the bump PR".
.PHONY: check-version
check-version: ## Assert VERSION=x.y.z matches package.json (release guard)
	@test -n "$(VERSION)" || { echo "usage: make check-version VERSION=x.y.z" >&2; exit 1; }
	@pkg=$$(jq -r .version package.json); \
	if [ "$$pkg" != "$(VERSION)" ]; then \
		echo "error: package.json version ($$pkg) does not match $(VERSION)" >&2; \
		exit 1; \
	fi; \
	echo "version match: $(VERSION)"

# Print the CHANGELOG.md section for VERSION (default: the version in
# package.json) to stdout — the release workflow uses it as the GitHub
# release body; run locally to preview it before tagging. Fails loudly when
# the section is missing (a malformed "## x.y.z" heading would otherwise
# ship a release with empty notes).
.PHONY: release-notes
release-notes: ## Print the CHANGELOG section for VERSION (default: package.json)
	@version="$(or $(VERSION),$(shell jq -r .version package.json))"; \
	notes=$$(awk -v ver="$$version" ' \
		$$0 ~ "^## " { in_section = ($$2 == ver) ; next } \
		in_section { print }' CHANGELOG.md); \
	if [ -z "$$notes" ]; then \
		echo "error: no CHANGELOG.md section found for version $$version" >&2; \
		exit 1; \
	fi; \
	printf '%s\n' "$$notes"

# Mirrors the release workflow's validator gate: package dist/ and run the
# same checks grafana.com applies on catalog submission — catch a malformed
# zip locally instead of after pushing the tag.
.PHONY: validate
validate: package ## Package dist/ and run the catalog plugin-validator on it
	@id=$$(jq -r .id dist/plugin.json); \
	version=$$(jq -r .info.version dist/plugin.json); \
	npx --yes @grafana/plugin-validator@0.44.2 -sourceCodeUri "file://$$(pwd)" "$$id-$$version.zip"

.PHONY: sign
sign: ## Sign the plugin locally (@grafana/sign-plugin; needs policy token)
	$(YARN) sign
