# Hydrus Search

> Tag-driven file search executed against Hydrus through the Client API. Tags are entered as a comma-delimited string in the explorer search box; the modal parses, sends, and renders results.

## Source files

- `src/hydrus/tagInput.ts` — `parseTagQuery(raw)` splits on commas, trims, drops empties
- `src/hydrus/client.ts` — `searchFiles(tags, limit)`, `getFilesMetadata(hashes)`
- `src/views/HydrusExplorerModal.ts` — `runSearch(raw)` orchestrates parse → search → metadata → render

## Settings used

- `hydrusDefaultSearchTags`, `hydrusTagServices`

## Requirements

1. `parseTagQuery` shall split the raw input on commas, trim each segment, and drop empties.
2. `runSearch` shall accept the raw input string from the search box (or Search button) and call `parseTagQuery` to produce the tag list.
3. `runSearch` shall call `client.searchFiles(tags, HARD_CAP)`. If no tags are present, it shall short-circuit with an empty result.
4. `client.searchFiles` shall append `system:limit=<limit>` to the tag array before submitting.
5. After hashes are returned, `runSearch` shall call `client.getFilesMetadata(hashes)` in chunks if needed and populate the tile array.
6. The modal shall render the first page of `PAGE_SIZE` tiles immediately and provide Prev / Next page controls.
7. While a search is in flight (`busy = true`), the modal shall not accept a new search.
8. The modal shall report errors via the banner element with the upstream Hydrus message.

## Tests covering this

- `src/__tests__/tag-input.test.ts` — comma split, trim, empty filtering
- `src/__tests__/hydrus-client.test.ts`, `hydrus-client-extra.test.ts` — `searchFiles` URL construction and error mapping
- `src/__tests__/pagination.test.ts` — paging
- `src/__tests__/hydrus-end-to-end.integration.test.ts` — search → metadata → cache flow end-to-end with mocked `requestUrl`

## Non-goals

- Tag operators beyond plain inclusion. Hydrus's `system:` and `-` (exclusion) prefixes are passed through verbatim; the parser does not validate.
- OR groups. Each tag is ANDed.
- Sort options. Hydrus's default order is used.
