# WebSocket Protocol

> Exhaustive message catalogue for the DM ↔ player WebSocket. Every message is a JSON object `{ type: string, payload: object }`. Connections are tagged with a **channel** (`player` for the `/` page, `map` for the `/map` page); message types prefixed `map-` belong to the `map` channel and every other type to the `player` channel — broadcast, cache replay, and cache purge are all channel-scoped. Adding a new message type means adding a row to the table below and a handler on both sides.

## Source files

- `src/server.ts` — `broadcast()`, late-joiner cache, message parsing (`PlayerMessage` interface)
- `src/main.ts` — `sendInitiativeUpdate()` (the only broadcast call outside `DmControlPanel` and `HydrusExplorerModal`)
- `src/views/DmControlPanel.ts` — emits `image-layers-sync`, `combat-scale`, `viewport-update`, `show-background-media`, `hide-background-media`, `clear`
- `src/views/HydrusExplorerModal.ts` — emits `show-background-media` for files chosen from the Hydrus library
- `src/player/player.ts` — handles every DM → player message, emits `client-info`

## Settings used

- `lastBroadcastCache` — persisted serialised messages so that a restart of Obsidian preserves the late-joiner cache

## Requirements

1. The protocol shall transport JSON-encoded objects of the form `{ type: string, payload: object }`.
1b. When a WebSocket connection is established, the server shall tag it with channel `map` if the upgrade request path starts with `/map`, else `player` (`messageChannel(type)` maps a message type to its channel: `map-` prefix → `map`, everything else → `player`).
2. The server shall send a serialised broadcast message exactly once per connected client of the message's channel whose `readyState` is `1` (OPEN); clients of the other channel shall not receive it.
3. When a client connects, the server shall replay every cached message of the client's channel in insertion order before any new broadcast can be sent to that client.
4. When a `clear` broadcast is sent, the server shall purge only the `player`-channel entries from the late-joiner cache before transmitting `clear` to player clients; `map-*` entries survive. Symmetrically, `map-clear` shall purge only the `map-*` entries and transmit to map clients only.
5. When any broadcast other than `clear`/`map-clear` is sent, the server shall overwrite the cache entry for `message.type` with the new serialised payload (one entry per type at most).
5b. Every `image-layers-sync` broadcast shall be followed immediately by an `image-layers-geometry` broadcast derived from the same state, so the cached geometry entry is never staler than the cached sync (cache replay preserves first-insertion order: sync before geometry).
6. When the player side receives a message whose `type` is not in its known set, it shall log `[Player Screen] Unknown message type:` and ignore the payload (no throw, no disconnect).
7. When the player side fails to parse a message as JSON, it shall log the failure and ignore the message.
8. When the WebSocket closes on the player side after the player has connected at least once, the player shall display a full-screen `Disconnected` overlay and attempt to reconnect after 3 seconds. On a successful reconnect that follows a previous disconnect, the player shall reload the page so the server's late-joiner cache replay reconstructs the screen from scratch. On the very first successful connect (no prior disconnect), the player shall hide the overlay if present and send `client-info`.
9. Player-side and map-side code shall not assign a payload URL field (`show-background-media.payload.url`, `map-show.payload.url`, `image-layers-sync.payload.layers[].dataUrl`, `image-layers-sync.payload.layers[].fogDataUrl`, `map-fog.payload.dataUrl`) to a DOM URL sink without first validating it with `safePlayerUrl(url, kind)` from `src/player/safeUrl.ts`. The helper accepts only `/vault/...` paths and `data:image/...` / `data:video/...` URLs of an allowlisted MIME family (no `image/svg+xml`, no `text/*`, no absolute HTTP URLs, no `javascript:`). Rejected URLs shall be logged via `console.warn` and the affected element (layer image, fog overlay, background) shall be skipped — no throw, no disconnect.

## Broadcast / IPC

| Message type | Direction | Payload | When sent | Late-joiner cached |
|--------------|-----------|---------|-----------|--------------------|
| `show-background-media` | DM → player | `{ url: string, mediaType: "image" \| "video", loop?: boolean, muted?: boolean }` | DM picks an image/video via Add BG or BG from Hydrus | yes |
| `hide-background-media` | DM → player | `{}` | DM clicks Stop BG | yes |
| `image-layers-sync` | DM → player | `{ layers: ImageLayer[] }` (see `image-layers/overview.md`) | Any structural change to the layer set (add, remove, fog change, toggle) and the end of every continuous gesture | yes |
| `image-layers-geometry` | DM → player | `{ layers: LayerGeometry[] }` — `{ id, x, y, width, height, zIndex, rotation, visible, bordered }`, no data URLs | Continuous gestures (layer drag, scale slider), trailing-throttled at 50 ms; also immediately after every `image-layers-sync` | yes |
| `initiative-update` | DM → player | `{ combatants: Combatant[], round: number }` (see `combat-tracker/overview.md`) | Manual turn advance, Initiative Tracker plugin save-state, or D&D Beyond poll cycle | yes |
| `combat-scale` | DM → player | `{ scale: number }` (`0.5`–`2.0`) | DM clicks `−` / `1×` / `+` on the tracker scale, or on initial render | yes |
| `viewport-update` | DM → player | `{ panX: number, panY: number, zoom: number }` | Reserved for player-viewport sync (currently emitted only by `broadcastPlayerViewport`; not bound to a UI control yet) | yes |
| `waiting-screen` | DM → player | `{ title: string, subtitle: string }` | Server start; `waitingTitle` or `waitingSubtitle` settings change | yes |
| `inspiration-style` | DM → player | `{ pulse: boolean }` | Server start; `ddbInspirationPulse` setting toggled | yes |
| `clear` | DM → player | `{}` | DM clicks Clear Player Screen | no (purges player-channel cache) |
| `map-show` | DM → map | `{ url: string, mediaType: "image" \| "video", naturalWidth: number, naturalHeight: number, loop?: boolean, muted?: boolean }` | DM applies a map (Add Map picker or Hydrus Set as map); `republishToServer()` | yes |
| `map-view` | DM → map | `{ mode: "physical" \| "fit", panX: number, panY: number, rotation: 0 \| 90 \| 180 \| 270 }` | Scale-mode toggle; Rotate button; pan drag (throttled) | yes |
| `map-config` | DM → map | `{ pxPerSquare, gridOffsetX, gridOffsetY, showGrid, gridColor, gridOpacity }` | Any grid control change | yes |
| `map-calibration` | DM → map | `{ profiles: Record<string, { diagonalInches, fineTune }> }` | Server start; calibration modal change | yes |
| `map-calibration-overlay` | DM → map | `{ show: boolean }` | Calibration test-pattern toggle | yes |
| `map-aoe-sync` | DM → map | `{ aoes: Array<{ id, shape, sizeFt, widthFt, color, opacity, rotation, x, y, label? }> }` | DM adds/edits/moves/removes an AoE overlay (drags throttled, immediate on release); map apply resets to `[]`; `republishToServer()` when non-empty | yes |
| `map-fog` | DM → map | `{ dataUrl: string \| null, opacity: number }` | Map apply; fog edit committed; opacity setting change; `republishToServer()` | yes |
| `map-vision` | DM → map | `{ visions: Array<{ id, shape: "circle" \| "square", x, y, sizeFt, featherFt }> }` | DM adds/edits/moves/removes a vision shape (drags throttled, immediate on release); map apply resets to `[]`; bake commits into `map-fog` and clears; `republishToServer()` when non-empty | yes |
| `map-clear` | DM → map | `{}` | DM clicks Stop Map | no (purges map-channel cache) |
| `client-info` | player/map → DM | `{ width: number, height: number, devicePixelRatio: number, channel?: "map" }` | Client connects; window resizes. The server stores it with the connection's channel regardless of the payload field | n/a (received only) |

## Tests covering this

- `src/__tests__/server-broadcast.test.ts` — late-joiner replay; `readyState` filtering; `clear` cache purge
- `src/__tests__/server-map-channel.test.ts` — channel tagging, channel-filtered broadcast/replay, channel-scoped `clear`/`map-clear` purges
- `src/__tests__/server-combat-scale.test.ts` — `combat-scale` round-trip
- `src/__tests__/server-bootstrap.integration.test.ts` — real `ws` client receives the cached state on connect
- `src/__tests__/ddb-to-player.integration.test.ts` — D&D Beyond poll cycle → `initiative-update` on the wire
- `src/__tests__/ddb-fixture-replay.integration.test.ts` — recorded D&D Beyond fixture replays through the server and produces `initiative-update` messages

## Non-goals

- Binary frames. All traffic is JSON text.
- Server → player message acknowledgements. Broadcasts are fire-and-forget.
- Ordering guarantees across types. Different types are independent; a `combat-scale` may arrive before an `image-layers-sync` even if the DM emitted them in the other order under heavy load.
- Backwards-compatible aliasing of removed message types. When a type is removed, the handler is removed from `player.ts` in the same commit.
