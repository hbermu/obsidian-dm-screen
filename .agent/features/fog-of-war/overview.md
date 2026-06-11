# Fog of War

> Per-layer fog rendered as a semi-transparent black overlay on top of the image. The DM draws on the layer with one of six tools (three reveal, three fog) to expose or re-cover regions. The fog is a PNG canvas stored as a data URL inside the layer; players see it baked on top of the layer image.

## Source files

- `src/views/DmControlPanel.ts` — `initFogCanvas`, `getFogCanvas`, `syncFogToLayer`, `initInlineFogCanvas`, `setupInlineFogDrawing`, `createFogToolBtn`, `fogEditLayerId`, `fogTool`, `fogCanvases`, plus the fog editor UI rendered below each layer row
- `src/types.ts` — `fogEnabled`, `fogDataUrl` on `ImageLayer`
- `src/player/player.ts` — fog overlay rendered as a sibling `<img>` inside each layer wrapper in `syncImageLayers`
- `src/player/player.css` — fog overlay sizing is inherited from the parent wrapper

## Settings used

- `none` (fog state is part of `ImageLayer`, persisted via `lastImageLayers`)

## Requirements

1. When the user enables fog for a layer that has no `fogDataUrl`, the DM panel shall create an offscreen canvas of width `1024` and height `1024 × (image.naturalHeight / image.naturalWidth)`, fill it black, and store it in `fogCanvases` keyed by `layer.id`. The data URL of that canvas shall become `layer.fogDataUrl`.
2. When the user enables fog for a layer that already has a `fogDataUrl` from persistence, the DM panel shall recreate the offscreen canvas from that data URL when first edited.
3. While `layer.fogEnabled` is true, the player shall render an `<img>` with `src = layer.fogDataUrl` inside the layer's `.image-layer-frame` element (the same parent that holds the layer image), positioned `absolute` and sized 100%/100% so it covers the image. (The wrapper chain on the player is `wrapper > .image-layer-frame > [layerImg, fogImg]` — fog is a sibling of the layer image, not of the frame.)
4. When the user toggles fog OFF, the DM panel shall reset `layer.fogDataUrl` to the empty string and exit fog-edit mode for that layer if it was active.
5. While a layer is in fog-edit mode, the DM panel shall add the `dm-fog-editing` class to the preview rectangle and overlay an inline canvas the same size for drawing.
6. The Escape key shall exit fog-edit mode globally (`fogEditLayerId = null`) and re-render.
7. The fog data URL shall be re-encoded from the offscreen canvas and broadcast in `image-layers-sync` on every mouseup that completes a draw (see `drawing-tools.md`).

## Broadcast / IPC

Fog updates ride on `image-layers-sync` (specified in `../image-layers/overview.md`). There is no separate fog message type.

## Tests covering this

- `src/__tests__/dm-control-combat.test.ts` — fog enable/disable flows touching state, no canvas in the test environment
- `test/visual/layers-fog.spec.ts` — Playwright visual regression covering the player-side rendering of full fog, circle reveal, rect reveal, and freehand reveal masks. The mask PNGs are generated deterministically in the harness; this suite does not exercise DM-side drawing.

## Non-goals

- Player-side fog drawing. Players cannot reveal or fog; they only render what the DM broadcasts.
- Fog persistence across renames of a layer. Fog is keyed by `layer.id` (timestamp at creation); changing the label does not affect fog.
- Multiple simultaneous fog editors (a single layer at a time via `fogEditLayerId`).
- Sub-pixel brush smoothing. Freehand draws as a sequence of circles; aliasing is acceptable.
- Adjustable brush size in the UI. Brush size is a fixed 5% of the fog canvas width.
- Adjustable fog opacity. The overlay is rendered at the canvas's own pixel opacity (black = opaque, transparent = revealed).
