#!/bin/bash
# PreToolUse(Bash) hook: deterministic local enforcement of AGENTS.md hard rules.
# Mirrors the required CI gates (branch-name-lint, pr-title-lint, spec-update-check)
# so violations fail here, before a wasted CI round-trip. Exit 2 blocks the command.
CMD=$(jq -r '.tool_input.command // empty' 2>/dev/null)
[ -z "$CMD" ] && exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

block() { echo "BLOCKED: $1" >&2; exit 2; }

BRANCH_RE='^(feature|fix|hotfix|chore|refactor|docs|test|ci)/[a-z0-9][a-z0-9-]*$'
TITLE_RE='^release(\([a-z0-9-]+\))?: .+$|^(feat|feature|fix|hotfix|chore|refactor|docs|test|ci)(\([a-z0-9-]+\))?: .{10,}$'

# --- No JS toolchain on the host: everything runs via make (Docker) ---
if echo "$CMD" | grep -qE '(^|[;&|(]\s*)(npm|npx|node|tsc|vitest|esbuild)\b'; then
  block "no Node toolchain on the host — use the make targets (make typecheck / test / build / …)."
fi

# --- Never bypass hooks or signing ---
if echo "$CMD" | grep -qE -- '--no-verify|--no-gpg-sign'; then
  block "--no-verify / --no-gpg-sign are forbidden in this repo."
fi

# --- Releases are workflow-owned: no manual tags or gh releases ---
if echo "$CMD" | grep -qE 'git\s+tag\s+(-f\s+|--force\s+)?[a-z0-9v]' && ! echo "$CMD" | grep -qE 'git\s+tag\s+(-l|--list)'; then
  block "never tag by hand — releases are fully automated by release.yml (merge a PR, or push a -beta.N version bump)."
fi
if echo "$CMD" | grep -qE 'gh\s+release\s+(create|delete|edit|upload)'; then
  block "never manage releases by hand — release.yml owns them; bump to the next version instead."
fi

# --- main is protected: no direct or forced pushes ---
if echo "$CMD" | grep -qE 'git\s+push\b'; then
  CUR=$(git symbolic-ref --short -q HEAD)
  if echo "$CMD" | grep -qE '(\s|:)main(\s|$)' || { [ "$CUR" = "main" ] && ! echo "$CMD" | grep -qE 'git\s+push\s+\S+\s+\S'; }; then
    block "never push to main directly — branch <type>/<slug> and open a PR."
  fi
  if echo "$CMD" | grep -qE -- '--force|--force-with-lease|(^|\s)-f\b'; then
    block "never force-push in this repo — bump to the next version instead."
  fi
  # Pre-push manifest check (AGENTS.md → Release process): a new branch inheriting
  # a stale -beta.N version publishes an orphan prerelease on first push.
  if echo "$CMD" | grep -qE -- '-u\b|--set-upstream'; then
    if grep '"version"' manifest.json | grep -q -- '-beta\.' \
       && ! git log origin/main..HEAD --oneline -- manifest.json | grep -q .; then
      block "manifest.json carries a stale -beta.N version this branch never set. Bump manifest.json, package.json and package-lock.json (top-level AND packages[\"\"].version) to the latest stable, commit as 'chore(repo): bump version files to X.Y.Z' (label release:skip), then push. If you ARE cutting a beta, commit the beta version bump first."
    fi
  fi
fi

# --- Branch names must pass branch-name-lint ---
NEWBRANCH=$(echo "$CMD" | grep -oE 'git\s+(checkout\s+-b|switch\s+-c|branch)\s+[^ ;&|]+' | awk '{print $NF}' | head -1)
if [ -n "$NEWBRANCH" ] && ! echo "$NEWBRANCH" | grep -qE "$BRANCH_RE"; then
  block "branch '$NEWBRANCH' fails branch-name-lint — use <type>/<slug>, type in feature|fix|hotfix|chore|refactor|docs|test|ci, slug lowercase a-z0-9 and hyphens."
fi

# --- PR titles must pass pr-title-lint ---
if echo "$CMD" | grep -qE 'gh\s+pr\s+(create|edit)\b'; then
  TITLE=$(echo "$CMD" | grep -oE -- "(--title|-t)[= ]\"[^\"]*\"" | sed -E 's/^(--title|-t)[= ]\"(.*)\"$/\2/' | head -1)
  [ -z "$TITLE" ] && TITLE=$(echo "$CMD" | grep -oE -- "(--title|-t)[= ]'[^']*'" | sed -E "s/^(--title|-t)[= ]'(.*)'$/\2/" | head -1)
  if [ -n "$TITLE" ] && ! echo "$TITLE" | grep -qE "$TITLE_RE"; then
    block "PR title '$TITLE' fails pr-title-lint — <type>(<scope>): <subject>, subject ≥10 chars, no trailing period; 'release: vX.Y.Z' is the only short form."
  fi
fi

# --- Commit-time checks ---
if echo "$CMD" | grep -q 'git commit'; then
  STAGED=$(git diff --cached --name-only)
  # Spec-update rule: src change → spec change, same commit (mirror of spec-update-check)
  SRC=$(echo "$STAGED" | grep -E '^src/.*\.(ts|css|html)$' | grep -vE '^src/(__tests__/|global\.d\.ts)' | wc -l | tr -d ' ')
  SPEC=$(echo "$STAGED" | grep -cE '^\.agent/features/.*\.md$')
  if [ "$SRC" -gt 0 ] && [ "$SPEC" -eq 0 ] && ! echo "$CMD" | grep -q 'SPEC_NOT_NEEDED=1'; then
    block "commit stages src/ changes with no .agent/features/ spec change (spec drift). Update the matching spec in this commit; for a genuinely behaviour-free change, prefix the commit with SPEC_NOT_NEEDED=1 and apply the spec:not-needed label on the PR."
  fi
  # AI docs are self-contained: no external URLs outside README.md
  URLS=$(git diff --cached -- AGENTS.md CLAUDE.md '.agent/*' | grep '^+' | grep -E 'https?://')
  if [ -n "$URLS" ]; then
    { echo 'BLOCKED: AI docs must stay self-contained — staged external URLs:'; echo "$URLS"; } >&2
    exit 2
  fi
fi
exit 0
