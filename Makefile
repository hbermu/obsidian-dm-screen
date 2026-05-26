.PHONY: help up down build dev typecheck test test-watch logs ps clean

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

test-watch:          ## vitest in watch mode (interactive)
	docker compose --profile tools run --rm -e CI=0 test sh -c "npm install --no-audit --no-fund && npx vitest"

logs:                ## tail combined logs
	docker compose logs -f --tail=50

ps:                  ## container status
	docker compose ps

clean:               ## remove build artefacts and Obsidian local state (keeps vault notes)
	rm -rf node_modules main.js
	rm -rf .dev/vault/.obsidian/plugins/dm-screen .dev/vault/.obsidian/plugins/hot-reload
	rm -rf .dev/config
