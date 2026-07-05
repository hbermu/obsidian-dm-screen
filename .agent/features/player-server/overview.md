# Player Screen Server

> An in-Obsidian HTTP + WebSocket server that hosts the player screen (`/`) and the map screen (`/map`, see `../map-screen/overview.md`). Any browser on the local network can connect to it to see the DM-pushed scene; the DM controls the server lifecycle and the broadcasts.

## Source files

- `src/server.ts` — `PlayerScreenServer` class, HTTP handler, WebSocket connection accounting, late-joiner cache, `readVaultBytes` helper
- `src/main.ts` — wires `startServer` / `stopServer` / `toggleServer`, applies `maxClients`, forwards client-info callbacks to the DM panel
- `src/views/DmControlPanel.ts` — renders the server status row, Start/Stop button, and connected-client badges; the player LAN URL + Copy row lives at the top of the Player Screen section (mirroring the Map Screen section's URL row)
- `src/player/player.ts` — client side of the WebSocket connection, handles reconnect

## Settings used

- `serverPort` — TCP port the HTTP listener binds to (default `3000`)
- `autoStartServer` — start the server automatically on plugin load
- `maxClients` — maximum number of simultaneous WebSocket clients (default `10`)
- `lastBroadcastCache` — persisted late-joiner cache restored on plugin load
- `waitingTitle` — big text rendered on the waiting screen (default `"Player Screen"`)
- `waitingSubtitle` — smaller text below the title (default `"Waiting for DM to push content..."`)
- `ddbInspirationPulse` — drives the `inspiration-style` broadcast that toggles the `dm-inspired-pulse` body class on every connected player (default `true`)

## Requirements

1. The server shall bind to `0.0.0.0` on `settings.serverPort` when started.
2. The server shall serve `GET /` and `GET /index.html` with the inline HTML built in `buildPlayerHtml()`.
3. The server shall serve `GET /player.js` with the bundled player script.
4. The server shall serve `GET /player.css` with the inline CSS.
4b. The server shall serve `GET /map` (inline HTML from `buildMapHtml()`), `GET /map.js` (bundled map script), and `GET /map.css` (inline map CSS).
5. The server shall serve `GET /health` with JSON `{ status: "ok", clients: <count> }`.
6. The server shall serve `GET /vault/<path>` via the vault-routing rules defined in `vault-routing.md`.
7. The server shall return HTTP 404 for any other path.
8. When a WebSocket client connects, the server shall reject it with close code `1013` and reason `"Max clients reached"` if `clientCount >= maxClients`.
9. When a WebSocket client connects within the limit, the server shall tag it with its channel (`map` when the upgrade path starts with `/map`, else `player`), add it to its client set, and replay every cached broadcast message of that channel.
10. When a WebSocket client disconnects, the server shall remove it from the client set, its channel tag, and `clientInfoMap`, and invoke `onClientCountChanged`.
11. When a WebSocket client sends a `client-info` message, the server shall store its payload plus the connection's channel in `clientInfoMap` and invoke `onClientInfo`.
12. When the DM calls `broadcast(message)`, the server shall serialise the message and send it to every client of the message's channel (`map-` prefixed types → map clients, all others → player clients) whose `readyState` is `1` (OPEN).
13. When the DM calls `broadcast({type: "clear"})`, the server shall purge the `player`-channel entries from the late-joiner cache before sending; `broadcast({type: "map-clear"})` shall purge the `map-*` entries symmetrically.
14. When the DM calls `broadcast(message)` with any type other than `clear`/`map-clear`, the server shall store the serialised message in the late-joiner cache, keyed by `message.type`, overwriting any previous entry of that type.
15. When the server stops, the server shall close every active WebSocket connection, clear its client set, and close the HTTP listener.
16. If `autoStartServer` is true, then on plugin load the server shall start.
17. If the workspace contains an open DM Control Panel, when the connected-client count changes the server shall trigger that panel to re-render so it can reflect the new count and resolutions.
18. The server shall expose a `clientCount` accessor and a `getConnectedClients()` accessor returning the array of `ClientInfo` payloads.
19. `buildPlayerHtml()` shall inline the current `waitingTitle` and `waitingSubtitle` into the `#waiting-screen` markup, HTML-escaping the values. Empty values shall cause the corresponding `<h1>` or `<p>` to be omitted entirely.
20. After `startServer()` succeeds, the plugin shall call `broadcastWaitingScreen()` to seed the late-joiner cache with the current waiting-screen text.
21. When either `waitingTitle` or `waitingSubtitle` changes in settings, the plugin shall broadcast `waiting-screen` immediately so already-connected clients update without a reload.
22. After `startServer()` succeeds, the plugin shall also call `broadcastInspirationStyle()` to seed the late-joiner cache with the current `ddbInspirationPulse` value (see `../combat-tracker/overview.md` Heroic Inspiration requirements). When `ddbInspirationPulse` changes in settings, the plugin shall broadcast `inspiration-style` immediately so already-connected clients update without a reload.
23. When the player-side WebSocket transitions to OPEN, the player shall set `window.__wsConnected` to `true`; when it transitions to CLOSE, the player shall set `window.__wsConnected` to `false`. (Drives the connection-ready gate used by the visual test harness so screenshots never fire before the first broadcast can arrive.)

## Broadcast / IPC

The server is the transport for every DM → player and player → DM message. The exhaustive message table is in `websocket-protocol.md`. HTTP routes are listed above (requirements 2–7).

## Tests covering this

- `src/__tests__/server.test.ts` — basic start / stop / port binding
- `src/__tests__/server-bootstrap.integration.test.ts` — real `PlayerScreenServer` + real `ws` client connection
- `src/__tests__/server-broadcast.test.ts` — `broadcast()` filters by `readyState`, populates late-joiner cache
- `src/__tests__/server-max-clients.test.ts` — `maxClients` enforced with close code `1013`
- `src/__tests__/server-vault-path.test.ts` — `/vault/` path-traversal guard (see `vault-routing.md`)
- `src/__tests__/server-combat-scale.test.ts` — `combat-scale` broadcast end-to-end
- `src/__tests__/smoke.test.ts` — module loads, exports present
- `src/__tests__/bundle-smoke.integration.test.ts` — production `main.js` builds and contains the server class
- `test/visual/*.spec.ts` — Playwright visual regression suite. Boots a real `PlayerScreenServer` against the production player bundle (via `scripts/build-player.mjs` + a CJS-bundled `server-entry.ts` built in `test/visual/harness/build-host.mjs`) and asserts pixel-stable screenshots of waiting screen, background image, image-layers-sync, fog overlays (full / circle / rect / freehand), and the initiative tracker. Baselines must be generated inside the official Microsoft Playwright container so local and CI render identically.

## Non-goals

- TLS / HTTPS termination. The server is plain HTTP; it is intended for trusted LAN only.
- Authentication or per-client identity. Any browser that can reach the port can connect.
- Persisting non-broadcast state (e.g. per-client preferences). The only persisted state is the late-joiner cache.
- Replaying `clear` messages to late joiners.
- Serving files outside the vault root or following `..` path segments — see `vault-routing.md`.
