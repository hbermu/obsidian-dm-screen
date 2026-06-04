# Hydrus File Cache

> A vault-folder backed cache that stores Hydrus files and their thumbnails so the player screen can stream them locally (via `/vault/`) and so repeated pushes do not re-download. Includes an index file, TTL-based sweep, and a manual Clear button.

## Source files

- `src/hydrus/cache.ts` — `HydrusCache` class, `IndexFile`, `paths`, `listCached`, `get`, `markUsed`, `fetchAndCache`, `sweep`, `clear`, `loadIndex` / `saveIndex`, write-queue serialisation
- `src/main.ts` — `initHydrusCache` instantiates the cache rooted at `<cacheBaseFolder>/hydrus/` and starts the daily sweep; `migrateLegacyCacheFolder` translates a pre-rename `hydrusCacheFolder` value into the new `cacheBaseFolder` on load
- `src/settings.ts` — cache base folder input (with `..` validation), TTL input, Clear cache button

## Settings used

- `cacheBaseFolder` — relative vault path (default `.dm-screen`); the Hydrus cache lives at `<cacheBaseFolder>/hydrus/`
- `hydrusCacheTtlDays` — staleness threshold for sweep (default `30`)

## Requirements

### On-disk layout

1. Files shall be stored under `<cacheBaseFolder>/hydrus/<hash>.<ext>`.
2. Thumbnails shall be stored under `<cacheBaseFolder>/hydrus/<hash>.thumb.jpg`.
3. The cache index shall be a JSON file at `<cacheBaseFolder>/hydrus/index.json` of shape `{ version: 1, entries: Record<hash, CachedEntry> }`.
4. A `CachedEntry` shall contain: `hash`, `ext`, `mime`, `sizeBytes`, `width?`, `height?`, `downloadedAt`, `lastUsedAt`, `knownTags`, `vaultPath`, `thumbVaultPath`.

### Folder validation

5. The cache-base-folder setting shall reject values containing `..` (Notice: `Cache folder must be relative to the vault, no ".." segments`).
6. The cache-base-folder setting shall strip leading and trailing slashes.
7. An empty cache-base-folder value shall fall back to `.dm-screen`.

### Settings migration

7a. On plugin load, the plugin shall migrate a saved `hydrusCacheFolder` field into `cacheBaseFolder` by stripping a trailing `/bg` or `/hydrus` segment, falling back to `.dm-screen` when the result is empty. The legacy field shall be removed and the settings persisted.
7b. When both `hydrusCacheFolder` and `cacheBaseFolder` are present in the saved data, the existing `cacheBaseFolder` shall win and the legacy field shall still be removed.

### Sweep and TTL

8. `sweep` shall iterate the index and remove entries whose `lastUsedAt` is older than `ttlDays` ago; for each removed entry, the file and thumbnail on disk shall be deleted.
9. `sweep` shall return the count of entries removed.
10. The plugin shall run `sweep` once on load when Hydrus is enabled.
11. The plugin shall schedule `sweep` to run every 24 hours while Hydrus is enabled.
12. Errors during a single entry's removal shall not abort the sweep; the next entry shall be attempted.

### Mark-used

13. When a cached file is pushed as background, the cache shall update its `lastUsedAt` to `Date.now()` and persist the index.

### Fetch-and-cache

14. `fetchAndCache(file)` shall download the file via `client.getFileBytes(hash)` and the thumbnail via `client.getThumbnailBytes(hash)`, write both to disk, and insert the `CachedEntry` into the index.
15. Writes shall be serialised through a single write-queue so that concurrent `fetchAndCache` + `markUsed` calls do not race on the index file.
16. The cache folder shall be created if it does not exist before any write.

### Clear

17. The Clear cache button shall call `cache.clear()`, which shall delete every file and thumbnail referenced by the index and reset the index to empty.
18. `clear` shall return the count of files removed and show a Notice with that count.

## Tests covering this

- `src/__tests__/hydrus-cache.test.ts` — basic round-trip, paths, get, markUsed
- `src/__tests__/hydrus-cache-extra.test.ts` — sweep, clear, write-queue concurrency, corrupted-index recovery
- `src/__tests__/settings-migration.test.ts` — legacy `hydrusCacheFolder` → `cacheBaseFolder` migration cases
- `src/__tests__/hydrus-end-to-end.integration.test.ts` — client + cache wired end-to-end with mocked `requestUrl`: search → metadata → `fetchAndCache`, idempotent re-fetch, non-2xx surfacing

## Non-goals

- LRU eviction by size. Only TTL-based eviction.
- Cache compression. Files are stored as downloaded.
- Per-file user overrides of the TTL. Single global TTL applies to all entries.
- Cross-vault cache sharing. The cache is vault-local.
- Repairing inconsistencies between disk files and the index. If a file goes missing the entry will still appear in `listCached` and produce a 404 when used.
