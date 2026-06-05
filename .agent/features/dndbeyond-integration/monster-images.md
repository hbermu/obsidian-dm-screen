# Monster Avatar Cache and Layer Push

> When the DM selects a D&D Beyond encounter, the unique monster IDs are looked up via the monster service to fetch portrait URLs. Each unique monster's avatar is downloaded once, cached on disk, and inserted as a hidden image layer on the DM panel so the DM can flip them on quickly. Duplicate monsters in the encounter (same `id`) share one layer.

## Source files

- `src/dndbeyond/client.ts` — `getMonsterImages(ids)` — issues individual GETs to the monster service and returns a `Map<id, avatarUrl>`
- `src/dndbeyond/imageCache.ts` — `DdbImageCache`, `getOrDownload(monsterId, imageUrl, name)`, `sweep`
- `src/views/DnDBeyondPanel.ts` — `loadMonsterImages(encounter)` orchestrates dedupe → fetch → cache → layer add
- `src/main.ts` — owns the shared `ddbImageCache` instance (constructed in `initHydrusCache`, cleared on `onunload`), and schedules its 24-hour sweep alongside the Hydrus cache sweep

## Settings used

- `cacheBaseFolder` — the DDB monster avatar cache lives at `<cacheBaseFolder>/beyond/` (default `.dm-screen/beyond/`)
- `hydrusCacheTtlDays`

## Requirements

1. `loadMonsterImages(encounter)` shall dedupe the encounter's monster IDs via `Set`.
2. The panel shall call `client.getMonsterImages(uniqueIds)` once per encounter selection.
3. `client.getMonsterImages` shall issue one GET per id in parallel via `Promise.allSettled`, with no inter-request pacing. A failed individual request is logged and skipped; the rest of the map still returns.
4. For each `(monsterId, imageUrl)` pair, the panel shall:
   - Look up the monster's name from `encounter.monsters` (fallback `Monster <id>`).
   - Call `cache.getOrDownload(monsterId, imageUrl, name)` to obtain a vault path.
   - Convert the vault file to a data URL via `plugin.imageToDataUrl`.
   - Call `dmPanel.addImageLayer(name, dataUrl, "monster", false)` to add it as a hidden, portrait-sized layer.
5. If no DM Control Panel is open at the time, `loadMonsterImages` shall short-circuit and not download anything.
6. `getOrDownload` shall:
   - Return the cached `vaultPath` if an entry for `monsterId` already exists and is on disk.
   - Otherwise download the image, write it to `<cacheBaseFolder>/beyond/<monsterId>.<ext>`, insert an index entry, and return the path.
7. The DDB image cache shall be subject to the same TTL sweep as the Hydrus cache; sweep frequency is once per day during plugin uptime.

## Tests covering this

- `src/__tests__/ddb-image-cache.test.ts` — round-trip cache, sweep
- `src/__tests__/ddb-to-player.integration.test.ts` — monster image layer added in addition to broadcast

## Non-goals

- Variant images per monster (e.g. swapping out the avatar for a token). One avatar per `monsterId`.
- Pre-fetching avatars before the DM selects the encounter.
- Sharing the cache with Hydrus (separate folder, separate index).
- Marking the monster layers visible automatically. They are added hidden so the DM controls when they appear.
