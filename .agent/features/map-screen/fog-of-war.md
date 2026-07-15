# Map Screen Fog of War

> A single PNG mask painted by the DM over the active battlemap: black hides, transparent reveals. Edited in a dedicated modal (brush / rectangle / grid-cell / room-reveal, reveal or cover), rendered on the map screen inside the stage transform, and persisted per map as a vault sidecar PNG keyed by the map's `/vault/` URL — note images and Hydrus-cached files alike. A companion Walls editor in the same modal defines line segments that block line-of-sight; walls are persisted as a JSON sidecar and broadcast as `map-walls` so vision holes are clipped to LoS on the client.

## Source files

- `src/map/fog.ts` — `FOG_RESOLUTION`, `fogCanvasSize`, `fogSidecarPath`, `gridCellRectAt`, `loadFogSidecar`, `saveFogSidecar`, `FogAdapter`, `CellRect`
- `src/map/walls.ts` — `wallsSidecarPath`, `loadWallsSidecar`, `saveWallsSidecar`, `floodRegion`
- `src/map/los.ts` — `blocksSight`, `visibilityPolygon`
- `src/views/MapFogModal.ts` — the editing modal (fog tab + walls tab, drawing handlers, drag cleanup)
- `src/views/MapScreenPanel.ts` — `fogDataUrl`, `broadcastFog`, `commitFog`; `walls`, `broadcastWalls`, `commitWalls`; sidecar loads in `setVaultMap`; restore in `restoreFromCache`; re-emit in `republish`; resets in `stopMap`; the Fog button; `visions`, `broadcastVisions`, `bakeVisions`, `renderVisionControls`, vision dots in `renderPanPreview`
- `src/map/map.ts` — `showFog`, `recompositeFog`, fog/vision/walls clearing in `clearMap`
- `src/map/vision.ts` — `eraseVision`, `eraseVisionWithWalls`
- `src/map/types.ts` — `MapVision`, `MapWall` interfaces
- `src/server.ts` — the `#map-fog` canvas element in the inline map page HTML
- `src/settings.ts` — `mapFogTvOpacity`

## Settings used

- `mapFogTvOpacity` — fog opacity on the map screen (default 1); changing it re-broadcasts fog through the open DM panel

## Requirements

1. While a map is active, the Map Screen section shall render a Fog button that opens `MapFogModal`; the label reads `Fog ●` when the map has fog and `Fog` otherwise.
2. The fog mask shall be an offscreen canvas of width `1024` (`FOG_RESOLUTION`) and height `max(1, round(1024 × naturalHeight/naturalWidth))`; black = hidden, transparent = revealed. A map with no stored fog starts fully transparent.
3. The modal shall expose two tabs (`dm-fog-tabs`): **Fog** and **Walls**. Switching tabs rebuilds the toolbar and reattaches drawing listeners; the stage and overlay are shared.
4. The Fog tab shall offer Reveal/Cover modes × Brush (stamped circles sized by a 2–15% slider), Rectangle (dashed marquee — `#7bd88f` reveal / `#f97583` cover — committed on mouseup), Grid cell (whole cells snapped via `gridCellRectAt`), Grid rect (same dashed marquee as Rectangle but the committed rect is snapped to whole grid cells), and Room tools, plus Reveal All and Cover All. Reveal composites with `destination-out`; Cover paints opaque black with `source-over`. The mask renders at 0.55 alpha in Fog mode (0.25 in Walls mode) so the DM sees the map beneath.
5. The Room tool (Fog tab) shall: (a) rasterize all `blocksSight` walls at fog resolution onto a temporary canvas, read `getImageData` to build a `blocked` mask, and seal the mask's 1px outer border (the map edge acts as a wall, mirroring how `visibilityPolygon` closes with the bounds rect), then call `floodRegion(blocked, w, h, fx, fy)`; (b) if `floodRegion` returns null show `new Notice("That point is inside a wall")` and return; (c) otherwise paint the region onto the fog canvas via `applyMode` + `drawImage`, call `redraw()` and `commit()`.
6. When a stroke completes (mouseup), when Reveal All / Cover All is clicked, or when the Room tool fires, the modal shall call `commitFog`, which re-encodes the mask as a PNG data URL, writes the sidecar, and broadcasts `map-fog { dataUrl, opacity: mapFogTvOpacity }`.
7. The sidecar shall live at `.dm-screen/fog/<tail>-<fnv1a(mapUrl)>.png`, where `<tail>` is the sanitized last 60 characters of the decoded vault path (fallback `x` when sanitization strips everything) — deterministic per map URL, identical for note-image and Hydrus-cached maps.
8. When a map is applied, `setVaultMap` shall load the fog sidecar into `fogDataUrl` (or null) and the walls sidecar into `walls`, then broadcast `map-fog` and `map-walls` alongside the other map messages.
9. When the map client receives `map-fog` with a data URL, it shall validate it with `safePlayerUrl(url, "image")` and composite into `#map-fog`: draw the fog image at natural size, then erase each active vision shape via `eraseVisionWithWalls`. Canvas display is set to `block` at the payload opacity; `dataUrl: null` clears and hides the canvas. Rejected URLs are logged via `console.warn` and skipped.
10. `eraseVisionWithWalls(ctx, vision, scale, pxPerSquare, walls, mapWidth, mapHeight)` shall: if no wall `blocksSight`, fall through to `eraseVision`; otherwise compute `visibilityPolygon` from the vision centre, clip the canvas to the polygon path, then call `eraseVision` inside the clip; skip when the polygon has fewer than 3 points.
11. When the map client receives `map-vision` with a `visions` array, it shall store the list and recomposite the fog canvas immediately (no-op when no fog image is loaded).
12. When the map client receives `map-walls` with a `walls` array, it shall store the list and recomposite the fog canvas immediately.
13. `map-clear` shall clear and hide the fog canvas and reset visions and walls on the client; `stopMap` resets `fogDataUrl` and `walls` to null/empty — sidecars are never deleted, so re-adding the same map restores them.
14. `restoreFromCache` shall recover `fogDataUrl` from the `map-fog` slot and `walls` from the `map-walls` slot; `republish()` shall re-broadcast `map-fog` and `map-walls` while a map is active.
15. When `mapFogTvOpacity` changes in settings, the plugin shall re-broadcast fog through the open DM Control Panel so connected screens update live.
16. When the modal closes during an in-progress drag, the document-level mousemove/mouseup listeners shall be removed (`cleanupDrag`).
17. The overlay shall draw all walls scaled by `fogScale`: plain walls `#f5d90a` lineWidth 3; door walls `#44aaff`; open doors dashed (`setLineDash([8,6])`). In Walls mode, if a chain draft is active, a dashed preview segment shall be drawn from the anchor to the current cursor.
18. The Walls tab shall offer Wall, Door, Erase, and Toggle door tools, plus a Snap checkbox.
19. Wall and Door tools shall use chained left-click drawing: the first click sets the anchor; each subsequent click appends a segment from the anchor to the clicked point (snapped to grid intersections when Snap is checked, ignored when zero-length) and advances the anchor; right-click (contextmenu, preventDefault) ends the chain without adding a segment.
20. The Erase tool shall remove the nearest wall whose point-to-segment distance (in natural coords) is less than `12 / fogScale`; Toggle door shall flip `open` on the nearest door wall within the same hit radius. Both commit immediately via `panel.commitWalls`.
21. `broadcastWalls()` shall broadcast `{ type: "map-walls", payload: { walls } }`; `commitWalls(walls)` shall update `this.walls`, write the walls sidecar (at `wallsSidecarPath`), and call `broadcastWalls()`; `republish()` shall call `broadcastWalls()` alongside `broadcastFog()` — an empty walls list is a valid signal for late joiners.

## Broadcast / IPC

| Message type | Direction | Payload | When |
|--------------|-----------|---------|------|
| `map-fog` | DM → map | `{ dataUrl: string \| null, opacity: number }` | Map apply; every completed fog edit; opacity setting change; `republish()` |
| `map-vision` | DM → map | `{ visions: MapVision[] }` | Any time active vision shapes change; client recomposites immediately |
| `map-walls` | DM → map | `{ walls: MapWall[] }` | Map apply; every wall edit; `republish()` |

Full channel routing in `../player-server/websocket-protocol.md`.

## Tests covering this

- `src/__tests__/map-fog.test.ts` — canvas sizing, sidecar path derivation/IO, grid-cell snapping
- `src/__tests__/map-fog-panel.test.ts` — panel lifecycle: broadcast shape, commit persistence, stop/restore/republish (fog + vision + walls)
- `src/__tests__/server-map-channel.test.ts` — `map-fog`, `map-vision`, and `map-walls` replay to late joiners and purge on `map-clear`
- `src/__tests__/map-fog-endtoend.integration.test.ts` — full DM→server→late-joiner scene reconstruction: all map-* messages replayed to map channel, player channel isolation, map-clear purge, cross-session cache restore, sidecar persistence round-trip
- `src/__tests__/map-fog-spec.test.ts` — EARS conformance: mask geometry (req 2), sidecar path determinism (req 7), blocksSight truth table (req 10), LoS wall/door geometry (req 10), republish signals (reqs 14/21/27), mapFogTvOpacity default + broadcastFog embedding (req 15), map-* channel routing (websocket-protocol req 1b)
- `src/__tests__/map-fog-czepeku.test.ts` — real-world fixture (Czepeku "Candle Workshop" wall geometry, 101 walls / 15 doors / 140 px per square, in `fixtures/czepeku-candle-workshop-walls.json`): pipeline dimensions, LoS occlusion and door opening against production wall data, performance budget, room flood bounded by real walls
- `test/visual/map-fog.spec.ts` — Playwright rendering: full fog, revealed hole, cleared fog, physical mode
- `test/visual/map-vision.spec.ts` — Playwright rendering: feathered circle vision hole, wall-clipped asymmetric hole, open-door symmetric hole

## DM vision controls

The Map Screen section exposes a Vision subsystem below AoE Overlays while a map is active.

22. The DM panel shall render a Vision section with an Add Vision menu (Circle 30 ft / Square 30 ft); new visions spawn at the map center with `sizeFt: 30` and `featherFt: 5`.
23. When visions exist the section shall also render a Bake into fog button and a Clear All button; Bake composites all active visions onto the persistent fog mask (building a canvas, drawing the existing fog if present, erasing each vision with `eraseVisionWithWalls` using the current `walls`, then calling `commitFog`) and clears the live vision list; Clear All empties the list and broadcasts immediately.
24. Each vision row shall expose: shape select (circle / square), sizeFt number input (min 5 step 5, title "Vision range (ft)"), featherFt number input (min 0 step 5, title "Feather (ft)"), and a remove ✕ button; each change broadcasts `map-vision` immediately.
25. Each vision shall carry a draggable dot (`.dm-map-vision-dot`) in the pan preview positioned at `(x/nw, y/nh)` percent; left-drag moves the vision (same `deltaToMap` + clamp pattern as AoE dots), throttled broadcast during drag, immediate on mouseup.
26. The `redrawAoes` canvas shall also draw a dashed `#ffd23f` 2px outline for each vision: arc for circle, rect for square, at `sizeFt * (pxPerSquare/5) * s` radius/half-side.
27. `broadcastVisions(immediate?)` shall follow the same throttle pattern as `broadcastAoes`; `setVaultMap` resets `this.visions = []` and calls `broadcastVisions(true)`; `stopMap` resets `this.visions`; `restoreFromCache` recovers from the `map-vision` slot; `republish()` re-broadcasts visions when non-empty.

## Non-goals

- Fog on the player screen at `/` (it has its own per-layer fog, `../fog-of-war/overview.md`).
- Deleting sidecars from the UI. Stale fog/walls files are cleaned up manually in `.dm-screen/fog/` and `.dm-screen/walls/`.
- Undo history inside the modal. Strokes and wall edits are destructive; Reveal All / Cover All are the fog recovery tools.
- Per-map opacity. `mapFogTvOpacity` is global.
