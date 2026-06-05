# D&D Beyond Integration

> The DM can pair the plugin with a D&D Beyond account via the user's `CobaltSession` browser cookie. Once paired, the COMBAT section grows a `D&D Beyond` tab that lists encounters, lets the DM pick one, polls it for live initiative / HP / manual entries, and broadcasts the round-1-aware combatant list. Monster avatars are fetched and added as hidden image layers for quick visual reference.

## Source files

- `src/dndbeyond/client.ts` — `DdbClient`, token refresh, encounter/character/monster API calls
- `src/dndbeyond/poller.ts` — `DdbEncounterPoller`, min-gap pacing, circuit breaker
- `src/dndbeyond/imageCache.ts` — `DdbImageCache`, monster-avatar download + TTL sweep (rooted at `<cacheBaseFolder>/beyond/`)
- `src/dndbeyond/types.ts` — type shapes
- `src/views/DnDBeyondPanel.ts` — the D&D Beyond tab inside the COMBAT section
- `src/settings.ts` — D&D Beyond settings section (enable, cookie, test connection)
- `src/main.ts` — schedules the image cache sweep alongside Hydrus

## Settings used

- `ddbEnabled` — gates the tab
- `ddbCobaltSession` — the `CobaltSession` cookie used as auth
- `ddbInspirationPulse` — animates (or not) the red glow that marks D&D Beyond PCs with Heroic Inspiration; see `../combat-tracker/overview.md`
- `cacheBaseFolder` — the monster image cache lives at `<cacheBaseFolder>/beyond/`
- `hydrusCacheTtlDays` — re-used for the monster image cache TTL

## Requirements

1. The DM panel shall render the `D&D Beyond` tab only when both `ddbEnabled` is true and `ddbCobaltSession` is non-empty.
2. The settings tab shall expose:
   - An Enable toggle.
   - A password-type input for the `CobaltSession` cookie value (trimmed on save).
   - An `Open D&D Beyond` button that opens the upstream service URL in a browser window (via `window.open`).
   - A Test connection button that calls `client.validateSession()` and shows a Notice with the outcome.
   - A `Pulse on inspired PC rows` toggle that controls whether the player-screen highlight for Heroic Inspiration animates. When toggled, the plugin calls `broadcastInspirationStyle()` to push the new state to every connected client and `refreshOpenDmPanels()` so the DM-side preview picks up the change too.
3. The D&D Beyond tab shall expose a Choose Encounter button (its modal carries the search input that filters encounters by case-insensitive substring — see `encounters-and-tracking.md`), a Show PC HP checkbox that toggles `hideHp` on PC entries in the broadcast, and a Show full turn order checkbox (see `../combat-tracker/round-1-reveal.md`).
4. Detailed sub-functionality is split across:
   - `auth.md` — CobaltSession → Bearer token, refresh, validate
   - `poller.md` — long-polling cadence, circuit breaker, min-gap
   - `encounters-and-tracking.md` — list, search, select, broadcast
   - `monster-images.md` — avatar dedupe, cache, add as hidden layers

## Broadcast / IPC

The D&D Beyond integration is a source for `initiative-update` (see `../combat-tracker/overview.md`). It does not introduce its own message types.

## Tests covering this

- `src/__tests__/ddb-client.test.ts` — every client method including error mapping
- `src/__tests__/ddb-poller.test.ts` — poller cadence, circuit breaker
- `src/__tests__/ddb-panel-tracking-state.test.ts` — broadcast shape, round-1 reveal, hidden players filter, PC HP toggle
- `src/__tests__/ddb-image-cache.test.ts` — avatar cache round-trip and sweep
- `src/__tests__/ddb-to-player.integration.test.ts` — poll → broadcast → real `ws` client receives `initiative-update`
- `src/__tests__/ddb-fixture-replay.integration.test.ts` — recorded encounter fixture replayed through the panel

## Non-goals

- Writing back to the D&D Beyond service (HP changes, advancing turns, etc.). The integration is read-only.
- Caching encounter list across sessions. The list is re-fetched on every panel open.
- Per-player authentication. A single `CobaltSession` is used for all calls.
- Cross-DM sharing of encounters. The cookie is per-user.
