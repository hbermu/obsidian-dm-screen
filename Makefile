.PHONY: help up down build dev typecheck test test-coverage test-watch test-visual test-visual-update test-e2e logs ps clean

help:                ## list available targets
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ {printf "  %-12s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

up:                  ## start Obsidian + esbuild watch in the background
	docker compose up -d
	@echo ""
	@echo "  Obsidian GUI    https://localhost:3001  (accept self-signed cert)"
	@echo "  Player screen   http://localhost:3000   (once started from the DM panel)"
	@echo ""

down:                ## stop and remove containers
	docker compose down

build:               ## one-shot production build
	docker compose run --rm -e BUILD_OUT= builder sh -c "npm install --no-audit --no-fund && npm run build"

dev:                 ## run only the watcher (no Obsidian GUI)
	docker compose up builder

typecheck:           ## tsc --noEmit
	docker compose --profile tools run --rm typecheck

test:                ## vitest run
	docker compose --profile tools run --rm test

test-coverage:       ## vitest run --coverage (report in ./coverage/)
	docker compose --profile tools run --rm test sh -c "npm install --no-audit --no-fund && npx vitest run --coverage"

test-watch:          ## vitest in watch mode (interactive)
	docker compose --profile tools run --rm -e CI=0 test sh -c "npm install --no-audit --no-fund && npx vitest"

test-visual:         ## playwright visual regression (inside the official playwright image)
	docker compose --profile tools run --rm visual

test-visual-update:  ## refresh visual baselines (inside container — host PNGs WILL diff)
	docker compose --profile tools run --rm visual sh -c "npm install --no-audit --no-fund && npx playwright test --update-snapshots"

test-e2e:            ## real-Obsidian e2e suite (wdio; OBSIDIAN_VERSIONS=app/installer pairs, default latest/latest)
	docker compose --profile tools run --rm e2e

logs:                ## tail combined logs
	docker compose logs -f --tail=50

ps:                  ## container status
	docker compose ps

clean:               ## remove build artefacts and Obsidian local state (keeps vault notes)
	rm -rf node_modules main.js
	rm -rf .dev/vault/.obsidian/plugins/dm-screen .dev/vault/.obsidian/plugins/hot-reload
	rm -rf .dev/config
