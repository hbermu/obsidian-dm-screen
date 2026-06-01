export interface ActiveSegment {
  start: number;
  end: number;
  text: string;
}

export interface AppliedSuggestion {
  value: string;
  caret: number;
}

/**
 * Locates the comma-delimited segment that the caret is currently inside,
 * trimming any leading whitespace so the segment text matches what users
 * actually consider "what I'm typing right now".
 *
 * The end of the segment is the caret position itself — anything to the right
 * of the caret is treated as part of a *future* segment and left alone, even
 * if it doesn't yet contain a comma. That keeps `applySuggestion` from eating
 * trailing tags when the user clicks back to insert one in the middle.
 */
export function activeSegment(value: string, caret: number): ActiveSegment {
  const safeCaret = Math.min(Math.max(0, caret), value.length);
  const lastComma = value.lastIndexOf(",", safeCaret - 1);
  let start = lastComma === -1 ? 0 : lastComma + 1;
  while (start < safeCaret && value[start] === " ") start += 1;
  return { start, end: safeCaret, text: value.slice(start, safeCaret) };
}

/**
 * Replaces the active segment with `suggestion` and a trailing ", ", returning
 * the new full input value plus where the caret should land (immediately after
 * the inserted comma+space, ready for the next tag).
 */
export function applySuggestion(
  value: string,
  caret: number,
  suggestion: string
): AppliedSuggestion {
  const segment = activeSegment(value, caret);
  const insertion = suggestion + ", ";
  const next = value.slice(0, segment.start) + insertion + value.slice(segment.end);
  return { value: next, caret: segment.start + insertion.length };
}

/**
 * Splits a comma-delimited tag query into trimmed, non-empty tags. Shared by
 * the Hydrus explorer's search input and the default-tag setting so both apply
 * identical parsing rules.
 */
export function parseTagQuery(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}
