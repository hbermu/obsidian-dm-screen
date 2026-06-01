# Encounters List and Tracking

> The D&D Beyond tab lists encounters from the user's account, lets the DM start/stop tracking one, and turns each poll cycle into an `initiative-update` for the player screen.

## Source files

- `src/dndbeyond/client.ts` — `getEncounters`, `getEncounter`, `parseEncounter` (parser strips hidden players and the abstract player type)
- `src/views/DnDBeyondPanel.ts` — `initialize`, `loadEncounters`, `renderList`, `selectEncounter`, `startTracking`, `stopTracking`, `onPollUpdate`, `broadcastToPlayerScreen`, `getActiveEncounterStatus`, `isTracking`, the search filter and Show PC HP toggle

## Settings used

- `ddbCobaltSession` (validated on panel initialise)

## Requirements

### Initialisation

1. On panel initialise: if `ddbCobaltSession` is empty, the panel shall render a configuration message and stop. Otherwise it shall construct a `DdbClient`, validate the session, and load the encounter list.
2. If `validateSession` returns false, the panel shall clear its client reference and show a Notice `D&D Beyond session expired. Update cookie in settings.`.

### Encounter list

3. The list shall be re-fetched each time the panel container is (re-)mounted.
4. Each row shall expose a select button (`○` / `✓`) and a clickable encounter name. Clicking the select toggles selection: a new selection stops the previous poller and starts a new one for the new id. Clicking the name opens the upstream encounter URL in an external browser window.
5. The search input shall filter rows by case-insensitive substring match on the encounter name.
6. Rows whose encounter is in progress shall display an `In Progress` badge.

### Parser

7. `parseEncounter` shall strip players with `type === "CHARACTER_TYPE_ABSTRACT"` and players with `hidden === true`. (They are removed entirely from the parsed encounter.)
8. The parser shall coerce player `id` (which the API returns as either number or string) to a number; non-numeric strings become `0` and are filtered out by the poller's `if (!player.id || player.id === 0) continue`.

### Tracking lifecycle

9. `startTracking(encounterId)` shall instantiate a `DdbEncounterPoller` with `onUpdate = onPollUpdate` and `onError = onPollError`, and call its `start`.
10. `stopTracking` shall stop the poller, clear `selectedEncounterId` and `polledState`, send an empty `initiative-update`, re-render the list, and call `onTrackingChange`.
11. `isTracking` shall return true when both `poller` and `selectedEncounterId` are set.
12. `getActiveEncounterStatus` shall return the current encounter's `{ name, roundNum }` while tracking, else `null`.

### Broadcast

13. `broadcastToPlayerScreen(state)` shall build a combatant array from `state.encounter.players`, `state.encounter.monsters`, and `state.encounter.manualEntries`, sorted by initiative DESC.
14. For player entries, the combatant shall use the polled character's `currentHitPoints` / `maxHitPoints`; for monsters and manual entries, the encounter's `currentHitPoints` / `maximumHitPoints`.
15. The active turn shall be `encounter.turnNum - 1` while `encounter.inProgress` is true, otherwise `-1`.
16. While `encounter.inProgress === false`, the broadcast shall mark no combatant active.
17. The round-1 reveal rule shall be applied (see `../combat-tracker/round-1-reveal.md`).
18. PC entries shall carry `friendly: true`, `isPlayer: true`, `statuses: []`, and `hideHp: !showPcHp`.
19. Monster and manual entries shall carry `friendly: false`, `isPlayer: false`, `statuses: []`.
20. The Show PC HP checkbox shall toggle `showPcHp`; when toggled while a `polledState` is in memory, the panel shall re-broadcast immediately.

## Tests covering this

- `src/__tests__/ddb-client.test.ts` — `parseEncounter` (hidden filter, abstract filter, id coercion)
- `src/__tests__/ddb-panel-tracking-state.test.ts` — broadcast shape, sort, active-turn calc, round-1 reveal, PC HP toggle
- `src/__tests__/ddb-to-player.integration.test.ts` — end-to-end poll → broadcast → `ws` client
- `src/__tests__/ddb-fixture-replay.integration.test.ts` — fixture replay produces matching `initiative-update`

## Non-goals

- Editing combatants from the panel. Players and monsters are read from the upstream service.
- Manually starting / advancing the encounter from the panel. The DM does that on the upstream service.
- Multi-encounter tracking concurrently.
- Caching encounter state across panel close / re-open. State is dropped on `destroy` / `stopTracking`.
