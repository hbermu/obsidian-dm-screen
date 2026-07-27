# Image-Layer Persistence

> Layer state and the last broadcast of every WebSocket type survive Obsidian restarts so the player screen and the DM panel can reconstruct themselves on plugin reload without the DM redoing the pushes.

## Source files

- `src/views/DmControlPanel.ts` — `saveState`, `restoreState`, called from `onClose` and `onOpen`
- `src/server.ts` — `lastState` map populated by `broadcast`, read on new connections
- `src/main.ts` — `loadSettings` and `saveSettings` round-trip the plugin data

## Settings used

- `lastImageLayers` — JSON-serialised `ImageLayer[]`
- `lastPlayerScreenWidth`, `lastPlayerScreenHeight` — last reported player resolution
- `lastBroadcastCache` — record keyed by message type, value is the serialised JSON message

## Requirements

1. When the DM Control Panel closes, the panel shall write the current `imageLayers` JSON into `settings.lastImageLayers`.
2. When the DM Control Panel closes, the panel shall write the first connected client's `width` and `height` into `settings.lastPlayerScreenWidth` and `settings.lastPlayerScreenHeight` (or `0` if none).
3. When the DM Control Panel closes and the server is running, the panel shall snapshot the server's `lastState` map into `settings.lastBroadcastCache` (one entry per message type).
4. When the DM Control Panel opens, the panel shall parse `settings.lastImageLayers` and restore `imageLayers` (with `nextZIndex = max(zIndex) + 1`). Invalid JSON shall be ignored silently.
5. When the DM Control Panel opens, if `settings.lastPlayerScreenWidth > 0`, the panel shall populate `connectedClients` with a single placeholder entry holding the persisted resolution and set `playerConnected = true`.
6. When the DM Control Panel opens and the server is running, the panel shall restore each entry of `settings.lastBroadcastCache` back into the server's `lastState` map.
7. When the DM Control Panel opens and a cached `show-background-media` entry exists, the panel shall extract its URL into `activeBackgroundUrl` so the Stop BG button is shown.
8. When the DM Control Panel restores state and the server is running with at least one restored layer, the panel shall broadcast a fresh `image-layers-sync` so the server's `lastState` reflects the authoritative current layers (overwriting any stale or missing cache entry). The panel shall also expose a public `republishToServer()` method.
9. When the player-screen server starts, the plugin shall call `republishToServer()` on every open DM Control Panel so any client that connects later receives the current layer state via the late-joiner cache.

## Tests covering this

- `src/__tests__/dm-control-combat.test.ts` — `republishToServer` emits the sync + geometry pair (requirement 8)
- `test/e2e/specs/layer-controls.e2e.ts` — real Obsidian: detaching the DM panel leaf runs `onClose → saveState`; reopening it runs `onOpen → restoreState`, which rebuilds `imageLayers` from `settings.lastImageLayers` (same layer ids survive) and `republishToServer` broadcasts a fresh `image-layers-sync` (requirements 1, 4, 8)

## Non-goals

- Compressing or trimming the cached `dataUrl` strings; they are stored as-is.
- Versioning the schema. If `ImageLayer` changes, old persisted data is best-effort and may be discarded.
- Restoring connected-client `devicePixelRatio`. The placeholder uses `1`.
- Saving DM-only viewport (`dmZoom`, `dmPanX`, `dmPanY`). The DM view always opens at 100% / 0,0.
