# Hydrus note references — design

> Let the DM embed a direct reference to a Hydrus file inside a note, then pull
> that file in as an image layer (Add Image) or player background (Add BG)
> without re-searching the Hydrus library every time.

## Problem

Today a Hydrus file can only reach the player screen by opening the Hydrus
Explorer and searching by tag. There is no way to pin a specific file to a note
(an NPC portrait, a battle-map, a looping background video) so the DM can drop
it onto the screen straight from the note they are already reading during play.

## Reference format

A standard Markdown link whose target is a custom scheme:

```
[Readable label](hydrus://<sha256-hash>)
```

- `hydrus://` + the file's 64-hex sha256 hash is the only identifier. The hash
  is what Hydrus indexes by, and it is stable across the cache and the API.
- The bracket text is human-editable and is used as the default label of the
  resulting layer/background.
- The same string is produced for images and videos; the media type is not
  encoded in the reference. Type filtering happens when the reference is
  inserted into the screen, not when it is copied.

## Copy from the explorer

The Hydrus Explorer tile `⋮` menu gains one action next to **Copy tags**:

- **Copy image reference** when the tile MIME is an image (`mediaTypeOf` ⇒
  `"image"`).
- **Copy video reference** when the tile MIME is a video.

Both build the identical string `[<label>](hydrus://<hash>)` where `<label>` is
`layerLabelFromTags(tile.knownTags, hash)` (first `name:` tag, else
`Hydrus <8 hex>`), copy it via `navigator.clipboard.writeText`, and show the
Notice `Reference copied.`

## Architecture — `src/hydrus/noteRefs.ts`

A new small module with one pure function and one orchestration function.

### `parseHydrusRefs(noteBody: string): HydrusRef[]`

Pure, no Obsidian dependency, unit-testable in isolation.

- Regex: `/\[([^\]]*)\]\(hydrus:\/\/([0-9a-fA-F]{64})\)/g`.
- Returns `{ label: string, hash: string }[]` in order of appearance.
- Deduplicates by lowercased hash; the first occurrence keeps its label.

### `resolveHydrusRefs(refs, cache, client): Promise<ResolvedHydrusRef[]>`

The only side-effecting unit (cache reads + one network call). Testable with a
fake cache and fake client.

- For each ref, `cache.get(hash)`. A cache hit yields `mime`/`knownTags` from the
  entry — works even when Hydrus is offline.
- Uncached hashes are resolved in a **single** `client.getFileMetadata(hashes)`
  call when `client` is non-null. When `client` is null (Hydrus disabled or no
  credentials) uncached refs stay unresolved.
- Returns per ref: `{ label, hash, mediaType: "image" | "video" | null,
  cached: boolean, available: boolean }`.
  - `available === false` ⇔ uncached AND no client could resolve it. Such a ref
    has `mediaType === null` (type unknown without the server).
  - `mediaType` is derived with `mediaTypeOf(mime)` for every resolved ref.

### `ensureLocalCopy(ref, cache, client): Promise<CachedEntry>`

Thin wrapper over the existing cache download path so the picker code stays
small. Mirrors `HydrusExplorerModal.ensureCached`: returns the cached entry if
present, else `cache.fetchAndCache(client, file)` (downloads bytes + thumb to
the vault). Throws when the file is uncached and `client` is null.

## Integration in Add Image / Add BG

Both existing pickers keep their current note-image discovery and additionally
merge the active note's Hydrus references:

1. Read the active note body, `parseHydrusRefs`, then `resolveHydrusRefs`.
2. **Add Image** (`showImagePicker`): only `mediaType === "image"` resolved refs
   are actionable. Video refs are hidden. Unresolved refs (`available === false`)
   appear **disabled** with a `(offline, not cached)` suffix — their type cannot
   be known without the server, so they show in both pickers.
3. **Add BG** (`showBackgroundPicker`): both `"image"` and `"video"` resolved
   refs are actionable; unresolved refs appear disabled.
4. **Direct-apply rule**: if there is exactly one actionable entry AND no
   disabled entries, apply it directly (today's single-image behaviour).
   Otherwise show the menu.
5. Hydrus entries are marked with an icon + `Hydrus: <label>` title; local
   entries keep `image:` / `portrait:` / `embed:` labels.

### On selection

- `ensureLocalCopy(ref)` downloads to the vault cache if missing (normal Hydrus
  flow), then the file is used **from local** thereafter.
- **Layer**: `addImageLayer(uniqueLayerLabel(panel.imageLayers, ref.label),
  dataUrl, "hydrus", false)` — same path the explorer uses.
- **Background**: broadcast `show-background-media` with `url =
  /vault/<encoded vaultPath>`, `mediaType` from the resolved type, and
  `loop`/`muted` from settings for video — identical to
  `HydrusExplorerModal.handleSetBackground`.
- `cache.markUsed(hash)` after use, for the TTL sweep.

## Broadcast / IPC

No new message types. Reuses `image-layers-sync` (layers) and
`show-background-media` (backgrounds).

## Offline / disabled behaviour

- `hydrusEnabled` false ⇒ `buildHydrusClient()` returns null. Cached refs still
  resolve from disk and remain usable; uncached refs are disabled.
- Online resolution failure (network error) is caught: affected refs fall back
  to `available: false` rather than throwing out of the picker.

## Specs to update

- New `hydrus-integration/note-references.md` — the reference format, parser,
  resolver, and picker integration as EARS requirements.
- `hydrus-integration/explorer.md` — the Copy image/video reference menu action.
- `hydrus-integration/overview.md` — link the new sub-spec.
- `image-layers/overview.md` — Add Image now also lists note Hydrus image refs.
- `background-media/overview.md` — Add BG now also lists note Hydrus image+video
  refs.

## Tests

- `noteRefs.test.ts` (new):
  - `parseHydrusRefs`: single, multiple, dedup by hash, case-insensitive hex,
    malformed/ignored (`hydrus://` with wrong length, plain links), label with
    spaces.
  - `resolveHydrusRefs`: cache hit while offline, remote batch resolution of
    uncached hashes, mixed cached+uncached, unavailable when uncached+no client,
    network error ⇒ unavailable.
  - `ensureLocalCopy`: cache hit returns without network; miss calls
    `fetchAndCache`; miss + null client throws.
- Existing `dm-control-combat.test.ts` extended (or a new dm-side test) for the
  picker merge + direct-apply rule with a stubbed resolver.

## Non-goals

- Editing references in place or a "manage references" UI. The DM writes/edits
  the Markdown link by hand.
- Encoding the media type or tags in the reference string. Only the hash.
- Rendering `hydrus://` links as inline previews inside Obsidian's editor.
- Caching resolved metadata beyond what `HydrusCache` already persists.
- Pushing a video as an image layer (unchanged Hydrus non-goal).

## Versioning

New user-facing capability ⇒ minor bump. `manifest.json` lags at `0.19.0` while
the latest stable tag is `v0.20.0`, so the branch is bumped to `0.21.0-beta.N`
for the test prerelease, and the PR carries `release:minor` (publishes `v0.21.0`
on merge).
