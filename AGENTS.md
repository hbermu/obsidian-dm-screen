# AGENTS.md

Onboarding file for AI coding agents working on this repo. Read this before touching anything else. Detailed behavioural specs for each feature live under `.agent/features/`.

## Project overview

DM Screen is an Obsidian plugin for running D&D 5e sessions in-person. It pairs an Obsidian-side DM Control Panel with a player screen served over HTTP + WebSocket on the local network: phones, tablets, and TVs in any browser render what the DM pushes (image layers with per-layer fog of war, background image or video, an initiative tracker). A second endpoint (`/map`) renders one battlemap at physical 1-inch-per-square scale for playing with miniatures on a table TV. It integrates with two upstream services — a self-hosted Hydrus Network for image search and the D&D Beyond service for live encounter sync — and with two community Obsidian plugins (Initiative Tracker, Fantasy Statblocks) when they are present. Image layers can also be sent outward to configured webhooks (Telegram, Discord, or any `multipart/form-data` endpoint).

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
- WebSocket payloads consumed by `src/player/player.ts` come from `PlayerScreenServer` over a LAN-listening, unauthenticated socket. Treat every payload field as untrusted. Before passing a payload URL to any DOM sink (`<img src>`, `<video src>`, `window.location`, `window.open`, anchor `href`, etc.), validate it with `safePlayerUrl(url, kind)` from `src/player/safeUrl.ts`. The helper accepts only `/vault/...` paths and `data:image/...` / `data:video/...` URLs with an allowlisted MIME family; everything else (including `javascript:`, `data:text/html`, `data:image/svg+xml`, absolute HTTP URLs) is rejected. New payload-driven URL sinks added to the player bundle MUST pass through this helper — CodeQL's `js/xss` and `js/client-side-unvalidated-url-redirection` rules will flag any that don't.

### Git

- Never use `--no-verify`, `--no-gpg-sign`, or any flag that bypasses hooks or signing.
- Never push to `main` directly. The branch is protected; CI is required. Always go through a PR (see `Branching and PRs` below).
- Never force-push to any shared branch. Never move existing tags. To replace a release, bump to the next version.

### Branching and PRs

- Create a branch named `<type>/<slug>` where `<type>` is one of `feature`, `fix`, `hotfix`, `chore`, `refactor`, `docs`, `test`, `ci`. Slugs are lowercase a–z, 0–9, hyphens only — no underscores, no leading hyphen, no consecutive hyphens.
- Open the PR via `gh pr create` against `main`. The PR title must follow Conventional Commits: `<type>(<scope>): <subject>` where `<scope>` is the feature's short slug (`hydrus`, `dndbeyond`, `fog-of-war`, `dm-preview`, `webhooks`) or `deps`, `release`, `repo`, `changelog`. The lint enforces only the shape (lowercase slug, scope optional) — choosing a meaningful scope is the author's responsibility. The subject is at least 10 characters in imperative mood with no trailing period. Exception: `release:` titles may carry just the version (e.g. `release: v0.9.0`).
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
| `make test-visual` | Playwright visual regression suite (inside the official `mcr.microsoft.com/playwright` image) |
| `make test-visual-update` | Refresh committed visual baselines (inside container — host-generated PNGs WILL diff) |
| `make build` | production esbuild bundle → `main.js` |
| `make dev` | esbuild watcher only, no Obsidian GUI |
| `make up` | Obsidian GUI at `https://localhost:3001` + esbuild watcher |
| `make down` | stop containers |
| `make clean` | remove build artefacts and Obsidian local state (keeps vault notes) |

Run `make typecheck && make test` before every commit. CI runs the same targets plus `make build`; all three must pass on every PR. The bundle smoke test (`bundle-smoke.integration.test.ts`) re-builds `main.js` inside the test run, so changes that break the production build also fail tests.

### Visual tests

Visual regressions run via Playwright against the real production player bundle. Baselines live under `test/visual/__snapshots__/`. **Always update baselines inside the container** with `make test-visual-update` — host-generated PNGs render differently from the pinned Playwright image and will diff in CI. The `mcr.microsoft.com/playwright:vX.Y.Z-jammy` image tag in `docker-compose.yml` is kept in sync with the `@playwright/test` version pinned in `package.json`; bump them together. The `visual` CI job is informational only (not in required checks) until the suite has soaked.

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
  conditions.ts          # D&D 5e condition catalogue (icons, DDB id mapping, status encode/decode)
  global.d.ts            # Window augmentations (InitiativeTracker, FantasyStatblocks)
  player/
    player.ts            # Player-side WebSocket client and rendering
    layerRenderer.ts     # Id-keyed DOM reconciler for the image-layer stack
    player.css           # Player-side styles
    safeUrl.ts           # safePlayerUrl — validates payload URLs before any DOM sink
    index.html           # Template reference (real HTML is built in server.ts)
  map/
    map.ts               # Map-screen WebSocket client and rendering (physical scale, grid overlay)
    map.css              # Map-screen styles
    transform.ts         # Pure scale/translation/grid/calibration math (shared with the DM panel)
    types.ts             # Map payload/config/profile types
  hydrus/
    client.ts            # Hydrus Client API client
    cache.ts             # Vault-folder cache with TTL sweep
    noteRefs.ts          # Parse/resolve/download hydrus:// references embedded in notes
    pagination.ts        # Client-side pagination helper
    tagFilter.ts         # Regex tag filtering
    tagInput.ts          # Comma-delimited tag query parser
  dndbeyond/
    client.ts            # CobaltSession auth + encounter/character/monster API
    poller.ts            # Long-polling with min-gap and circuit breaker
    imageCache.ts        # Monster avatar cache
    types.ts             # D&D Beyond types
  webhooks/
    client.ts            # sendWebhookImage — decode → multipart build → POST via requestUrl
    multipart.ts         # Pure multipart/form-data builder + dataUrlToBytes decoder
    types.ts             # WebhookConfig, WebhookExtraField
  views/
    DmControlPanel.ts    # Main DM view (Player Screen + COMBAT sections)
    DnDBeyondPanel.ts    # D&D Beyond tab inside the COMBAT section
    DnDBeyondEncounterModal.ts  # Encounter picker behind the Choose Encounter button
    MonsterConditionsModal.ts   # Conditions + exhaustion editor for a DDB monster row
    RenameMonsterModal.ts       # Ephemeral display-name override for a DDB monster row
    HydrusExplorerModal.ts  # Hydrus search/explorer modal
    HydrusTagSuggester.ts   # Tag autocomplete
    MapScreenPanel.ts    # Map Screen section of the DM panel (picker, pan preview, grid controls)
    MapCalibrationModal.ts  # Per-screen physical calibration (diagonal + fine-tune + test pattern)
    SendToWebhookModal.ts   # Send-layer-to-webhook modal (target, preview, caption)
    StatblockPanel.ts    # 5e statblock renderer
    layerContextMenu.ts  # Right-click context menu for image-layer rows
  __tests__/             # Vitest unit and integration tests
```

## Release process

Releases are **fully automated** by `.github/workflows/release.yml`. **Every PR squash-merged to `main` publishes a new release**, version-bumped from the labels on the PR. The AI never runs `git tag`, `gh release create`, or `make build` by hand.

Versioning is SemVer: `MAJOR.MINOR.PATCH-beta.N` for prereleases, `MAJOR.MINOR.PATCH` for stable. Tags use **no `v` prefix** (Obsidian community plugin requirement). Three files carry the version and the workflow moves them together: `package.json`, `package-lock.json` (top-level `version`), `manifest.json`. A fourth file, `versions.json`, maps each released version to its `minAppVersion` — the workflow updates it automatically on every stable release.

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
3. The release workflow reads the labels, computes the next version from the latest stable tag (not `manifest.json` — see below), bumps the three version files + `versions.json` in a detached commit, tags `X.Y.Z` (no `v` prefix — required by Obsidian community plugin guidelines), builds `main.js`, publishes a GitHub release with tier-shaped notes (see below), and appends a matching section to `CHANGELOG.md` on `main`.

### Release notes by tier

Release-notes shape changes per bump label so that small releases stay small and large releases roll up the history.

| Tier | Body of the GitHub Release |
|------|----------------------------|
| `patch` | Single bullet: the title of the merged PR, plus a `Full Changelog` compare URL to the previous stable. No headings. |
| `minor` | Categorized aggregation (Features / Fixes / Documentation / Build & CI / Other) of every PR merged since the **previous minor** (`*.*.0`), not just the previous stable. Patches between minors are folded in. |
| `major` | The PR body of the merge that bumps to `X.0.0` (the workflow strips a trailing `## Test plan` section if present), followed by a bulleted list of every minor (`*.*.0`) shipped since the previous major, a link to `CHANGELOG.md`, and a `Full Changelog` compare URL. |

**Implication for `release:major` PRs:** the PR body is the published summary verbatim. Write it as release prose — narrative paragraphs, no internal references, no Claude-generated `## Test plan` checklist below the summary (the workflow truncates everything from that heading onward, but anything above it is published exactly as written).

### CHANGELOG.md

The workflow does NOT push a CHANGELOG to `main` (branch protection prevents it). Release notes live exclusively on the GitHub Releases page. To regenerate a local `CHANGELOG.md` from release history, run `scripts/bootstrap-changelog.sh`.

**Version source of truth.** The latest git tag is authoritative for "what's released". `manifest.json` on `main` stays as it was on the last manual edit and may lag behind — that is fine. The release workflow never pushes to `main`; it creates a detached commit, tags it, and pushes only the tag. The released asset carries the correct bumped version. Local `make build` on `main` produces a bundle stamped with whatever `manifest.json` currently says, so for development you should treat `manifest.json` as "version under development" rather than "version released".

### Beta flow

Prereleases are cut from the working branch — no dedicated `release/…` branch is needed. On a `feature/…` (or any other non-`main`) branch, bump the three version files to `X.Y.Z-beta.N`, commit, push. The release workflow on the push event reads `manifest.json`, sees the `-beta.N` suffix, and publishes a prerelease tagged `X.Y.Z-beta.N` (no `v` prefix) with `main.js`, `manifest.json`, `styles.css` attached.

Multiple betas on the same branch: bump to `beta.2`, push; the workflow tags `X.Y.Z-beta.2`. The previous `X.Y.Z-beta.1` release is left in place (it remains a valid intermediate proof point). Re-pushing the same beta version is a no-op (the workflow bails when the tag already exists).

When **any** PR squash-merges to `main` and produces a stable release, the release workflow publishes the stable release **and then deletes every `*-beta.*` GitHub release and its underlying tag** — not only the betas of the line just shipped, but every prerelease in the repo. Rationale: the Releases page is canonical for "what's shipped", and betas of an abandoned line (e.g. cut as `0.16.2-beta.N` but the eventual stable lands as `0.17.0` because the bump label changed) would otherwise become orphans that never get cleaned up. BRAT users pinned to any beta should switch to the latest stable.

If you push without bumping `manifest.json` to a `-beta.N` value (e.g. you forgot, or the branch carries the last stable version), the workflow logs a notice and publishes nothing. CI (`typecheck`, `test`, `build`) still runs on every push.

### Pre-push manifest check (mandatory before the first `git push -u`)

Because the release workflow never pushes to `main`, after a stable release lands on `main` the three version files (`manifest.json`, `package.json`, `package-lock.json` top-level `version`) stay at the development value they had when the stable was cut — usually `X.Y.Z-beta.N`. Any feature branch created from that state inherits the beta version, and pushing it would publish a prerelease against a line that may already be shipped (orphan-by-construction).

**Before the first `git push -u origin <new-branch>` on any branch**, the AI MUST run:

```bash
grep '"version"' manifest.json
```

If the value contains `-beta.N` and you are **not** intentionally cutting a beta, bump all three version files to the latest stable tag's value (or the next planned dev version) before the push:

```bash
# Latest stable tag, for reference (supports both legacy v-prefixed and bare tags):
git ls-remote --tags origin | grep -oP 'refs/tags/\Kv?[0-9]+\.[0-9]+\.[0-9]+$' | sed 's/^v//' | sort -V | tail -1
```

Edit `manifest.json`, `package.json`, `package-lock.json` (top-level `version` field — and the nested `packages[""].version`), commit as `chore(repo): bump version files to X.Y.Z` with `release:skip`, then push. The first push of every new branch should be from a manifest that matches "the version we'd ship if this branch were stable today" — never from a stale `-beta.N`.

The release workflow has a guard (`Bail if stable of this line was already published`) that refuses to publish `X.Y.Z-beta.N` when `X.Y.Z` stable already exists (checks both bare and legacy `v`-prefixed tags), but the guard is a safety net. The pre-push check is the AI's responsibility because the guard can only run *after* the push happens — it spares the orphan publication but not the wasted CI run, and it cannot protect against a stable-line beta that hasn't shipped yet (no stable to compare against).

When intentionally cutting a beta of an unshipped line, the flow is unchanged: bump to `X.Y.Z-beta.N`, commit, push. Both checks recognise the intent and let the publish proceed.

### Version judgement

SemVer applies. Decide bump from the cumulative diff since the last stable tag:

- Breaking change in observable behaviour → `release:major`.
- New user-facing capability or new spec under `.agent/features/` → `release:minor`.
- Bug fix only, no new requirements → patch (default, no label).

The AI proposes the label when opening the PR via `gh pr create --label`. The user can change the label up to the moment of merge.

To replace a beta or stable, bump to the next version. Never force-move a tag. Every beta in the repo is cleaned up automatically the next time a stable release ships (regardless of which line that stable belongs to); do not delete betas by hand mid-flow.

## Spec verification protocol

The `spec-update-check` CI gate catches PRs that touch `src/` without touching `.agent/features/`, but it cannot detect spec sentences that quietly stopped being true. To prevent that drift, every code-touching change must run through this protocol — not just the obvious "edit the matching spec" rule.

### Before editing

1. **Identify every affected spec.** A single `src/` change frequently touches multiple specs (an image-layer drag handler is described in both `image-layers/layer-controls.md` and `dm-preview/overview.md`; a status icon renderer is in `combat-tracker/overview.md` AND every initiative source spec). Grep `.agent/features/` for the file path, the symbol names you're about to touch, and the user-visible behaviour. Read the `overview.md` of every feature dir that matches, plus every sub-spec file in those dirs.
2. **Walk the EARS list, not the prose.** The "Source files" block at the top of a spec is informational; the canonical contract is the numbered `Requirements` list. For each requirement that touches the file you're about to edit, ask: "would my planned change still satisfy this exact sentence?".

### While editing

3. **Update the spec in the same commit.** If observable behaviour changes, modify the matching EARS requirement so the new sentence matches the new code. Add new requirements for new sub-behaviour. Remove requirements (and any code, tests, and helpers exclusively serving them) for removed behaviour. Do not rely on "I'll catch it in the next PR".
4. **Update test names too.** Test descriptions are part of the behaviour contract — if a test was named `"sweep ignores entries that were never used"` and you flipped the rule, rename the test (and its assertions) in the same diff.

### After editing

5. **Re-read each modified spec end-to-end against the diff.** If any requirement no longer matches the code, fix one or the other in the same commit. Cross-check identifiers (constant names, class field names, Map key types, MIME/extension lists, CSS class names) — these are the most common drift sources.
6. **Verify referenced helpers and constants exist.** If a spec sentence names `MIN_REQUEST_GAP_MS`, search the codebase. If it doesn't exist, fix the spec (or restore the constant). Aspirational sentences left over from earlier designs are spec drift even when the file appears recent.

### When you spot pre-existing drift

7. **Fix it in the same commit.** If you discover a spec sentence that doesn't match current code, even if it's unrelated to your change, correct it — commit type `chore(<scope>): align spec with implementation`. Don't carry known drift forward; an audit later is far more expensive than the inline fix.

Spec drift is treated as a bug. A PR that ships code matching the spec is preferred over a PR that ships code that contradicts the spec — but a PR that updates both in lockstep is preferred over either.

## Known pitfalls

- **`↺` rotate-icon characters in `DmControlPanel.ts`**: the Edit tool sometimes cannot match the literal UTF-8 character before substitution. Use `sed` via Bash or the `↺` escape.
- **Dynamic `import("obsidian")`**: fails in the CJS runtime. Always static.
- **Dotfolder vault paths** (e.g. `.dm-screen/bg/...`): Obsidian's vault index skips them, so `getAbstractFileByPath` returns null. Fall back to `vault.adapter.exists` + `adapter.readBinary`. `server.ts` already does this in `readVaultBytes`.
- **Image-layer fit-to-viewport `W` / `H` buttons** require a connected client. Without one, show a Notice — do not crash.

## The update rule (repeated for emphasis)

Code change → spec change, same commit. Feature delete → spec dir delete, same commit. PRs that change observable behaviour without updating `.agent/features/` are spec drift and must be rejected.
