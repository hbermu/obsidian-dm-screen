# Hydrus Explorer Modal

> The grid of tiles the DM browses when picking a Hydrus file. Clicking a tile opens a preview lightbox; right-clicking (or the ⋮ button) opens the same context menu. Both the preview and the menu expose the file actions (add as image layer, set as background, set as map, copy tags, copy reference). Supports searching by tags, switching between remote/merged and local-only sources, filtering by media type, and paging through results.

## Source files

- `src/views/HydrusExplorerModal.ts` — modal lifecycle, tile rendering, source toggle, filter checkboxes, page controls, tile context menu, thumbnail loading, preview lightbox
- `src/hydrus/pagination.ts` — `paginate(items, pageIndex, pageSize)`

## Settings used

- `hydrusDefaultSearchTags`, `hydrusDefaultLoop`, `hydrusDefaultMuted`, `hydrusIgnoredTagPatterns`, `cacheBaseFolder`

## Requirements

1. The modal shall add the `dm-hydrus-modal` CSS class and set the title to `Media from Hydrus`.
2. The modal shall pre-fill the search input with `hydrusDefaultSearchTags`.
3. The modal shall expose a source selector with three options: `Remote + Local` (merged), `Local only`, and implicitly `Online` mode when the Hydrus client is reachable. Switching shall re-render the tile grid.
4. The modal shall expose two filter checkboxes: `images` and `videos`. Unchecking a class shall hide its tiles from the grid.
5. The modal shall render a maximum of `PAGE_SIZE = 100` tiles per page; total tiles considered are capped at `HARD_CAP = 1000`.
6. Each remote tile shall load its thumbnail via `client.getThumbnailBytes(hash)` and render it as a data URL.
7. Each local tile shall load its thumbnail from the cached `thumbVaultPath` via `vault.adapter.getResourcePath`.
8. A left click on any tile shall open the preview lightbox (requirement 11) for that tile. A right click (`contextmenu`) on any tile shall open the tile context menu (requirement 9), the same menu the `⋮` button opens; the tile itself no longer has click / Shift-click shortcuts for adding a layer or setting the background.
8b. The label assigned to a Hydrus-sourced image layer shall be the value of the file's first `name:` tag (the prefix `name:` stripped, surrounding whitespace trimmed). When the file has no `name:` tag, the label shall fall back to `Hydrus <first 8 hex chars of hash>`. When that label collides with an existing layer (case-insensitive), the modal shall append the smallest integer suffix `>= 2` that yields a unique label (e.g. `Goblin`, then `Goblin 2`, `Goblin 3`).
9. Each tile shall expose a `⋮` button and a right-click handler that open a context menu with, in order: a tag list header (filtered through `hydrusIgnoredTagPatterns`, sorted alphabetically via `localeCompare`, and rendered as a comma-separated, wrap-on-row list inside a menu whose max width is fixed in CSS — each tag carries a trailing comma except the last and stays `nowrap` so individual tags never break mid-string; renders `(no tags)` when the file has none); an `Add as image layer` action shown only when the tile MIME is not `video/*` (adds the file as an image layer on the open DM Control Panel — see `../image-layers/overview.md` and `cache.md` — with `visible: false`, using the label from requirement 8b, and shows the Notice `Added as image layer.`); a Copy tags action whose payload is the same alphabetically-sorted, comma-joined list; a Copy image reference action (titled `Copy video reference` when the tile MIME is `video/*`) that writes the Markdown string `[<label>](hydrus://<hash>)` to the clipboard — where `<label>` is `layerLabelFromTags(tile.knownTags, tile.hash)` — and shows the Notice `Reference copied.`; a `Set as background` action that works for both images and videos; a `Set as map` action; and cache-management actions (`Download to cache` for remote tiles, or `Re-download (overwrite)` + `Delete local copy` for local tiles). The Copy image/video reference, Set as background, and Set as map actions are always present; Copy tags is shown only when the tile has at least one non-ignored tag.
10. The modal shall display a banner element (`dm-hydrus-banner`) for transient status/error messages.
11. Left-clicking a tile shall open a preview overlay (`dm-hydrus-preview`, absolutely positioned inside the modal content) showing the media at full resolution: a local tile loads via `vault.adapter.getResourcePath(vaultPath)`; a remote tile is fetched whole via `client.getFileBytes(hash)` into an object URL (revoked when the preview closes or the modal closes). Images render in an `<img>`, videos in a `<video controls autoplay>` honouring `hydrusDefaultLoop` / `hydrusDefaultMuted`. Below the media the preview shall list the file's non-ignored tags (sorted, comma-joined) and a row of action buttons: `Add as image layer` (images only; adds the layer then closes the preview back to the grid), `Set as background`, `Set as map`, `Copy tags` (only when the tile has tags), and `Copy image reference` / `Copy video reference`. The preview shall close on its `✕` button, on a backdrop click, or on `Escape` (captured so it dismisses only the preview, not the modal).

## Tests covering this

- `src/__tests__/pagination.test.ts` — the paging math
- `src/__tests__/tag-filter.test.ts` — the ignored-tags regex matching used by the context menu

## Non-goals

- Server-side pagination cursors. Hydrus does not expose them; the modal pages locally up to `HARD_CAP`.
- Selecting multiple files at once.
- Saving filter or source state across modal opens. They reset to defaults on each open.
- Showing files larger than `HARD_CAP`. The modal expects the DM to narrow the search with extra tags rather than scroll past 1000 items.
