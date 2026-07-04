# Map Screen — Scale, Pan and Grid

> How a map is sized on the screen and how the grid overlay is drawn. Every map is treated as a lattice of `pxPerSquare` map pixels per grid square (default 140 — the cell size of Czepeku's full-resolution exports), whether or not the grid is drawn into the image. Physical mode renders one square as one real inch using the screen's calibration; the grid overlay draws that same lattice for gridless maps.

## Source files

- `src/map/transform.ts` — `mapScale`, `mapTranslation`, `clampPan`, `gridLinePositions`, `defaultMapState`, `DEFAULT_PX_PER_SQUARE`, `DEFAULT_GRID_CONFIG`
- `src/map/map.ts` — `applyLayout()` applies transform and paints the grid canvas
- `src/views/MapScreenPanel.ts` — mode toggle, grid controls, pan preview with viewport rectangle

## Settings used

- `mapConfigs` — per-map remembered `StoredMapState` (all values below)
- `mapDefaultPxPerSquare` — cell size assumed for maps without a remembered config (settings-tab field, default `140`, values < 5 rejected)

## Requirements

1. Every map shall carry a `pxPerSquare` meaning "map pixels per grid square". Maps without a remembered config start from the `mapDefaultPxPerSquare` setting (default `140` — Czepeku full-resolution exports use 140 px cells, e.g. 4480×7000 = 32×50 squares; the Gridded and Gridless variants of a map share dimensions, so one value covers both).
1b. The view shall carry a `rotation` of `0 | 90 | 180 | 270` degrees (absent means `0`, so pre-rotation cached payloads stay valid). The map client applies it as `translate(tx,ty) rotate(θ) scale(s)` around the map origin; a Rotate button in the DM section cycles it in 90° steps.
2. In `fit` mode, the scale shall be `min(viewportW / rotatedW, viewportH / rotatedH)` — the bounding box swaps sides at 90°/270° (`rotatedSize`), which is how a portrait map gains space on a landscape TV — and the rotated map shall be centered; pan is ignored.
3. In `physical` mode, the scale shall be `ppi / pxPerSquare` (ppi per `calibration.md`) regardless of rotation, so one grid square renders as exactly one physical inch; `panX`/`panY` are the map-pixel coordinates rendered at the viewport center (`mapTranslation` places `s·R(θ)·pan` at the center).
4. The pan point shall be clamped so the physical-mode window never leaves the map (`clampPan`): each axis is constrained to `[halfVis, natural − halfVis]` where `halfVis` is half the visible window in map pixels (viewport sides swapped at 90°/270° via `rotatedSize`); when the map is smaller than the window on an axis, the pan centres on that axis (see `overview.md` requirement 13 for when re-clamping runs).
5. New maps shall start in `fit` mode, unrotated, with the pan centered (`defaultMapState`); mode, pan, rotation, and grid config are remembered per map URL and reapplied when the same map is shown again.
6. In physical mode, the DM pan preview shall stay in map orientation and draw a viewport rectangle sized `clientW/scale × clientH/scale` map pixels, swapping the two sides when the rotation is 90° or 270° (using the first connected map client, else the `tvWidth`×`tvHeight` fallback); dragging the rectangle or clicking/dragging elsewhere in the preview re-centers the pan there. Broadcasts during a drag are throttled (single trailing `map-view` per 80 ms) and the final position is broadcast immediately and persisted on mouse-up.
6b. The rectangle percentages and the drag pixel→map conversion shall reference a stage element sized to the map's exact rendered box (letterbox-fit into the panel width × 340 px, explicitly in pixels), never the letterboxed container — a container-relative frame skews the rectangle for any map whose aspect differs from the container's.
7. The grid overlay shall be drawn on a full-viewport canvas above the media: lines every `pxPerSquare × scale` screen pixels in both axes, phased so they align with the map lattice at `(gridOffsetX, gridOffsetY)` map pixels — the grid pans, scales, and rotates with the map in both modes (90°-multiple rotations keep the lattice axis-aligned; `gridAxisOffsets` routes each map axis to the correct screen axis with the correct sign).
8. `gridLinePositions` shall return no lines when the screen-space pitch is ≤ 1 px (a solid fill, not a grid).
9. Grid appearance shall come from `map-config`: `showGrid` (default off — gridded map variants already carry their grid), `gridColor` (default `#000000`), `gridOpacity` (default `0.35`), all editable from the DM grid controls and broadcast on change.
10. The grid canvas shall be sized in device pixels (`viewport × devicePixelRatio`) so lines stay crisp on high-dpr screens.

## Broadcast / IPC

| Message type | Direction | Payload | When |
|--------------|-----------|---------|------|
| `map-view` | DM → map | `{ mode: "physical" \| "fit", panX: number, panY: number, rotation: 0 \| 90 \| 180 \| 270 }` | Mode toggle; Rotate button; pan drag (throttled); map applied |
| `map-config` | DM → map | `{ pxPerSquare, gridOffsetX, gridOffsetY, showGrid, gridColor, gridOpacity }` | Any grid control change; map applied |

## Tests covering this

- `src/__tests__/map-transform.test.ts` — fit/physical scale, 1-inch invariant (`140 × scale = ppi`), translation centering and pan-at-center, clamping, grid pitch/phase/degenerate cases, defaults, rotation (point mapping, rotated fit bbox, rotation-independent physical scale, centered rotated fit, grid axis routing)

## Non-goals

- Zoom levels other than fit and physical. Physical scale is the point of the feature; fit is the overview.
- Rotation angles other than 90° steps. Arbitrary angles would break the axis-aligned grid overlay and buy nothing at the table.
- Per-square distance markers, rulers, or measurement tools.
- Hex grids. Square lattice only.
- Auto-detecting `pxPerSquare` from image analysis. 140 covers the library; the input covers the rest.
