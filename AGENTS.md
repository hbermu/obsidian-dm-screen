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
- Use `debug()` / `debugWarn()` / `debugError()` from `src/debug.ts` to instrument non-trivial code paths so issues are diagnosable from the Debug mode toggle without code changes. Cover at least: outgoing network calls, cache hits and misses, lifecycle transitions (server start/stop, view open/close, restore/save), broadcast emissions, and the "this happened but probably shouldn't" branches. These helpers are no-ops when Debug mode is off, so there is no production cost. Do not log per-frame events or large payloads verbatim — summarise (counts, sizes, first few bytes/hashes). The player-side bundle (`src/player/player.ts`) runs in the browser and cannot reach the plugin's Debug setting, so it uses `console.log/warn/error` directly — that is intentional and the only exception.

### Git

- Never use `--no-verify`, `--no-gpg-sign`, or any flag that bypasses hooks or signing.
- Never push to `main` directly. The branch is protected; CI is required. Always go through a PR (see `Branching and PRs` below).
- Never force-push to any shared branch. Never move existing tags. To replace a release, bump to the next version.

### Branching and PRs

- Create a branch named `<type>/<slug>` where `<type>` is one of `feature`, `fix`, `hotfix`, `chore`, `refactor`, `docs`, `test`, `ci`. Slugs are lowercase a–z, 0–9, hyphens only — no underscores, no leading hyphen, no consecutive hyphens.
- Open the PR via `gh pr create` against `main`. The PR title must follow Conventional Commits: `<type>(<scope>): <subject>` where `<scope>` is a feature directory name under `.agent/features/` (for example `hydrus`, `fog-of-war`, `dm-preview`) or `deps`, `release`, `repo`. The subject is at least 10 characters in imperative mood with no trailing period. Exception: `release:` titles may carry just the version (e.g. `release: v0.9.0`).
- Apply a bump label on the PR (see `Release process` below). Patch is the default and needs no label; minor / major / skip need `release:minor`, `release:major`, or `release:skip`.
- Six status checks must pass before merge: `typecheck`, `test`, `build`, `branch-name-lint`, `pr-title-lint`, `spec-update-check`.
- The PR title type and the bump label must align with intent. `feat:` PRs are typically `release:minor`; `fix:` and `chore:` PRs are typically `release:patch` (default).
- When a PR changes `src/` files, the matching `.agent/features/` spec MUST be updated in the same PR. The `spec-update-check` CI gate enforces this. Apply `spec:not-needed` only when the change is truly behaviour-free (e.g. a comment-only edit, a CI tweak).
- Merges are squash-only; the PR title becomes the squash-commit subject on `main` (make it grep-worthy — future `git log --grep` runs depend on it). Merged branches are auto-deleted.
- No approving reviews are required (solo project); admin bypass exists for break-glass emergencies. Do not request reviews from anyone.
- Dependabot PRs are exempt from `branch-name-lint` and `pr-title-lint` (Dependabot owns the `dependabot/...` branch name and is configured in `.github/dependabot.yml` to emit `chore(deps): …` titles). Every other required check (`typecheck`, `test`, `build`, `spec-update-check`) still applies.

Examples of compliant PR titles:

- `feat(hydrus): add multi-service tag search`
- `fix(fog-of-war): preserve canvas size after layer reload`
- `chore(deps): bump esbuild to 0.25.1`
- `refactor(combat-tracker): extract round-1 reveal helper`
- `release: v0.13.0` (used by the release-bot only)

### AI documentation

- Anything in `AGENTS.md`, `CLAUDE.md`, or `.agent/` is self-contained — no external URLs, no third-party service links, no references to external standards documents. The only file in the repo that may carry external links is `README.md` (it lives on the public project page for human readers).
- Every code change that affects observable behaviour MUST update the corresponding `.agent/features/<feature>/<file>.md` in the same commit, using the template at `.agent/features/_template.md`. Spec drift is a bug.
- When a feature is removed, delete its spec directory in the same commit. No tombstone files.
- Documentation precedence for AI agents is: `.agent/features/**` (behaviour contract) → `AGENTS.md` (repo rules + workflow) → `CLAUDE.md` (agent-specific deltas).
- Keep these three sources aligned when one of them changes. If a rule changes in one file and applies globally, mirror it in the others in the same PR.

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

Run `make typecheck && make test` before every commit. CI runs the same targets plus `make build`; all three must pass on every PR. The bundle smoke test (`bundle-smoke.integration.test.ts`) re-builds `main.js` inside the test run, so changes that break the production build also fail tests.

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

Releases are **fully automated** by `.github/workflows/release.yml`. **Every PR squash-merged to `main` publishes a new release**, version-bumped from the labels on the PR. The AI never runs `git tag`, `gh release create`, or `make build` by hand.

Versioning is SemVer: `MAJOR.MINOR.PATCH-beta.N` for prereleases, `MAJOR.MINOR.PATCH` for stable. Three files carry the version and the workflow moves them together: `package.json`, `package-lock.json` (top-level `version`), `manifest.json`.

### Bump labels (apply on the PR before merge)

| Label | Effect on merge to `main` |
|-------|---------------------------|
| (none) | Default — patch bump (`0.0.x`) |
| `release:minor` | Minor bump (`0.x.0`) |
| `release:major` | Major bump (`x.0.0`) |
| `release:skip` | No release on this merge |

Use `release:skip` for purely-internal PRs that ship no observable change (CI rewires, doc-only edits that do not change product behaviour, throwaway smoke tests).

### Stable flow

1. Open a PR. Apply the right bump label (or none for patch).
2. CI runs the six required checks. Squash-merge to `main`.
3. The release workflow reads the labels, computes the next version from the latest stable tag (not `manifest.json` — see below), bumps the three version files in a detached commit, tags `vX.Y.Z`, builds `main.js`, and publishes a GitHub release with categorized notes (Features / Fixes / Documentation / Build & CI / Other) built from PR titles since the previous tag.

**Version source of truth.** The latest git tag is authoritative for "what's released". `manifest.json` on `main` stays as it was on the last manual edit and may lag behind — that is fine. The release workflow never pushes to `main`; it creates a detached commit, tags it, and pushes only the tag. The released asset carries the correct bumped version. Local `make build` on `main` produces a bundle stamped with whatever `manifest.json` currently says, so for development you should treat `manifest.json` as "version under development" rather than "version released".

### Beta flow

Prereleases are cut from the working branch — no dedicated `release/v…` branch is needed. On a `feature/…` (or any other non-`main`) branch, bump the three version files to `X.Y.Z-beta.N`, commit, push. The release workflow on the push event reads `manifest.json`, sees the `-beta.N` suffix, and publishes a prerelease tagged `vX.Y.Z-beta.N` with `main.js`, `manifest.json`, `styles.css` attached.

Multiple betas on the same branch: bump to `beta.2`, push; the workflow tags `vX.Y.Z-beta.2`. The previous `vX.Y.Z-beta.1` release is left in place (it remains a valid intermediate proof point). Re-pushing the same beta version is a no-op (the workflow bails when the tag already exists).

When the feature branch eventually squash-merges to `main` as `vX.Y.Z` stable, the release workflow publishes the stable release **and then deletes every `vX.Y.Z-beta.*` GitHub release and its underlying tag**. The Releases page only retains stable releases and the currently-in-flight betas of unrelated lines. BRAT users who were pinned to a beta of the line just released should switch to the stable.

If you push without bumping `manifest.json` to a `-beta.N` value (e.g. you forgot, or the branch carries the last stable version), the workflow logs a notice and publishes nothing. CI (`typecheck`, `test`, `build`) still runs on every push.

### Version judgement

SemVer applies. Decide bump from the cumulative diff since the last stable tag:

- Breaking change in observable behaviour → `release:major`.
- New user-facing capability or new spec under `.agent/features/` → `release:minor`.
- Bug fix only, no new requirements → patch (default, no label).

The AI proposes the label when opening the PR via `gh pr create --label`. The user can change the label up to the moment of merge.

To replace a beta or stable, bump to the next version. Never force-move a tag. Old betas are cleaned up automatically when the stable for the same `vX.Y.Z` ships; do not delete them by hand mid-flow.

## Known pitfalls

- **`↺` rotate-icon characters in `DmControlPanel.ts`**: the Edit tool sometimes cannot match the literal UTF-8 character before substitution. Use `sed` via Bash or the `↺` escape.
- **Dynamic `import("obsidian")`**: fails in the CJS runtime. Always static.
- **Dotfolder vault paths** (e.g. `.dm-screen/bg/...`): Obsidian's vault index skips them, so `getAbstractFileByPath` returns null. Fall back to `vault.adapter.exists` + `adapter.readBinary`. `server.ts` already does this in `readVaultBytes`.
- **Image-layer fit-to-viewport `W` / `H` buttons** require a connected client. Without one, show a Notice — do not crash.

## The update rule (repeated for emphasis)

Code change → spec change, same commit. Feature delete → spec dir delete, same commit. PRs that change observable behaviour without updating `.agent/features/` are spec drift and must be rejected.
