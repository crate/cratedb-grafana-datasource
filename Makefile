# Development tasks for the CrateDB Grafana plugin.
# Backend = Go (pkg/), frontend = TS (src/); both build into a single dist/.
# `make help` lists all targets.

# Yarn 4 is required by @grafana/plugin-ui (engines field; yarn 1 hard-fails).
# If the local yarn is not v4 (or missing), fall back to a pinned one-shot via npx.
YARN := $(shell yarn --version 2>/dev/null | grep -q '^4\.' && echo yarn || echo npx -y -p @yarnpkg/cli-dist@4.17.0 yarn)

# Mage drives the plugin SDK's backend build; fall back to go run if not installed.
MAGE := $(shell command -v mage >/dev/null 2>&1 && echo mage || echo go run github.com/magefile/mage@v1.15.0)

.DEFAULT_GOAL := help

.PHONY: help
help:
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z0-9_-]+:.*##/ {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

.PHONY: install
install:
	$(YARN) install
	go mod download

.PHONY: build
build: build-backend build-frontend

.PHONY: build-backend
build-backend:
	$(MAGE) -v

.PHONY: build-frontend
build-frontend:
	$(YARN) build

.PHONY: dev
dev:
	$(YARN) dev

.PHONY: test
test: test-backend test-frontend

.PHONY: test-backend
test-backend:
	go test ./pkg/...

.PHONY: test-frontend
test-frontend:
	$(YARN) test:ci

.PHONY: test-integration
test-integration:
	go test -tags=integration -v ./pkg/plugin/

.PHONY: lint
lint:
	@fmt_out="$$(gofmt -l pkg/ Magefile.go)"; \
	if [ -n "$$fmt_out" ]; then echo "$$fmt_out"; echo "gofmt: files need formatting (run 'make format')"; exit 1; fi
	go vet ./pkg/...
	$(YARN) lint
	$(YARN) typecheck

.PHONY: format
format:
	gofmt -w pkg/ Magefile.go
	$(YARN) prettier --write src/

.PHONY: check
check: lint test

.PHONY: up
up:
	docker compose up -d --build

.PHONY: down
down:
	docker compose down

.PHONY: logs
logs:
	docker compose logs -f

.PHONY: sign
sign:
	$(YARN) sign

.PHONY: clean
clean:
	rm -rf dist coverage .eslintcache
