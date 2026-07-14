# Map Screen

> A second player-facing endpoint (`/map`) dedicated to battlemaps for in-person play on a horizontal TV. It renders exactly one map (image or looping video) either fit-to-screen or at physical scale — one map grid square = one real-world inch — with an optional grid overlay for gridless maps. Controlled from a Map Screen section in the DM Control Panel; completely independent from the player screen served at `/`.

## Source files

- `src/map/map.ts` — browser-side WebSocket client and rendering (stage transform, grid canvas, calibration card, fullscreen button, reconnect)
- `src/map/map.css` — map screen styles
- `src/map/transform.ts` — pure scale/translation/grid/calibration math shared by the map client and the DM panel
- `src/map/types.ts` — `MapMediaPayload`, `MapView`, `MapGridConfig`, `ScreenProfile`, `StoredMapState`, `AoeShape`, `MapAoe`, `AoePreset`
- `src/map/aoe.ts`, `src/map/spellAoes.ts`, `src/views/SpellAoeModal.ts` — AoE overlays (see `aoe-overlays.md`)
- `src/server.ts` — `/map`, `/map.js`, `/map.css` routes; per-connection channel tagging and channel-filtered broadcast/replay; `map-show`/`map-clear` slots in `VaultServeAllowlist`
- `src/views/MapScreenPanel.ts` — DM-side section: picker, mode/grid controls, pan preview, per-map config persistence, fog lifecycle (`fogDataUrl`, `broadcastFog`, `commitFog`)
- `src/views/MapFogModal.ts` — fog editing modal (brush, rectangle, grid-cell tools; reveal/cover modes; sidecar persistence)
- `src/map/fog.ts` — fog canvas sizing, sidecar path derivation, vault adapter load/save
- `src/views/MapCalibrationModal.ts` — per-screen physical calibration (diagonal + fine-tune + test pattern)
- `src/views/HydrusExplorerModal.ts` — `handleSetMap` behind the tile menu's Set as map action
- `src/main.ts` — `broadcastMapCalibration()` on server start; channel-split client lists forwarded to the DM panel

## Settings used

- `mapScreenProfiles` — `"WxH@dpr"` → `{ diagonalInches, fineTune }` physical calibration per screen (see `calibration.md`)
- `mapConfigs` — map `/vault/` URL → remembered `StoredMapState` (grid config + mode + pan + rotation), reapplied when the same map is shown again
- `mapDefaultPxPerSquare` — starting cell size for unconfigured maps (see `scale-and-grid.md`)
- `mapFogTvOpacity` — fog layer opacity sent to the map screen in every `map-fog` broadcast (0.3–1, default 1)
- `hydrusDefaultLoop`, `hydrusDefaultMuted` — forwarded in `map-show` for video maps
- `tvWidth`, `tvHeight` — fallback screen used by the DM pan preview when no map client is connected

## Requirements

1. The server shall serve `GET /map` (inline HTML), `GET /map.js` (bundled map client) and `GET /map.css` alongside the existing player routes.
2. The map page's WebSocket shall connect to the `/map` path; the server shall tag that connection with the `map` channel (see `../player-server/websocket-protocol.md` for channel routing).
3. The DM panel shall render a Map Screen section with the LAN `/map` URL, the connected map screens (one badge per distinct resolution, click opens the calibration modal), and an Add Map / Stop Map button.
4. The Add Map picker shall offer the active note's images and its image/video `hydrus://` references, with the same single-source shortcut and disabled-offline entries as the background picker (`../background-media/overview.md` requirements 2–4).
5. The Hydrus explorer tile menu shall offer Set as map, which caches the file and applies it as the map via the open DM Control Panel (Notice when no panel is open).
6. When a map is applied, the DM panel shall measure the media's natural dimensions, restore the map's remembered `StoredMapState` from `mapConfigs` (or defaults: fit mode, pan centered, grid config from `scale-and-grid.md`), reset the AoE list and vision list, load the fog sidecar for the map URL (if any), re-clamp the restored pan per requirement 13, and broadcast `map-show`, `map-config`, `map-view`, `map-aoe-sync`, `map-vision`, and `map-fog`.
7. When the player receives `map-show`, it shall validate the URL with `safePlayerUrl`, render the media full-natural-size inside the stage, hide the waiting screen, and apply the current view transform. Videos play muted/looping per payload flags.
8. When Stop Map is clicked, the DM panel shall clear `fogDataUrl` and broadcast `map-clear`; the map client shall clear the media and show the waiting screen again.
9. While a map is active, the DM section shall expose: a scale-mode toggle (physical 1″ / fit screen), a grid overlay toggle, a Rotate button (90° steps), a Fog button (labelled "Fog ●" when fog data exists, "Fog" otherwise) that opens the fog editing modal, grid inputs (px/square, offset X/Y, line color, opacity), and a pan preview rendered in the TV's orientation with DM-local zoom (wheel / overlay slider, from whole-map up to the player's window), middle-drag look-around, and a view lock (a muted lucide lock icon; while locked, left-drag looks around DM-locally instead of moving the players' view); in physical mode the preview adds a draggable viewport rectangle (drag or click-to-center repositions the visible window unless the view is locked; broadcasts are throttled and the final position is persisted). See `scale-and-grid.md` requirements 6c–6d.
10. Every change to mode, pan, rotation, or grid config shall be broadcast (`map-view` / `map-config`) and persisted to `mapConfigs` keyed by the map URL.
11. `republishToServer()` shall re-broadcast `map-calibration` plus, when a map is active, `map-show`/`map-config`/`map-view`/`map-fog` (and `map-aoe-sync` per `aoe-overlays.md` requirement 10, and `map-vision` per `fog-of-war.md` vision requirements when non-empty), so map screens connecting after a server restart reconstruct the scene; the DM panel shall restore its map state — including AoEs, visions, and fog data URL — from the persisted late-joiner cache on open.
12. The map screen shall render a fullscreen toggle button and the same disconnect-overlay/reconnect behaviour as the player screen (`../player-server/websocket-protocol.md` requirement 8).
13. In physical mode, `clampPan` shall prevent the viewport from extending past the map edges: the pan is constrained so that no black (empty) region is visible; when the map is smaller than the visible window on an axis (including a degenerate scale), the pan is forced to the centre of that axis. The pan is re-clamped whenever it could go stale: on map apply, on cache restore, on scale-mode switch, and on rotation change.
14. While a map is active, the DM section shall expose an AoE Overlays section; the full contract (data model, spell catalog, controls, rendering, preview interactions, broadcast cadence, lifecycle) is specified in `aoe-overlays.md`.
15. While a map is active, the DM section shall expose fog of war editing and the map client shall render the fog mask; the full contract lives in `fog-of-war.md`.

## Broadcast / IPC

All map traffic uses the `map` channel (types prefixed `map-`); the full table lives in `../player-server/websocket-protocol.md`. Scale/grid/preview semantics in `scale-and-grid.md`; calibration in `calibration.md`; AoE overlays in `aoe-overlays.md`.

## Tests covering this

- `src/__tests__/map-transform.test.ts` — scale, translation, viewport-aware pan clamping, grid phase, calibration math
- `src/__tests__/map-screen-panel-aoe.test.ts` — pan re-clamp on restore (requirement 13); AoE lifecycle per `aoe-overlays.md`; `republish` broadcast sequence
- `src/__tests__/map-fog-panel.test.ts` — fog lifecycle: `broadcastFog`, `commitFog`, `stopMap` clear, `restoreFromCache` recovery, `republish` re-broadcast
- `src/__tests__/server-map-channel.test.ts` — channel-filtered broadcast and replay, channel-scoped cache purge (including `map-fog`), allowlist map slot
- `src/__tests__/bundle-smoke.integration.test.ts` — production build inlines the map bundle

## Non-goals

- Tokens or initiative on the map screen. It renders exactly one map; tokens are physical miniatures on the TV.
- More than one simultaneous map, or map layers.
- Controls on the map page itself (other than fullscreen). The TV is passive; everything is driven from the DM panel.
- Applying a map without an open DM Control Panel (the panel owns natural-size measurement and per-map state).
- Sharing state with the player screen at `/`. The two channels are fully independent; `clear` does not touch the map and `map-clear` does not touch the player screen.
