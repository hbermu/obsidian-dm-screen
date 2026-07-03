# Multi-Screen Support

> The plugin tracks every connected player screen with its reported resolution and lets the DM pick which client's resolution drives the preview aspect ratio when multiple are connected.

## Source files

- `src/server.ts` — `clientInfoMap`, `getConnectedClients`, `onClientInfo` callback
- `src/main.ts` — `onPlayerClientInfo` forwards new info to the DM Control Panel
- `src/views/DmControlPanel.ts` — `connectedClients`, `playerConnected`, `selectedResolution`, `getEffectiveResolution`, the resolution badges row in `renderServerSection`, `onPlayerConnected`
- `src/player/player.ts` — `sendClientInfo` emits the player's window dimensions on connect and on resize

## Settings used

- `tvWidth`, `tvHeight` — fallback used by `getEffectiveResolution` when no client is connected

## Requirements

1. The player shall emit a `client-info` WebSocket message on connect and on every window resize, carrying `{ width: window.innerWidth, height: window.innerHeight, devicePixelRatio }` (the map page additionally sends `channel: "map"`).
2. The server shall store the latest `client-info` per WebSocket in `clientInfoMap`, stamped with the connection's channel, and invoke `onClientInfo` whenever it is updated.
3. The DM panel shall receive the full connected-client list via `onPlayerConnected` and via the `onClientCountChanged` re-render hook, splitting it by channel: `player`-channel clients populate `connectedClients`, `map`-channel clients populate the Map Screen section (see `../map-screen/overview.md`).
4. The DM panel shall render one badge per distinct `player`-channel resolution, displayed as `<W>×<H>` (or `<W>×<H> ×<count>` if multiple clients share that resolution). Map clients never appear in this row.
5. The effective-resolution badge (the one currently driving the preview) shall carry the `dm-client-resolution-active` CSS class.
6. When the user clicks a resolution badge, the DM panel shall set `selectedResolution` to that `{ width, height }` and re-render.
7. The `getEffectiveResolution` method shall return:
   - `selectedResolution` if it matches one of the currently connected clients;
   - else the first connected client's resolution if any;
   - else `{ width: tvWidth, height: tvHeight }` from settings (default 1920×1080).
8. While no client is connected, the DM panel shall hide the connected-screens row entirely.

## Broadcast / IPC

| Message type | Direction | Payload | When |
|--------------|-----------|---------|------|
| `client-info` | player/map → DM | `{ width: number, height: number, devicePixelRatio: number, channel?: "map" }` | Client connects; client window resizes |

## Tests covering this

- `src/__tests__/effective-resolution.test.ts` — the selection / fallback chain in `getEffectiveResolution`
- `test/visual/tablet.spec.ts` — Playwright visual regression at a 1280×800 tablet viewport (separate Playwright project), exercising the `client-info` round-trip and verifying that layer geometry renders correctly at a non-desktop resolution.

## Non-goals

- Per-client broadcast filtering. Every client receives every broadcast.
- Per-client layer transforms. All clients render the same `image-layers-sync` payload; resolution differences are handled by the browser's `object-fit: contain` and the layer's percentage geometry.
- Naming or labelling clients. Resolution is the only identifier surfaced in the DM UI.
- Surfacing `devicePixelRatio`. It is captured but not displayed.
