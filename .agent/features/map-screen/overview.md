# Map Screen

> A second player-facing endpoint (`/map`) dedicated to battlemaps for in-person play on a horizontal TV. It renders exactly one map (image or looping video) either fit-to-screen or at physical scale — one map grid square = one real-world inch — with an optional grid overlay for gridless maps. Controlled from a Map Screen section in the DM Control Panel; completely independent from the player screen served at `/`.

## Source files

- `src/map/map.ts` — browser-side WebSocket client and rendering (stage transform, grid canvas, calibration card, fullscreen button, reconnect)
- `src/map/map.css` — map screen styles
- `src/map/transform.ts` — pure scale/translation/grid/calibration math shared by the map client and the DM panel
- `src/map/types.ts` — `MapMediaPayload`, `MapView`, `MapGridConfig`, `ScreenProfile`, `StoredMapState`, `AoeShape`, `MapAoe`, `AoePreset`, `AOE_PRESETS`
- `src/map/aoe.ts` — pure canvas renderer for AoE shapes (circle, square, cone, line)
- `src/server.ts` — `/map`, `/map.js`, `/map.css` routes; per-connection channel tagging and channel-filtered broadcast/replay; `map-show`/`map-clear` slots in `VaultServeAllowlist`
- `src/views/MapScreenPanel.ts` — DM-side section: picker, mode/grid controls, pan preview, per-map config persistence
- `src/views/MapCalibrationModal.ts` — per-screen physical calibration (diagonal + fine-tune + test pattern)
- `src/views/HydrusExplorerModal.ts` — `handleSetMap` behind the tile menu's Set as map action
- `src/main.ts` — `broadcastMapCalibration()` on server start; channel-split client lists forwarded to the DM panel

## Settings used

- `mapScreenProfiles` — `"WxH@dpr"` → `{ diagonalInches, fineTune }` physical calibration per screen (see `calibration.md`)
- `mapConfigs` — map `/vault/` URL → remembered `StoredMapState` (grid config + mode + pan + rotation), reapplied when the same map is shown again
- `mapDefaultPxPerSquare` — starting cell size for unconfigured maps (see `scale-and-grid.md`)
- `hydrusDefaultLoop`, `hydrusDefaultMuted` — forwarded in `map-show` for video maps
- `tvWidth`, `tvHeight` — fallback screen used by the DM pan preview when no map client is connected

## Requirements

1. The server shall serve `GET /map` (inline HTML), `GET /map.js` (bundled map client) and `GET /map.css` alongside the existing player routes.
2. The map page's WebSocket shall connect to the `/map` path; the server shall tag that connection with the `map` channel (see `../player-server/websocket-protocol.md` for channel routing).
3. The DM panel shall render a Map Screen section with the LAN `/map` URL, the connected map screens (one badge per distinct resolution, click opens the calibration modal), and an Add Map / Stop Map button.
4. The Add Map picker shall offer the active note's images and its image/video `hydrus://` references, with the same single-source shortcut and disabled-offline entries as the background picker (`../background-media/overview.md` requirements 2–4).
5. The Hydrus explorer tile menu shall offer Set as map, which caches the file and applies it as the map via the open DM Control Panel (Notice when no panel is open).
6. When a map is applied, the DM panel shall measure the media's natural dimensions, restore the map's remembered `StoredMapState` from `mapConfigs` (or defaults: fit mode, pan centered, grid config from `scale-and-grid.md`), reset the AoE list, re-clamp the restored pan per requirement 13, and broadcast `map-show`, `map-config`, `map-view`, and the (now empty) `map-aoe-sync`.
7. When the player receives `map-show`, it shall validate the URL with `safePlayerUrl`, render the media full-natural-size inside the stage, hide the waiting screen, and apply the current view transform. Videos play muted/looping per payload flags.
8. When Stop Map is clicked, the DM panel shall broadcast `map-clear`; the map client shall clear the media and show the waiting screen again.
9. While a map is active, the DM section shall expose: a scale-mode toggle (physical 1″ / fit screen), a grid overlay toggle, a Rotate button (90° steps), grid inputs (px/square, offset X/Y, line color, opacity), and a pan preview rendered in the TV's orientation with DM-local zoom (wheel / −⌂+ buttons, 1×–6×) and middle-drag panning; in physical mode the preview adds a draggable viewport rectangle (drag or click-to-center repositions the visible window; broadcasts are throttled and the final position is persisted). See `scale-and-grid.md` requirement 6c.
10. Every change to mode, pan, rotation, or grid config shall be broadcast (`map-view` / `map-config`) and persisted to `mapConfigs` keyed by the map URL.
11. `republishToServer()` shall re-broadcast `map-calibration` plus, when a map is active, `map-show`/`map-config`/`map-view` (and `map-aoe-sync` when the AoE list is non-empty), so map screens connecting after a server restart reconstruct the scene; the DM panel shall restore its map state — including the AoE list from the cached `map-aoe-sync` — from the persisted late-joiner cache on open.
12. The map screen shall render a fullscreen toggle button and the same disconnect-overlay/reconnect behaviour as the player screen (`../player-server/websocket-protocol.md` requirement 8).
13. In physical mode, `clampPan` shall prevent the viewport from extending past the map edges: the pan is constrained so that no black (empty) region is visible; when the map is smaller than the visible window on an axis (including a degenerate scale), the pan is forced to the centre of that axis. The pan is re-clamped whenever it could go stale: on map apply, on cache restore, on scale-mode switch, and on rotation change.
14. The DM panel shall expose an AoE Overlays section (visible when a map is active) with: an Add AoE menu offering named presets (Fireball 20 ft circle, Spirit Guardians 15 ft circle) and a Custom entry; per-AoE controls (shape select, size in ft, width in ft for lines, color, opacity, rotation, delete); and a Clear All button.
15. Each AoE shall be rendered on the map screen canvas as a filled+stroked shape (circle of `sizeFt` radius, square of `sizeFt` side, cone from vertex at 53° of `sizeFt` length, or line of `sizeFt` × `widthFt`) at the correct map-pixel position: the position is mapped through `rotatePoint` with the view rotation and the shape's rotation is offset by the view rotation, so AoEs stay attached to the map under 90° steps.
16. In the DM pan preview (both scale modes), the actual AoE shapes shall be drawn on an overlay canvas (map orientation, scaled to the stage) so the DM sees the real footprint; each AoE also carries a draggable colored dot at its anchor (drag to move) and — for every shape except circles — a diamond rotation handle at the shape's tip (cone/line) or mid-edge (square), whose drag rotates the AoE in 5° steps. Moves and rotations broadcast `map-aoe-sync` throttled to the same cadence as pan drags, with an immediate broadcast on release; opacity slider drags are throttled the same way, and size/width/opacity edits redraw the preview canvas in place.
17. `map-clear` shall reset the AoE list to empty on both DM and map sides.

## Broadcast / IPC

All map traffic uses the `map` channel (types prefixed `map-`); the full table lives in `../player-server/websocket-protocol.md`. Scale/grid semantics in `scale-and-grid.md`; calibration semantics in `calibration.md`.

## Tests covering this

- `src/__tests__/map-transform.test.ts` — scale, translation, clamping (including viewport-aware pan clamping), grid phase, calibration math
- `src/__tests__/map-aoe-render.test.ts` — AoE canvas shapes, ft→px sizing, rotation-composed placement, fill/stroke styling
- `src/__tests__/map-screen-panel-aoe.test.ts` — AoE restore from cache, pan re-clamp on restore, stopMap reset, republish inclusion, broadcast throttling
- `src/__tests__/server-map-channel.test.ts` — channel-filtered broadcast and replay, channel-scoped cache purge, allowlist map slot
- `src/__tests__/bundle-smoke.integration.test.ts` — production build inlines the map bundle

## Non-goals

- Tokens, fog of war, or initiative on the map screen. It renders exactly one map; tokens are physical miniatures on the TV.
- More than one simultaneous map, or map layers.
- Controls on the map page itself (other than fullscreen). The TV is passive; everything is driven from the DM panel.
- Applying a map without an open DM Control Panel (the panel owns natural-size measurement and per-map state).
- Sharing state with the player screen at `/`. The two channels are fully independent; `clear` does not touch the map and `map-clear` does not touch the player screen.
