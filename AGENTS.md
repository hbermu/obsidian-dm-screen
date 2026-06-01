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
- Never push to `main` directly. The branch is protected; CI is required. Always go through a PR (see `Branching and PRs` below).
- Never force-push to any shared branch. Never move existing tags. To replace a release, bump to the next version.

### Branching and PRs

- Create a branch named `<type>/<slug>` where `<type>` is one of `feature`, `fix`, `hotfix`, `chore`, `refactor`, `docs`, `test`, `ci`, or `release/v<X.Y.Z>[-beta.N]`. Slugs are lowercase a–z, 0–9, hyphens only — no underscores, no leading hyphen, no consecutive hyphens.
- Open the PR via `gh pr create` against `main`. The PR title must follow Conventional Commits: `<type>(<scope>): <subject>` where `<scope>` is a feature directory name under `.agent/features/` (for example `hydrus`, `fog-of-war`, `dm-preview`) or `deps`, `release`, `repo`. The subject is at least 10 characters in imperative mood with no trailing period.
- Five status checks must pass before merge: `typecheck`, `test`, `build`, `branch-name / lint`, `pr-title / lint`.
- Merges are squash-only; the PR title becomes the squash-commit subject on `main` (make it grep-worthy — future `git log --grep` runs depend on it). Merged branches are auto-deleted.
- No approving reviews are required (solo project); admin bypass exists for break-glass emergencies. Do not request reviews from anyone.

Examples of compliant PR titles:

- `feat(hydrus): add multi-service tag search`
- `fix(fog-of-war): preserve canvas size after layer reload`
- `chore(deps): bump esbuild to 0.25.1`
- `refactor(combat-tracker): extract round-1 reveal helper`
- `release: v0.8.5-beta.1`

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

Releases are **automated** by `.github/workflows/release.yml`. The AI never runs `git tag` or `gh release create` by hand. Versioning is SemVer: `MAJOR.MINOR.PATCH-beta.N` for prereleases, `MAJOR.MINOR.PATCH` for stable. Three files carry the version and must move together: `package.json`, `package-lock.json` (top-level `version`), `manifest.json`.

### Prerelease (beta)

1. From `main`, cut a branch `release/vX.Y.Z-beta.N`.
2. Bump the version in the three files to `X.Y.Z-beta.N`.
3. Commit (PR title: `release: vX.Y.Z-beta.N`) and push the branch.
4. The push triggers CI and the release workflow. When green, the workflow tags `vX.Y.Z-beta.N` from the branch HEAD and publishes a GitHub prerelease with `main.js`, `manifest.json`, `styles.css`.
5. Betas live on their branch. Iterate by bumping to `-beta.N+1` and pushing, or by cutting a new `release/vX.Y.Z-beta.N+1` branch from the previous one.

### Stable

1. Cut `release/vX.Y.Z` from `main` (or from the latest matching beta branch).
2. Bump the three version files to `X.Y.Z` (no `-beta` suffix).
3. Open a PR titled `release: vX.Y.Z`.
4. After CI passes, squash-merge to `main`.
5. The push to `main` triggers the release workflow, which tags `vX.Y.Z` and publishes a non-prerelease GitHub release with auto-generated notes built from every PR squash-merged since the previous tag.

### Version judgement

SemVer applies. Use the cumulative diff since the last stable tag:

- Breaking change in observable behaviour → bump major.
- New user-facing capability or new spec under `.agent/features/` → bump minor.
- Bug fix only, no new requirements → bump patch.

The AI proposes the version in the branch name; the user can override by renaming the branch before pushing.

To replace a beta or stable, bump to the next version. Never force-move a tag.

## Known pitfalls

- **`↺` rotate-icon characters in `DmControlPanel.ts`**: the Edit tool sometimes cannot match the literal UTF-8 character before substitution. Use `sed` via Bash or the `↺` escape.
- **Dynamic `import("obsidian")`**: fails in the CJS runtime. Always static.
- **Dotfolder vault paths** (e.g. `.dm-screen/bg/...`): Obsidian's vault index skips them, so `getAbstractFileByPath` returns null. Fall back to `vault.adapter.exists` + `adapter.readBinary`. `server.ts` already does this in `readVaultBytes`.
- **Image-layer fit-to-viewport `W` / `H` buttons** require a connected client. Without one, show a Notice — do not crash.

## The update rule (repeated for emphasis)

Code change → spec change, same commit. Feature delete → spec dir delete, same commit. PRs that change observable behaviour without updating `.agent/features/` are spec drift and must be rejected.
