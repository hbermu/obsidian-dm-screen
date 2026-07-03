# Image Layers

> A stack of independently positioned, scaled, and rotated images composited on top of the background media on the player screen. Layers are added from the active note (via Add Image — both its local images and its `hydrus://` references), from the Hydrus library (as cached images), or from the D&D Beyond monster avatar fetcher. The DM manipulates them in the preview area; structural changes are broadcast in full (`image-layers-sync`), while continuous gestures (drag, scale slider) stream lightweight `image-layers-geometry` patches so movement stays fluid on the player.

## Source files

- `src/types.ts` — `ImageLayer` and `LayerGeometry` interfaces
- `src/views/DmControlPanel.ts` — preview rendering (drag), layer list rendering (controls), `addImageLayer`, `broadcastImageLayers`, `broadcastLayerGeometry` (trailing-throttled), `broadcastAndRender`, `makeDraggable`, `moveLayerUp` / `moveLayerDown`, `showImagePicker`, `collectHydrusRefEntries`, `applyHydrusRef`, image-source frontmatter discovery
- `src/hydrus/noteRefs.ts` — resolves and downloads the active note's `hydrus://` image references for the Add Image picker (see `../hydrus-integration/note-references.md`)
- `src/player/layerRenderer.ts` — `LayerRenderer`, the id-keyed DOM reconciler for the layer stack (`sync`, `applyGeometry`, `resync`, `clear`)
- `src/player/player.ts` — wires `image-layers-sync` / `image-layers-geometry` / `clear` / resize to the `LayerRenderer`; viewport pan/zoom of the layer container is applied via `updateViewport`
- `src/player/player.css` — `.no-border` class, gold border on `.image-layer-frame`

## Settings used

- `lastImageLayers` — JSON-serialised `ImageLayer[]` (without per-image data URLs trimmed) persisted on close, restored on open

## Requirements

1. The DM panel shall maintain an array of `ImageLayer` objects, each with: `id`, `label`, `dataUrl`, `x`, `y`, `width`, `height` (all four as percentages 0–100), `zIndex`, `rotation` (degrees), `visible`, `fogEnabled`, `fogDataUrl`, `bordered`.
2. The DM panel shall assign a monotonically increasing `zIndex` to every new layer.
3. The DM panel shall refuse to add a layer whose `label` (case-insensitive) equals an existing layer's label.
4. When a layer is added, the DM panel shall load the image off-screen, derive `width` and `height` as percentages from the natural pixel dimensions over the effective resolution, clamp both so neither exceeds 100% while preserving aspect ratio, centre the layer in the viewport, then broadcast `image-layers-sync`.
5. When `noteType` is `"person"` or `"monster"`, the new layer shall be sized as a portrait (30%×60% at 35,20) instead of pixel-derived dimensions.
6. The DM panel shall sort layers by `zIndex` ascending when rendering them on the preview and on the player.
7. Each layer shall be rendered on the player inside a wrapper div positioned `absolute` with `left/top/width/height` percentages relative to a `100vw × 100vh` inner frame.
8. Inside each wrapper, the player shall render an `.image-layer-frame` div that contains the layer image (and the fog overlay when enabled). On image load, the frame shall be resized to the rectangle the image actually occupies inside the wrapper — preserving the image's natural aspect ratio — so the gold border hugs the visible image content and the fog overlay aligns with the image. The frame is centred inside the wrapper via flex.
9. While `layer.bordered !== false`, the `.image-layer-frame` shall carry the gold-bordered CSS rule.
10. If `layer.bordered === false`, the `.image-layer-frame` shall carry the `.no-border` class.
11. The player shall apply `transform: rotate(<rotation>deg)` to the wrapper when `rotation` is non-zero.
12. While `layer.visible` is false, the player shall not render that layer (hidden layers are filtered on sync and removed by a `visible: false` geometry entry).
12b. The player shall reconcile the layer stack keyed by `layer.id`: DOM nodes are reused across syncs, and `img.src` (and the fog overlay's src) shall be reassigned only when the corresponding data URL actually changed — reassignment forces a re-decode and visible flicker.
12c. When the player receives `image-layers-geometry`, it shall update only wrapper geometry (`x`, `y`, `width`, `height`, `zIndex`, `rotation`, border class, visibility) for known layer ids — unknown ids are ignored — and shall merge the entries into its last-synced layer state so a resize-triggered resync keeps the latest geometry.
13. When the Add Image picker is invoked, it shall also list the active note's `hydrus://` image references and add the selected one as a cached image layer; the reference parsing, resolution, and download are specified in `../hydrus-integration/note-references.md`.
14. Detailed per-layer DM controls are specified in `layer-controls.md`.
15. State persistence and restore behaviour are specified in `persistence.md`.
16. Fog of war on a per-layer basis is specified in `../fog-of-war/overview.md`.

## Broadcast / IPC

| Message type | Direction | Payload | When |
|--------------|-----------|---------|------|
| `image-layers-sync` | DM → player | `{ layers: ImageLayer[] }` | Any add, remove, rotate, visibility toggle, border toggle, z-order swap, or fog change; the end of a drag (mouseup) or scale gesture (change event) |
| `image-layers-geometry` | DM → player | `{ layers: LayerGeometry[] }` (`id` + geometry fields, no data URLs) | During a drag or scale-slider gesture, trailing-throttled at 50 ms; immediately after every `image-layers-sync` |

The cache rule for both is the standard one in `../player-server/websocket-protocol.md`: the server keeps the latest payload per type, and every full sync is followed by a fresh geometry broadcast so the cached pair replays consistently to late joiners.

## Tests covering this

- `src/__tests__/dm-control-combat.test.ts` — layer addition does not duplicate by label, `addImageLayer` flow, republish emits sync + geometry pair
- `src/__tests__/layer-renderer.test.ts` — node reuse across syncs, src reassigned only on data-URL change, geometry-only updates, unknown-id/visibility handling, fog overlay lifecycle, URL validation, clear
- `src/__tests__/server-broadcast.test.ts` — `image-layers-sync` is cached and replayed to late joiners
- `src/__tests__/ddb-to-player.integration.test.ts` — DDB monster-image layers reach the player
- `test/visual/layers-fog.spec.ts` — Playwright visual regression: two stacked image layers rendered on the real player bundle, with and without fog overlays. Asserts wrapper geometry, frame sizing (aspect-preserving), and z-order. See `../player-server/overview.md`.

## Non-goals

- Animated layer transitions. Position and scale updates are applied immediately.
- Per-layer cropping. The image is always rendered with `object-fit: contain`.
- Sub-pixel positioning on the player. Percentages are applied as-is and rendered by the browser.
- Sharing of layers across player clients with different transforms. Every client sees the same payload; viewport pan/zoom is the only per-client transform (see `../dm-preview/overview.md`).
- Reviving the legacy duplicate "exploration mode" / "combat mode" sections. There is one layer-controls section.
