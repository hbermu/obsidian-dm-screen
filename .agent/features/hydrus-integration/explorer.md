# Hydrus Explorer Modal

> The grid of tiles the DM browses when picking a Hydrus file. Clicking a tile adds an image as a layer; videos are background-only. Supports searching by tags, switching between remote/merged and local-only sources, filtering by media type, and paging through results.

## Source files

- `src/views/HydrusExplorerModal.ts` — modal lifecycle, tile rendering, source toggle, filter checkboxes, page controls, tile context menu, thumbnail loading
- `src/hydrus/pagination.ts` — `paginate(items, pageIndex, pageSize)`

## Settings used

- `hydrusDefaultSearchTags`, `hydrusDefaultLoop`, `hydrusDefaultMuted`, `hydrusIgnoredTagPatterns`, `cacheBaseFolder`

## Requirements

1. The modal shall add the `dm-hydrus-modal` CSS class and set the title to `Image from Hydrus`.
2. The modal shall pre-fill the search input with `hydrusDefaultSearchTags`.
3. The modal shall expose a source selector with three options: `Remote + Local` (merged), `Local only`, and implicitly `Online` mode when the Hydrus client is reachable. Switching shall re-render the tile grid.
4. The modal shall expose two filter checkboxes: `images` and `videos`. Unchecking a class shall hide its tiles from the grid.
5. The modal shall render a maximum of `PAGE_SIZE = 100` tiles per page; total tiles considered are capped at `HARD_CAP = 1000`.
6. Each remote tile shall load its thumbnail via `client.getThumbnailBytes(hash)` and render it as a data URL.
7. Each local tile shall load its thumbnail from the cached `thumbVaultPath` via `vault.adapter.getResourcePath`.
8. A regular click on an image tile shall add the file as an image layer on the open DM Control Panel (see `../image-layers/overview.md` and `cache.md`). When the tile's MIME is `video/*`, the click shall instead show the Notice `Videos can only be set as background. Shift-click the tile or use the ⋮ menu.` and do nothing else.
8a. A Shift-click on any tile shall set the file as the player background (see `../background-media/overview.md` and `cache.md`).
9. Each tile shall expose a `⋮` button that opens a context menu with at least: a tag list (filtered through `hydrusIgnoredTagPatterns`), a Copy tags action, and a `Set as background` action that works for both images and videos.
10. The modal shall display a banner element (`dm-hydrus-banner`) for transient status/error messages.

## Tests covering this

- `src/__tests__/pagination.test.ts` — the paging math
- `src/__tests__/tag-filter.test.ts` — the ignored-tags regex matching used by the context menu

## Non-goals

- Server-side pagination cursors. Hydrus does not expose them; the modal pages locally up to `HARD_CAP`.
- Selecting multiple files at once.
- Saving filter or source state across modal opens. They reset to defaults on each open.
- Showing files larger than `HARD_CAP`. The modal expects the DM to narrow the search with extra tags rather than scroll past 1000 items.
