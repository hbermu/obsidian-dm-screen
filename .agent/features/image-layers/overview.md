# Image Layers

> A stack of independently positioned, scaled, and rotated images composited on top of the background media on the player screen. Layers are added from the active note (via Add Image), from the Hydrus library (as cached images), or from the D&D Beyond monster avatar fetcher. The DM manipulates them in the preview area; every change is broadcast in full.

## Source files

- `src/types.ts` — `ImageLayer` interface
- `src/views/DmControlPanel.ts` — preview rendering (drag), layer list rendering (controls), `addImageLayer`, `broadcastImageLayers`, `broadcastAndRender`, `makeDraggable`, `moveLayerUp` / `moveLayerDown`, `showImagePicker`, image-source frontmatter discovery
- `src/player/player.ts` — `syncImageLayers` renders the layer stack on the player; viewport pan/zoom of the layer container is applied via `updateViewport`
- `src/player/player.css` — `.no-border` class, gold border on `#image-layers-inner > div > img:first-child`

## Settings used

- `lastImageLayers` — JSON-serialised `ImageLayer[]` (without per-image data URLs trimmed) persisted on close, restored on open

## Requirements

1. The DM panel shall maintain an array of `ImageLayer` objects, each with: `id`, `label`, `dataUrl`, `x`, `y`, `width`, `height` (all four as percentages 0–100), `zIndex`, `rotation` (degrees), `visible`, `fogEnabled`, `fogDataUrl`, `bordered`.
2. The DM panel shall assign a monotonically increasing `zIndex` to every new layer.
3. The DM panel shall refuse to add a layer whose `label` (case-insensitive) equals an existing layer's label.
4. When a layer is added, the DM panel shall load the image off-screen and size the rectangle from the natural image dimensions relative to the effective resolution, then broadcast `image-layers-sync`.
5. When `noteType` is `"person"` or `"monster"`, the new layer shall be sized as a portrait (30%×60% at 35,20) instead of pixel-derived dimensions.
6. The DM panel shall sort layers by `zIndex` ascending when rendering them on the preview and on the player.
7. Each layer shall be rendered on the player inside a wrapper div positioned `absolute` with `left/top/width/height` percentages relative to a `100vw × 100vh` inner frame.
8. While `layer.bordered !== false`, the rendered player image shall carry the gold-bordered CSS rule.
9. If `layer.bordered === false`, then the player image shall carry the `.no-border` class.
10. The player shall apply `transform: rotate(<rotation>deg)` to the wrapper when `rotation` is non-zero.
11. While `layer.visible` is false, the player shall not render that layer (filter applied in `syncImageLayers`).
12. Detailed per-layer DM controls are specified in `layer-controls.md`.
13. State persistence and restore behaviour are specified in `persistence.md`.
14. Fog of war on a per-layer basis is specified in `../fog-of-war/overview.md`.

## Broadcast / IPC

| Message type | Direction | Payload | When |
|--------------|-----------|---------|------|
| `image-layers-sync` | DM → player | `{ layers: ImageLayer[] }` | Any add, remove, drag, scale, rotate, visibility toggle, border toggle, z-order swap, or fog change |

The cache rule for `image-layers-sync` is the standard one in `../player-server/websocket-protocol.md`: the server keeps the latest payload only.

## Tests covering this

- `src/__tests__/dm-control-combat.test.ts` — layer addition does not duplicate by label, `addImageLayer` flow
- `src/__tests__/server-broadcast.test.ts` — `image-layers-sync` is cached and replayed to late joiners
- `src/__tests__/ddb-to-player.integration.test.ts` — DDB monster-image layers reach the player

## Non-goals

- Animated layer transitions. Position and scale updates are applied immediately.
- Per-layer cropping. The image is always rendered with `object-fit: contain`.
- Sub-pixel positioning on the player. Percentages are applied as-is and rendered by the browser.
- Sharing of layers across player clients with different transforms. Every client sees the same payload; viewport pan/zoom is the only per-client transform (see `../dm-preview/overview.md`).
- Reviving the legacy duplicate "exploration mode" / "combat mode" sections. There is one layer-controls section.
