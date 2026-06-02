# Hydrus Integration

> The DM can browse a self-hosted Hydrus Network library by tag and push any image as a player-screen layer (default click) or any image / video as a player-screen background (Shift-click or context menu). Hydrus is contacted through its Client API; downloaded files are cached in the vault so subsequent uses do not re-download. Hydrus is an optional integration — when disabled the Image from Hydrus button is hidden and no network calls are made.

## Source files

- `src/hydrus/client.ts` — `HydrusClient`, `verifyAccess`, `getServices`, `searchFiles`, `getFilesMetadata`, `getFileBytes`, `getThumbnailBytes`, `searchTags`, MIME → extension map
- `src/hydrus/cache.ts` — `HydrusCache`, `CachedEntry`, index management, write serialisation, `sweep`, `clear`, `markUsed`, `fetchAndCache`
- `src/hydrus/pagination.ts` — `paginate(items, pageIndex, pageSize)` for client-side paging
- `src/hydrus/tagFilter.ts` — regex-anchored `filterTags` used by the explorer tile menu
- `src/hydrus/tagInput.ts` — comma-delimited query parser
- `src/views/HydrusExplorerModal.ts` — the modal UI
- `src/views/HydrusTagSuggester.ts` — autocomplete component bound to the search input
- `src/main.ts` — `buildHydrusClient`, `initHydrusCache`, daily `sweep` interval
- `src/settings.ts` — Hydrus settings section (connection, services, cache, defaults, ignored patterns)

## Settings used

- `hydrusEnabled` — gates the Image from Hydrus button and the sweep interval
- `hydrusApiUrl` — base URL of the Hydrus Client API (no trailing slash)
- `hydrusApiKey` — 64-hex `Hydrus-Client-API-Access-Key`
- `hydrusAvailableTagServices` — `{ name, key }[]` populated by Fetch services
- `hydrusTagServices` — list of selected service keys for searches
- `hydrusTagService` — deprecated single-service name, migrated to `hydrusTagServices` on first Fetch
- `hydrusCacheFolder` — relative vault path under which cached files live
- `hydrusCacheTtlDays` — files unused longer than this are swept on plugin load and once per day
- `hydrusDefaultLoop`, `hydrusDefaultMuted` — defaults for `show-background-media`
- `hydrusDefaultSearchTags` — tags pre-filled in the explorer search box
- `hydrusIgnoredTagPatterns` — regex patterns (auto-anchored `^…$`) for tags hidden from the tile menu and from Copy tags

## Requirements

1. The DM Control Panel shall expose an Image from Hydrus button if and only if `hydrusEnabled` is true and `hydrusApiUrl` is non-empty.
2. When the button is clicked, the panel shall open `HydrusExplorerModal`.
3. The plugin shall instantiate `HydrusCache` on load and on every settings save (so cache options reflect the latest settings).
4. While `hydrusEnabled` is true, the plugin shall sweep the cache once on load and then every 24 hours.
5. The plugin shall expose `buildHydrusClient()` returning a configured `HydrusClient` or `null` if any of `hydrusEnabled` / `hydrusApiUrl` / `hydrusApiKey` is missing or empty.
6. Sub-functionality requirements are split across:
   - `connection-and-services.md` — connectivity test, service discovery, multi-service selection
   - `explorer.md` — modal layout, source modes, filetype filters, pagination
   - `search.md` — tag query parsing, search execution, default tags
   - `tag-suggester.md` — autocomplete behaviour
   - `cache.md` — on-disk layout, index, TTL, mark-used, clear

## Broadcast / IPC

The Hydrus integration uses the background-media broadcast (`show-background-media`); see `../background-media/overview.md`. It does not introduce its own message types.

## Tests covering this

- `src/__tests__/hydrus-client.test.ts`, `src/__tests__/hydrus-client-extra.test.ts` — API client behaviour
- `src/__tests__/hydrus-cache.test.ts`, `src/__tests__/hydrus-cache-extra.test.ts` — cache index, sweep, mark-used, write serialisation
- `src/__tests__/pagination.test.ts` — `paginate` helper
- `src/__tests__/tag-filter.test.ts` — ignored-tag regex matching
- `src/__tests__/tag-input.test.ts` — query parsing
- `src/__tests__/tag-suggest.test.ts` — autocomplete component

## Non-goals

- Pushing a video as an image layer. Videos render only as the player-screen background.
- Tag editing or any write operation on the Hydrus server. The integration is read-only.
- Authenticating per-user. There is a single API key in settings.
- Streaming partial downloads. Files are fetched whole and stored on disk.
- A persistent search history.
