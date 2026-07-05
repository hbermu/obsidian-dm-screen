# Map Screen — AoE Overlays

> Spell areas of effect (circle, square, cone, line) drawn over the battlemap on the table TV, driven from the DM panel. AoEs are DM-managed layers: added from shape presets or a 5e spell catalog, positioned and rotated by dragging in the pan preview, and rendered at true grid scale (1 square = 5 ft) on both the preview and the TV.

## Source files

- `src/map/types.ts` — `AoeShape`, `MapAoe` (incl. optional `label`), `AoePreset`
- `src/map/aoe.ts` — `renderAoe`: pure canvas renderer shared by the TV and the DM preview
- `src/map/spellAoes.ts` — `SPELL_AOES`: generated catalog of 5e spells with a parseable area of effect
- `src/map/map.ts` — `map-aoe-sync` handler; renders the list in `applyLayout()`
- `src/views/SpellAoeModal.ts` — fuzzy-search modal over `SPELL_AOES`
- `src/views/MapScreenPanel.ts` — AoE Overlays section (menu, rows), preview markers (dot + rotation handle), `broadcastAoes` throttle, lifecycle resets

## Settings used

none — AoEs live in DM-panel memory and the server's late-joiner cache, never in settings.

## Requirements

1. Each AoE shall carry `{ id, shape, sizeFt, widthFt, color, opacity, rotation, x, y, label? }`, with `x`/`y` in map pixels and sizes in feet converted at `pxPerSquare / 5` px per foot.
2. The Add AoE menu shall offer the four base shapes (Circle, Square, Cone, Line from `SHAPE_PRESETS`) plus a Spells… entry that opens the `SpellAoeModal`; picking a spell shall add an AoE with the spell's shape, size, and color, labeled with the spell name (shown in its row and dot tooltip). New AoEs spawn at the map center with rotation 0.
3. `SPELL_AOES` shall contain every 5etools spell whose area of effect is parseable from its structured range or entry text, colored by primary damage type; the file is generated, sorted by name, and deduplicated by name across sources.
4. Each AoE row shall expose: shape select, size (ft), width (ft, line only), color, opacity slider, rotation (degrees), and delete; the section header carries Add AoE and, when any AoE exists, Clear All.
5. The map client shall render each AoE on the grid canvas as a filled+stroked path — circle of `sizeFt` radius, square of `sizeFt` side centered, cone from the vertex spanning 53°, line of `sizeFt` × `widthFt` from the anchor — filled at the AoE's opacity and stroked at full alpha in its color.
6. `renderAoe` shall place the shape at `T + s·R(θ)·p` (the stage transform) and rotate it by `aoe.rotation + θ`, so AoEs stay attached to the map under every 90° view rotation.
7. In the DM pan preview (both scale modes), the real AoE footprints shall be drawn on an overlay canvas at preview scale; each AoE carries a draggable anchor dot (move) and, for non-circles, a diamond rotation handle at the shape's tip (cone/line) or mid-edge (square) that rotates in 5° steps. Both markers counter-scale with the preview zoom.
8. Drag moves, handle rotations, and opacity slides shall broadcast `map-aoe-sync` throttled to 80 ms with an immediate broadcast on release; structural edits (add, delete, clear, shape/size/width/color/rotation-field changes) broadcast immediately. Size/width/opacity edits redraw the preview canvas in place.
9. When a map is applied, the DM panel shall reset the AoE list and broadcast the empty `map-aoe-sync` (overwriting any cached list); when Stop Map is clicked or `map-clear` arrives, both DM and map sides shall reset to empty.
10. `republishToServer()` shall re-broadcast `map-aoe-sync` when the list is non-empty, and the DM panel shall restore its AoE list from the cached `map-aoe-sync` on open, so both a restarted server and a reopened panel converge on the same state.

## Broadcast / IPC

| Message type | Direction | Payload | When |
|--------------|-----------|---------|------|
| `map-aoe-sync` | DM → map | `{ aoes: MapAoe[] }` | Any AoE change (drags throttled per requirement 8); empty list on map apply; `republishToServer()` when non-empty |

## Tests covering this

- `src/__tests__/map-aoe-render.test.ts` — shape paths, ft→px sizing, rotation-composed placement, fill/stroke styling
- `src/__tests__/map-screen-panel-aoe.test.ts` — restore from cache, stopMap reset, republish inclusion, broadcast throttle with forced flush

## Non-goals

- Snapping AoEs to the grid. Free placement is the point — templates sit where the spell lands.
- Persisting AoEs per map in `mapConfigs`. They are ephemeral combat state; the late-joiner cache covers reconnects.
- AoEs on the player screen at `/`. Map channel only.
- Regenerating `SPELL_AOES` at runtime or shipping the 5etools data. The catalog is a committed, generated file.
