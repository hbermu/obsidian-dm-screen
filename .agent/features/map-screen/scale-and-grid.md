# Map Screen — Scale, Pan and Grid

> How a map is sized on the screen and how the grid overlay is drawn. Every map is treated as a lattice of `pxPerSquare` map pixels per grid square (default 70 — the Czepeku/Roll20 export standard), whether or not the grid is drawn into the image. Physical mode renders one square as one real inch using the screen's calibration; the grid overlay draws that same lattice for gridless maps.

## Source files

- `src/map/transform.ts` — `mapScale`, `mapTranslation`, `clampPan`, `gridLinePositions`, `defaultMapState`, `DEFAULT_PX_PER_SQUARE`, `DEFAULT_GRID_CONFIG`
- `src/map/map.ts` — `applyLayout()` applies transform and paints the grid canvas
- `src/views/MapScreenPanel.ts` — mode toggle, grid controls, pan preview with viewport rectangle

## Settings used

- `mapConfigs` — per-map remembered `StoredMapState` (all values below)

## Requirements

1. Every map shall carry a `pxPerSquare` (default `70`) meaning "map pixels per grid square". Czepeku exports divide evenly by 70 (e.g. 4480×7000 = 64×100 squares), so the default is correct for both the Gridded and Gridless variant of the same map.
2. In `fit` mode, the scale shall be `min(viewportW / naturalW, viewportH / naturalH)` and the map shall be centered; pan is ignored.
3. In `physical` mode, the scale shall be `ppi / pxPerSquare` (ppi per `calibration.md`), so one grid square renders as exactly one physical inch; `panX`/`panY` are the map-pixel coordinates rendered at the viewport center.
4. The pan point shall be clamped to the map bounds (`clampPan`).
5. New maps shall start in `fit` mode with the pan centered (`defaultMapState`); mode, pan, and grid config are remembered per map URL and reapplied when the same map is shown again.
6. In physical mode, the DM pan preview shall draw a viewport rectangle sized `clientW/scale × clientH/scale` map pixels (using the first connected map client, else the `tvWidth`×`tvHeight` fallback); dragging the rectangle or clicking/dragging elsewhere in the preview re-centers the pan there. Broadcasts during a drag are throttled (single trailing `map-view` per 80 ms) and the final position is broadcast immediately and persisted on mouse-up.
7. The grid overlay shall be drawn on a full-viewport canvas above the media: lines every `pxPerSquare × scale` screen pixels in both axes, phased so they align with the map lattice at `(gridOffsetX, gridOffsetY)` map pixels — the grid pans and scales with the map in both modes.
8. `gridLinePositions` shall return no lines when the screen-space pitch is ≤ 1 px (a solid fill, not a grid).
9. Grid appearance shall come from `map-config`: `showGrid` (default off — gridded map variants already carry their grid), `gridColor` (default `#000000`), `gridOpacity` (default `0.35`), all editable from the DM grid controls and broadcast on change.
10. The grid canvas shall be sized in device pixels (`viewport × devicePixelRatio`) so lines stay crisp on high-dpr screens.

## Broadcast / IPC

| Message type | Direction | Payload | When |
|--------------|-----------|---------|------|
| `map-view` | DM → map | `{ mode: "physical" \| "fit", panX: number, panY: number }` | Mode toggle; pan drag (throttled); map applied |
| `map-config` | DM → map | `{ pxPerSquare, gridOffsetX, gridOffsetY, showGrid, gridColor, gridOpacity }` | Any grid control change; map applied |

## Tests covering this

- `src/__tests__/map-transform.test.ts` — fit/physical scale, 1-inch invariant (`70 × scale = ppi`), translation centering and pan-at-center, clamping, grid pitch/phase/degenerate cases, defaults

## Non-goals

- Zoom levels other than fit and physical. Physical scale is the point of the feature; fit is the overview.
- Rotating the map. Rotate the TV or the players instead.
- Per-square distance markers, rulers, or measurement tools.
- Hex grids. Square lattice only.
- Auto-detecting `pxPerSquare` from image analysis. 70 covers the library; the input covers the rest.
