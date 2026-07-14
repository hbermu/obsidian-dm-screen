# Map Screen Fog of War

> A single PNG mask painted by the DM over the active battlemap: black hides, transparent reveals. Edited in a dedicated modal (brush / rectangle / grid-cell, reveal or cover), rendered on the map screen inside the stage transform, and persisted per map as a vault sidecar PNG keyed by the map's `/vault/` URL — note images and Hydrus-cached files alike.

## Source files

- `src/map/fog.ts` — `FOG_RESOLUTION`, `fogCanvasSize`, `fogSidecarPath`, `gridCellRectAt`, `loadFogSidecar`, `saveFogSidecar`, `FogAdapter`, `CellRect`
- `src/views/MapFogModal.ts` — the editing modal (toolbar, stage, drawing handlers, drag cleanup)
- `src/views/MapScreenPanel.ts` — `fogDataUrl`, `broadcastFog`, `commitFog`, sidecar load in `setVaultMap`, restore in `restoreFromCache`, re-emit in `republish`, reset in `stopMap`, the Fog button
- `src/map/map.ts` — `showFog`, fog clearing in `clearMap`
- `src/server.ts` — the `#map-fog` element in the inline map page HTML
- `src/settings.ts` — `mapFogTvOpacity`

## Settings used

- `mapFogTvOpacity` — fog opacity on the map screen (default 1); changing it re-broadcasts fog through the open DM panel

## Requirements

1. While a map is active, the Map Screen section shall render a Fog button that opens `MapFogModal`; the label reads `Fog ●` when the map has fog and `Fog` otherwise.
2. The fog mask shall be an offscreen canvas of width `1024` (`FOG_RESOLUTION`) and height `max(1, round(1024 × naturalHeight/naturalWidth))`; black = hidden, transparent = revealed. A map with no stored fog starts fully transparent.
3. The modal shall offer Reveal/Cover modes × Brush (stamped circles sized by a 2–15% slider), Rectangle (dashed marquee — `#7bd88f` reveal / `#f97583` cover — committed on mouseup), and Grid cell (whole cells snapped via `gridCellRectAt` from the map's `pxPerSquare`/`gridOffsetX`/`gridOffsetY`) tools, plus Reveal All and Cover All. Reveal composites with `destination-out`; Cover paints opaque black with `source-over`. The mask renders at 0.55 alpha inside the modal so the DM sees the map beneath.
4. When a stroke completes (mouseup) or Reveal All / Cover All is clicked, the modal shall call `commitFog`, which re-encodes the mask as a PNG data URL, writes the sidecar, and broadcasts `map-fog { dataUrl, opacity: mapFogTvOpacity }`.
5. The sidecar shall live at `.dm-screen/fog/<tail>-<fnv1a(mapUrl)>.png`, where `<tail>` is the sanitized last 60 characters of the decoded vault path (fallback `x` when sanitization strips everything) — deterministic per map URL, identical for note-image and Hydrus-cached maps.
6. When a map is applied, `setVaultMap` shall load the sidecar (dotfolder-safe `adapter.exists` + `readBinary`) into `fogDataUrl` (or null) and broadcast `map-fog` alongside the other map messages.
7. When the map client receives `map-fog` with a data URL, it shall validate it with `safePlayerUrl(url, "image")` and display `#map-fog` (an `<img>` inside `#map-stage`, covering the media and inheriting the stage transform) at the payload opacity; `dataUrl: null` clears and hides it. Rejected URLs are logged via `console.warn` and skipped.
8. `map-clear` shall clear and hide the fog on the client; `stopMap` resets `fogDataUrl` to null — the sidecar is never deleted, so re-adding the same map restores its fog.
9. `restoreFromCache` shall recover `fogDataUrl` from the `map-fog` cache slot; `republish()` shall re-broadcast `map-fog` while a map is active — including a null fog, so late joiners clear stale overlays.
10. When `mapFogTvOpacity` changes in settings, the plugin shall re-broadcast fog through the open DM Control Panel so connected screens update live.
11. When the modal closes during an in-progress drag, the document-level mousemove/mouseup listeners shall be removed (`cleanupDrag`).

## Broadcast / IPC

| Message type | Direction | Payload | When |
|--------------|-----------|---------|------|
| `map-fog` | DM → map | `{ dataUrl: string \| null, opacity: number }` | Map apply; every completed edit; opacity setting change; `republishToServer()` |

Full channel routing in `../player-server/websocket-protocol.md`.

## Tests covering this

- `src/__tests__/map-fog.test.ts` — canvas sizing, sidecar path derivation/IO, grid-cell snapping
- `src/__tests__/map-fog-panel.test.ts` — panel lifecycle: broadcast shape, commit persistence, stop/restore/republish
- `src/__tests__/server-map-channel.test.ts` — `map-fog` replay to late joiners and purge on `map-clear`
- `test/visual/map-fog.spec.ts` — Playwright rendering: full fog, revealed hole, cleared fog, physical mode

## Non-goals

- Character vision shapes (feet-sized, feathered-edge, live-movable) — a planned future feature layered on this mask.
- Fog on the player screen at `/` (it has its own per-layer fog, `../fog-of-war/overview.md`).
- Deleting sidecars from the UI. Stale fog files are cleaned up manually in `.dm-screen/fog/`.
- Undo history inside the modal. Strokes are destructive; Reveal All / Cover All are the recovery tools.
- Per-map opacity. `mapFogTvOpacity` is global.
