/**
 * Filters tags by removing those matching any of the given regex patterns.
 * Patterns are auto-anchored (^pattern$) so they must match the full tag.
 * Invalid patterns are silently skipped.
 */
export function filterTags(tags: string[], ignorePatterns: string[]): string[] {
  if (ignorePatterns.length === 0) return tags;

  const compiled: RegExp[] = [];
  for (const raw of ignorePatterns) {
    try {
      compiled.push(new RegExp(`^${raw}$`));
    } catch {
      // skip invalid patterns
    }
  }
  if (compiled.length === 0) return tags;

  return tags.filter((tag) => !compiled.some((re) => re.test(tag)));
}
