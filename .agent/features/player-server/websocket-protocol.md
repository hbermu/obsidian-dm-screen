# WebSocket Protocol

> Exhaustive message catalogue for the DM ↔ player WebSocket. Every message is a JSON object `{ type: string, payload: object }`. Adding a new message type means adding a row to the table below and a handler on both sides.

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
2. The server shall send a serialised broadcast message exactly once per connected client whose `readyState` is `1` (OPEN).
3. When a client connects, the server shall replay every cached message in insertion order before any new broadcast can be sent to that client.
4. When a `clear` broadcast is sent, the server shall purge the late-joiner cache before transmitting `clear` to clients.
5. When any non-`clear` broadcast is sent, the server shall overwrite the cache entry for `message.type` with the new serialised payload (one entry per type at most).
6. When the player side receives a message whose `type` is not in its known set, it shall log `[Player Screen] Unknown message type:` and ignore the payload (no throw, no disconnect).
7. When the player side fails to parse a message as JSON, it shall log the failure and ignore the message.
8. When the WebSocket closes on the player side after the player has connected at least once, the player shall display a full-screen `Disconnected` overlay and attempt to reconnect after 3 seconds. On a successful reconnect that follows a previous disconnect, the player shall reload the page so the server's late-joiner cache replay reconstructs the screen from scratch. On the very first successful connect (no prior disconnect), the player shall hide the overlay if present and send `client-info`.

## Broadcast / IPC

| Message type | Direction | Payload | When sent | Late-joiner cached |
|--------------|-----------|---------|-----------|--------------------|
| `show-background-media` | DM → player | `{ url: string, mediaType: "image" \| "video", loop?: boolean, muted?: boolean }` | DM picks an image/video via Add BG or BG from Hydrus | yes |
| `hide-background-media` | DM → player | `{}` | DM clicks Stop BG | yes |
| `image-layers-sync` | DM → player | `{ layers: ImageLayer[] }` (see `image-layers/overview.md`) | Any change to layer position, scale, rotation, visibility, border, fog, or set | yes |
| `initiative-update` | DM → player | `{ combatants: Combatant[], round: number }` (see `combat-tracker/overview.md`) | Manual turn advance, Initiative Tracker plugin save-state, or D&D Beyond poll cycle | yes |
| `combat-scale` | DM → player | `{ scale: number }` (`0.5`–`2.0`) | DM clicks `−` / `1×` / `+` on the tracker scale, or on initial render | yes |
| `viewport-update` | DM → player | `{ panX: number, panY: number, zoom: number }` | Reserved for player-viewport sync (currently emitted only by `broadcastPlayerViewport`; not bound to a UI control yet) | yes |
| `waiting-screen` | DM → player | `{ title: string, subtitle: string }` | Server start; `waitingTitle` or `waitingSubtitle` settings change | yes |
| `clear` | DM → player | `{}` | DM clicks Clear Player Screen | no (purges cache) |
| `client-info` | player → DM | `{ width: number, height: number, devicePixelRatio: number }` | Player connects; player window resizes | n/a (received only) |

## Tests covering this

- `src/__tests__/server-broadcast.test.ts` — late-joiner replay; `readyState` filtering; `clear` cache purge
- `src/__tests__/server-combat-scale.test.ts` — `combat-scale` round-trip
- `src/__tests__/server-bootstrap.integration.test.ts` — real `ws` client receives the cached state on connect
- `src/__tests__/ddb-to-player.integration.test.ts` — D&D Beyond poll cycle → `initiative-update` on the wire
- `src/__tests__/ddb-fixture-replay.integration.test.ts` — recorded D&D Beyond fixture replays through the server and produces `initiative-update` messages

## Non-goals

- Binary frames. All traffic is JSON text.
- Server → player message acknowledgements. Broadcasts are fire-and-forget.
- Ordering guarantees across types. Different types are independent; a `combat-scale` may arrive before an `image-layers-sync` even if the DM emitted them in the other order under heavy load.
- Backwards-compatible aliasing of removed message types. When a type is removed, the handler is removed from `player.ts` in the same commit.
