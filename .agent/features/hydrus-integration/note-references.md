# Hydrus Note References

> The DM can pin a specific Hydrus file to a note by pasting a Markdown link of the form `[label](hydrus://<hash>)`, copied from the Hydrus Explorer tile menu. The Add Image and Add BG buttons then list the active note's references alongside its local images, so a pinned file can be pushed to the player screen without re-searching Hydrus. References resolve from the local cache first (working while Hydrus is offline) and download on first use.

## Source files

- `src/hydrus/noteRefs.ts` — `parseHydrusRefs` (regex extraction), `resolveHydrusRefs` (cache-first + single remote batch), `ensureLocalCopy` (download-on-demand), `HydrusRef` / `ResolvedHydrusRef` types
- `src/hydrus/client.ts` — `mediaTypeOf(mime)` used to classify resolved references and to title the explorer menu action
- `src/views/HydrusExplorerModal.ts` — the `Copy image reference` / `Copy video reference` tile-menu action that produces the string; exports `encodeForVaultUrl`, `uniqueLayerLabel`, `layerLabelFromTags`
- `src/views/DmControlPanel.ts` — `collectHydrusRefEntries`, `applyHydrusRef`, and the merge into `showImagePicker` (Add Image) and `showBackgroundPicker` (Add BG)

## Settings used

- `hydrusDefaultLoop` — `loop` flag of the `show-background-media` payload when a reference is set as a video/image background
- `hydrusDefaultMuted` — `muted` flag of that payload
- `hydrusEnabled`, `hydrusApiUrl`, `hydrusApiKey` — gate `buildHydrusClient()`; when the client is null, uncached references cannot be resolved or downloaded

## Requirements

1. A Hydrus note reference shall be the Markdown string `[<label>](hydrus://<hash>)`, where `<hash>` is the file's 64-hex sha256 hash and `<label>` is human-editable display text. The hash is the only file identifier; the media type is not encoded in the reference.
2. `parseHydrusRefs(noteBody)` shall return `{ label, hash }[]` for every `[label](hydrus://<64-hex>)` match, in order of appearance, deduplicated by lowercased hash (the first occurrence keeps its label). Targets that are not exactly 64 hex characters, plain links, wikilinks, and bare `hydrus://` URLs without Markdown link syntax shall be ignored. An empty label is accepted.
3. `resolveHydrusRefs(refs, cache, client)` shall resolve each reference to `{ label, hash, mediaType, cached, available }`. For a reference present in `cache`, it shall set `cached: true`, `available: true`, and `mediaType = mediaTypeOf(entry.mime)` without any network call. Uncached references shall be resolved in a single `client.getFileMetadata(hashes)` call when `client` is non-null.
4. If a reference is uncached and `client` is null, then `resolveHydrusRefs` shall return it with `mediaType: null`, `cached: false`, `available: false`.
5. If the `getFileMetadata` call throws, then `resolveHydrusRefs` shall treat every reference it could not resolve from cache as `available: false`, `mediaType: null` — it shall not propagate the error.
6. `ensureLocalCopy(ref, cache, client)` shall return the cached entry when present without downloading. On a cache miss with a non-null client it shall fetch metadata for the single hash and `cache.fetchAndCache` the file (downloading bytes and thumbnail to the vault). On a cache miss with a null client it shall throw.
7. `collectHydrusRefEntries(file)` shall return `[]` when `hydrusCache` is null or the note body has no references; otherwise it shall read the note via `vault.cachedRead`, parse, and resolve the references with the current `buildHydrusClient()` client.
8. When the Add Image button is clicked, the picker shall list the note's local images (as before) plus every resolved reference whose `mediaType` is `"image"` or that is unavailable. Video references shall be excluded from Add Image.
9. When the Add BG button is clicked, the picker shall list the note's local images plus every resolved reference whose `mediaType` is `"image"` or `"video"`, plus unavailable references.
10. While a reference is unavailable, its menu entry shall be disabled and titled `Hydrus: <label> (offline, not cached)`. While a reference is available, its entry shall be titled `Hydrus: <label>` with the `link` icon and shall be clickable.
11. If there is exactly one actionable entry (one local image or one available reference) and no disabled entries, then the picker shall apply it directly without opening a menu. Otherwise the picker shall open the menu.
12. When an available reference is selected in Add Image, the panel shall `ensureLocalCopy` it and add an image layer via `addImageLayer(uniqueLayerLabel(imageLayers, ref.label), dataUrl, "hydrus", false)`.
13. When an available reference is selected in Add BG, the panel shall `ensureLocalCopy` it, set `activeBackgroundUrl` to `/vault/<encoded vaultPath>`, set `activeVideoPath` to the vault path when `mediaType` is `"video"` (else null), broadcast `show-background-media` with that `mediaType` and `loop`/`muted` from settings, and re-render.
14. After a reference is used as a layer or background, the panel shall call `cache.markUsed(hash)` so the cache TTL sweep treats it as recently used.
15. If `ensureLocalCopy` throws (offline and uncached, or the file is gone from Hydrus), then `applyHydrusRef` shall show a `Hydrus: <message>` Notice and add nothing.

## Broadcast / IPC

This feature introduces no new message types. Backgrounds reuse `show-background-media` and layers reuse `image-layers-sync` (via `addImageLayer`); see `../background-media/overview.md` and `../image-layers/overview.md`.

## Tests covering this

- `src/__tests__/note-refs.test.ts` — `parseHydrusRefs` (single, ordered multiples, dedupe by hash, case-insensitive hex, malformed/ignored, empty label); `resolveHydrusRefs` (cache hit offline, single-batch remote resolution, unavailable when uncached + null client, network error ⇒ unavailable); `ensureLocalCopy` (cache hit without download, miss downloads, miss + null client throws)

## Non-goals

- A "manage references" UI. The DM writes and edits the Markdown link by hand.
- Encoding the media type or tags inside the reference string. Only the hash.
- Rendering `hydrus://` links as inline previews inside Obsidian's editor.
- Caching resolved metadata beyond what `HydrusCache` already persists; an uncached reference is re-resolved on each picker open.
- Pushing a video as an image layer (unchanged Hydrus non-goal — videos are background-only).
