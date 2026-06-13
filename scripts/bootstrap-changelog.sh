#!/usr/bin/env bash
# One-shot script to seed CHANGELOG.md from every existing stable GitHub
# release. After the first stable release publishes under the new tiered
# workflow, .github/workflows/release.yml takes over and updates the file
# in place. Re-running this script regenerates CHANGELOG.md from scratch
# using only historical releases — it does NOT preserve manual edits.
#
# Requires: gh CLI authenticated against the repo, jq, awk, sort.
set -euo pipefail

OUTPUT="CHANGELOG.md"

mapfile -t entries < <(gh release list --limit 200 --json tagName,publishedAt,isPrerelease \
    --jq '.[] | select(.isPrerelease | not) | "\(.publishedAt)|\(.tagName)"' \
    | sort)

declare -a sections=()
prev_tag=""

for entry in "${entries[@]}"; do
  date="${entry%%T*}"
  tag="${entry#*|}"

  if [ -z "$prev_tag" ]; then
    tier="initial"
  else
    IFS=. read -r pma pmi _ppa <<<"${prev_tag#v}"
    IFS=. read -r cma cmi _cpa <<<"${tag#v}"
    if [ "$cma" != "$pma" ]; then
      tier="major"
    elif [ "$cmi" != "$pmi" ]; then
      tier="minor"
    else
      tier="patch"
    fi
  fi

  body=$(gh release view "$tag" --json body --jq .body)
  section=$(printf '## %s — %s — %s\n\n%s\n' "$tag" "$tier" "$date" "$body")
  sections=("$section" "${sections[@]}")
  prev_tag="$tag"
done

{
  echo "# Changelog"
  echo ""
  echo "Automatically maintained by \`.github/workflows/release.yml\` after every stable release. Do not edit by hand — changes are overwritten on the next publish."
  echo ""
  for section in "${sections[@]}"; do
    printf '%s\n\n' "$section"
  done
} >"$OUTPUT"

echo "Wrote $OUTPUT with $(grep -c '^## ' "$OUTPUT") sections."
