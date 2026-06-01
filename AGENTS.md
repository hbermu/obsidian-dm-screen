# AGENTS.md

Onboarding file for AI coding agents working on this repo. Read this before touching anything else. Detailed behavioural specs for each feature live under `.agent/features/`.

## Project overview

DM Screen is an Obsidian plugin for running D&D 5e sessions in-person. It pairs an Obsidian-side DM Control Panel with a player screen served over HTTP + WebSocket on the local network: phones, tablets, and TVs in any browser render what the DM pushes (image layers with per-layer fog of war, background image or video, an initiative tracker). It integrates with two upstream services — a self-hosted Hydrus Network for image search and the D&D Beyond service for live encounter sync — and with two community Obsidian plugins (Initiative Tracker, Fantasy Statblocks) when they are present.

## Hard rules

### Environment

- No Node, npm, npx, or any JS toolchain runs on the host. Everything happens inside Docker via the Makefile.
- Use `make <target>`. Never run `node`, `npx`, `npm install`, `tsc`, `vitest`, or `esbuild` directly.

### Code style

- TypeScript strict.
- Static imports only: `import { X } from "obsidian"`. Dynamic `import("obsidian")` fails at runtime in the CJS bundle.
- No trailing or "what this does" comments. The code names things; comments are for non-obvious **why** only.
- No docstrings, no multi-line comment blocks.
- No error handling for cases that cannot happen. Trust internal callers; validate only at system boundaries (user input, external services).
- No backwards-compat shims, deprecated re-exports, no `// removed` comments. Dead code is deleted.
- No new helpers that are used once.

### Git

- Never use `--no-verify`, `--no-gpg-sign`, or any flag that bypasses hooks or signing.
- Never force-push to main. Never move existing tags. To replace a release, bump to the next version.

### AI documentation

- Anything in `AGENTS.md`, `CLAUDE.md`, or `.agent/` is self-contained — no external URLs, no third-party service links, no references to external standards documents. The only file in the repo that may carry external links is `README.md` (it lives on the public project page for human readers).
- Every code change that affects observable behaviour MUST update the corresponding `.agent/features/<feature>/<file>.md` in the same commit, using the template at `.agent/features/_template.md`. Spec drift is a bug.
- When a feature is removed, delete its spec directory in the same commit. No tombstone files.

## Build, test, typecheck

All targets run inside Docker; the container manages `node_modules`.

| Target | What it runs |
|--------|--------------|
| `make typecheck` | `tsc --noEmit` |
| `make test` | `vitest run` (all unit + integration tests) |
| `make test-watch` | `vitest` in watch mode (interactive) |
| `make build` | production esbuild bundle → `main.js` |
| `make dev` | esbuild watcher only, no Obsidian GUI |
| `make up` | Obsidian GUI at `https://localhost:3001` + esbuild watcher |
| `make down` | stop containers |
| `make clean` | remove build artefacts |

`make typecheck` currently surfaces a type error in a `happy-dom` dependency definition that is unrelated to project code. `make test` is the authoritative green check.

Run `make typecheck && make test` before every commit. The bundle smoke test (`bundle-smoke.integration.test.ts`) re-builds `main.js` inside the test run, so changes that break the production build also fail tests.

## Where to find what

- **Behavioural specs (canonical)**: `.agent/features/<feature>/`. Each feature has `overview.md` plus sub-spec files for finer sub-functionalities. Specs use EARS notation (defined in `.agent/conventions.md`) and list source files, settings, broadcast messages, tests, and non-goals.
- **AI conventions**: `.agent/conventions.md`. Defines EARS, the spec template, naming, and the update/deletion rules.
- **User-facing docs**: `README.md`.
- **Dev-workflow skill** (release details, Docker plumbing): the `obsidian-dm-screen` skill loaded from the user's environment. It is allowed to contain extra context AGENTS.md does not.

### Source tree

```
src/
  main.ts                # Plugin entry, command registration, Initiative Tracker plugin glue
  server.ts              # HTTP + WebSocket player-screen server, /vault/ routing
  settings.ts            # Settings interface, defaults, settings UI
  types.ts               # Shared types (TrackerCombatant, ImageLayer, etc.)
  debug.ts               # Debug-mode logger
  global.d.ts            # Window augmentations (InitiativeTracker, FantasyStatblocks)
  player/
    player.ts            # Player-side WebSocket client and rendering
    player.css           # Player-side styles
    index.html           # Template reference (real HTML is built in server.ts)
  hydrus/
    client.ts            # Hydrus Client API client
    cache.ts             # Vault-folder cache with TTL sweep
    pagination.ts        # Client-side pagination helper
    tagFilter.ts         # Regex tag filtering
    tagInput.ts          # Comma-delimited tag query parser
  dndbeyond/
    client.ts            # CobaltSession auth + encounter/character/monster API
    poller.ts            # Long-polling with min-gap and circuit breaker
    imageCache.ts        # Monster avatar cache
    types.ts             # D&D Beyond types
  views/
    DmControlPanel.ts    # Main DM view (Player Screen + COMBAT sections)
    DnDBeyondPanel.ts    # D&D Beyond tab inside the COMBAT section
    HydrusExplorerModal.ts  # Hydrus search/explorer modal
    HydrusTagSuggester.ts   # Tag autocomplete
    StatblockPanel.ts    # 5e statblock renderer
  __tests__/             # Vitest unit and integration tests
```

## Release process

Versioning: `MAJOR.MINOR.PATCH-beta.N` for prereleases, `MAJOR.MINOR.PATCH` for stable. Three files carry the version and must move together: `package.json`, `package-lock.json` (top-level `version`), `manifest.json`.

Steps:
1. `make typecheck && make test && make build` — all green (happy-dom typecheck error tolerated).
2. Bump version in the three files.
3. Commit with a descriptive message.
4. Annotated tag: `git tag -a vX.Y.Z-beta.N -m "vX.Y.Z-beta.N — short description"`.
5. `git push && git push --tags`.
6. Cut a release attaching `main.js`, `manifest.json`, `styles.css`. Mark prerelease for beta tags.

To replace a beta or stable, bump to the next version. Never force-move a tag.

## Known pitfalls

- **`↺` rotate-icon characters in `DmControlPanel.ts`**: the Edit tool sometimes cannot match the literal UTF-8 character before substitution. Use `sed` via Bash or the `↺` escape.
- **Dynamic `import("obsidian")`**: fails in the CJS runtime. Always static.
- **Dotfolder vault paths** (e.g. `.dm-screen/bg/...`): Obsidian's vault index skips them, so `getAbstractFileByPath` returns null. Fall back to `vault.adapter.exists` + `adapter.readBinary`. `server.ts` already does this in `readVaultBytes`.
- **Image-layer fit-to-viewport `W` / `H` buttons** require a connected client. Without one, show a Notice — do not crash.

## The update rule (repeated for emphasis)

Code change → spec change, same commit. Feature delete → spec dir delete, same commit. PRs that change observable behaviour without updating `.agent/features/` are spec drift and must be rejected.
