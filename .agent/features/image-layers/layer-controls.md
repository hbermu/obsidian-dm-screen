# Layer Controls (DM panel)

> Per-layer UI controls in the DM Control Panel: drag-to-move on the preview, plus a row of buttons and a scale slider for every layer.

## Source files

- `src/views/DmControlPanel.ts` — `renderPlayerScreenSection` loops `imageLayers` and renders the row; `makeDraggable` binds preview drag; `moveLayerUp` / `moveLayerDown` swap z-order; scale slider, rotation buttons, alignment buttons, fit buttons, visibility, fog, border, and remove buttons are wired here

## Settings used

- `none`

## Requirements

### Preview drag

1. The DM panel preview shall render each visible layer as a `.dm-layer-rect` positioning wrapper sized to the layer's percentage geometry, plus a nested `.dm-layer-rect-frame` that carries the layer's `dataUrl` background, the colored border, the fog overlay, and the fog-edit canvas. The frame is sized at image-load time to the actual rectangle the image occupies inside the wrapper (preserving its natural aspect ratio) so the DM-side colored border hugs the visible image — same behaviour as the player-side `.image-layer-frame`.
2. When the user mousedown-drags a layer rectangle on the preview, the DM panel shall update `layer.x` and `layer.y` in real time, stream `image-layers-geometry` during the drag (trailing-throttled at 50 ms via `broadcastLayerGeometry`), and call `broadcastImageLayers` on mouseup.
3. While a layer is in fog-edit mode (`fogEditLayerId === layer.id`), the DM panel shall NOT install the drag handlers on that layer (drawing takes precedence).

### Layer row buttons (left column, top to bottom)

4. The visibility button shall toggle `layer.visible` and broadcast on every change. The button shall show `👁` when visible and `👁‍🗨` when hidden.
5. The fog button shall toggle `layer.fogEnabled` and, when enabling, initialise the fog canvas (see `../fog-of-war/overview.md` requirement 1). When disabling, the fog button shall reset `layer.fogDataUrl` to the empty string and exit fog-edit mode if it was active for this layer.
6. The border button shall toggle `layer.bordered` (default true). Off renders without the gold border on the player.

### Scale slider (middle column)

7. The scale slider shall control `layer.width` as a percentage, range `10`–`500`.
8. When the slider value changes, the DM panel shall adjust `layer.width` and `layer.height` so that the aspect ratio is preserved and the layer's centre stays in place; every input event shall stream `image-layers-geometry` (trailing-throttled) and the slider's change event shall broadcast the full `image-layers-sync`.
9. When the user holds Shift and presses ArrowLeft / ArrowRight on the slider, the slider value shall snap to the next lower or higher multiple of 10.

### Rotation, z-order, remove (right column, top row)

10. The rotate-left button shall decrement `layer.rotation` by 15° (modulo 360) and broadcast.
11. The rotate-right button shall increment `layer.rotation` by 15° (modulo 360) and broadcast.
12. The up button shall swap `zIndex` with the layer above this one in the sorted list (no-op if already on top).
13. The down button shall swap `zIndex` with the layer below this one in the sorted list (no-op if already on bottom).
14. The remove button shall delete the layer from `imageLayers`, drop the fog canvas from `fogCanvases`, exit fog-edit if it was active for this layer, and broadcast.

### Fit / align buttons (right column, bottom row)

15. The `W` button shall resize the layer to the connected client's viewport width, preserve aspect ratio for the height, and centre vertically inside the viewport. If no client is connected, show a `No player connected` Notice and do nothing.
16. The `H` button shall resize the layer to the viewport height, preserve aspect ratio for the width, and centre horizontally inside the viewport. Same Notice rule as `W`.
17. The `◀` button shall set `layer.x` to the viewport's left edge and `layer.y` so the layer is centred vertically inside the viewport.
18. The `◆` button shall centre the layer both horizontally and vertically inside the viewport.
19. The `▶` button shall set `layer.x` so the layer's right edge sits on the viewport's right edge and `layer.y` so the layer is centred vertically inside the viewport.

### Bulk controls (below the layer list)

20. The `Clear All Layers` button shall reset `imageLayers` to empty, reset `nextZIndex` to 1, broadcast `image-layers-sync` with an empty array, and re-render.
21. The `Clear Player Screen` button shall additionally broadcast `clear`, set `activeBackgroundUrl` and `activeVideoPath` to null, and show a `Player screen cleared` Notice.

### Right-click context menu

22. When the user right-clicks a `.dm-layer-row`, the DM panel shall prevent the default browser context menu and open an Obsidian `Menu` whose contents are built by `buildLayerContextMenu` from `src/views/layerContextMenu.ts`. The send-to behaviour is specified in `../webhook-send/overview.md`.

## Tests covering this

- `src/__tests__/dm-control-combat.test.ts` — visibility / z-order / remove flows
- `src/__tests__/viewport-calc.test.ts` — viewport rect math feeds the `W`/`H` / align buttons (the fit / align buttons themselves stay unit-covered here — their positive path needs a connected player reporting a viewport)
- `test/e2e/specs/layer-controls.e2e.ts` — real Obsidian: the row buttons drive live broadcasts — visibility toggles `visible` (row gains `dm-layer-hidden`), border toggles `bordered`, rotate-right advances `rotation` by 15°, the down button swaps `zIndex` with the layer below, remove drops the layer, and the scale slider streams `image-layers-geometry` then commits an aspect-preserving, centre-preserving resize via `image-layers-sync`. The multi-image Add Image picker opens an Obsidian `Menu` and `Add all` commits every source (frontmatter `image:` + body embed)

## Non-goals

- Multi-select. Operations are one layer at a time.
- Snapping to a grid. Drag is free-form in percentage space.
- Undo / redo. State changes are immediate and broadcast.
- Keyboard nudge for position. Only the scale slider has Shift-Arrow keyboard support.
