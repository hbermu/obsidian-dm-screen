# Tag Suggester (Autocomplete)

> Inline autocomplete for the explorer search input. Shows tag suggestions for the current token under the cursor, ranked by Hydrus's tag count.

## Source files

- `src/views/HydrusTagSuggester.ts` — `TagSuggester` class, dropdown rendering, keyboard navigation
- `src/hydrus/client.ts` — `searchTags(prefix, services)` returns `HydrusTagSuggestion[]`
- `src/views/HydrusExplorerModal.ts` — wires the suggester to the input via `suggestTags` and `onSubmit`

## Settings used

- `hydrusTagServices` (search scope for suggestions)
- `hydrusIgnoredTagPatterns` (filtered out of the dropdown)

## Requirements

1. The suggester shall fire on `input` events on the bound text input.
2. The current token shall be the substring between the last comma and the caret (whitespace trimmed); if no caret position is available, the whole input shall be the token.
3. While the token is empty, the suggester shall fetch the local-cache list of tags (small, fast) and show them.
4. While the token has at least one character, the suggester shall call `searchTags(token, hydrusTagServices)` and display the result, filtered through `hydrusIgnoredTagPatterns`.
5. The dropdown shall be scrollable (vertical), capped at a sensible height.
6. ArrowUp / ArrowDown shall move selection; Enter shall apply the selected suggestion (replacing only the current token, preserving the rest of the input); Escape shall close the dropdown.
7. Clicking a suggestion shall apply it the same way as Enter.
8. When the dropdown is open and the user presses Enter on no selection, the suggester shall invoke `onSubmit(rawInput)` to run the search.

## Tests covering this

- `src/__tests__/tag-suggest.test.ts` — empty-prefix local cache, prefix matching, ignored-pattern filtering

## Non-goals

- Inline ghost-text completions inside the input. Suggestions are dropdown-only.
- Multi-token suggestions in one keypress.
- Fuzzy matching. Prefix matching only.
- Counting suggestion frequency client-side (counts come from Hydrus).
