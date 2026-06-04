# Encounters List and Tracking

> The D&D Beyond tab lets the DM pick an encounter from a modal, render a player-side preview, and broadcast each poll cycle as an `initiative-update`.

## Source files

- `src/dndbeyond/client.ts` — `getEncounters`, `getEncounter`, `parseEncounter` (parser strips hidden players and the abstract player type)
- `src/views/DnDBeyondPanel.ts` — `initialize`, `selectEncounter`, `startTracking`, `stopTracking`, `onPollUpdate`, `broadcastToPlayerScreen`, `buildParticipants`, `renderPreview`, `getActiveEncounterStatus`, `isTracking`, the Show PC HP / Show full turn order toggles
- `src/views/DnDBeyondEncounterModal.ts` — modal launched by the `Choose Encounter` button; fetches the encounter list on each open and invokes a callback when a row is clicked
- `src/views/DmControlPanel.ts` — `getActiveCombatLabel` (renders the combat title as an anchor when the active source is D&D Beyond)

## Settings used

- `ddbCobaltSession` (validated on panel initialise)

## Requirements

### Initialisation

1. On panel initialise: if `ddbCobaltSession` is empty, the panel shall render a configuration message and stop. Otherwise it shall construct a `DdbClient` and validate the session.
2. If `validateSession` returns false, the panel shall clear its client reference and show a Notice `D&D Beyond session expired. Update cookie in settings.`.

### Choose Encounter modal

3. The DM panel shall render a `Choose Encounter` button which opens `DnDBeyondEncounterModal`.
4. The modal shall re-fetch the encounter list from D&D Beyond on every open.
5. The modal shall expose a search input that filters rows by case-insensitive substring match on the encounter name.
6. Each modal row shall display the encounter name and, when applicable, an `In Progress` badge. Clicking a row shall invoke `onSelect(encounterId)` and close the modal. Row clicks shall NOT open the upstream D&D Beyond URL.
7. If the DM closes and re-opens the modal while a previous fetch is in flight, the older fetch result shall be discarded (a monotonic `fetchSeq` token guards the render).

### Selected encounter title

8. While an encounter is selected, the COMBAT section title shall be rendered as an anchor whose click opens `https://www.dndbeyond.com/encounters/<id>` in an external browser window.

### Parser

9. `parseEncounter` shall strip players with `type === "CHARACTER_TYPE_ABSTRACT"` and players with `hidden === true`. (They are removed entirely from the parsed encounter.)
10. The parser shall coerce player `id` (which the API returns as either number or string) to a number; non-numeric strings become `0` and are filtered out by the poller's `if (!player.id || player.id === 0) continue`.

### Tracking lifecycle

11. `startTracking(encounterId)` shall instantiate a `DdbEncounterPoller` with `onUpdate = onPollUpdate` and `onError = onPollError`, and call its `start`.
12. `stopTracking` shall stop the poller, clear `selectedEncounterId` and `polledState`, send an empty `initiative-update`, re-render, and call `onTrackingChange`. The tab itself does not expose a dedicated "stop" button; stopping is driven from `DmControlPanel.stopAllCombatBroadcast` (the `● Live` button in the COMBAT section header) and from `DnDBeyondPanel.destroy()`.
13. `isTracking` shall return true when both `poller` and `selectedEncounterId` are set.
14. `getActiveEncounterStatus` shall return `{ id, name, roundNum }` while tracking, else `null`.

### Broadcast

15. `broadcastToPlayerScreen(state)` shall build a combatant array from `state.encounter.players`, `state.encounter.monsters`, and `state.encounter.manualEntries`, sorted by initiative DESC.
16. For player entries, the combatant shall use the polled character's `currentHitPoints` / `maxHitPoints`; for monsters and manual entries, the encounter's `currentHitPoints` / `maximumHitPoints`.
17. The active turn shall be `encounter.turnNum - 1` while `encounter.inProgress` is true, otherwise `-1`.
18. While `encounter.inProgress === false`, the broadcast shall mark no combatant active.
19. The reveal rule shall be applied (see `../combat-tracker/round-1-reveal.md`): when `showFullTurnOrder === false`, combatants at index `> currentTurnIdx` shall be marked `hidden`; when `true`, no combatant shall be marked hidden by this rule.
20. PC entries shall carry `friendly: true`, `isPlayer: true`, `statuses: []`, and `hideHp: !showPcHp`.
21. Monster and manual entries shall carry `friendly: false`, `isPlayer: false`, `statuses: []`.

### Toggles

22. The Show PC HP checkbox shall toggle `showPcHp`; when toggled while a `polledState` is in memory, the panel shall re-broadcast immediately and re-render the preview.
23. The Show full turn order checkbox shall toggle `showFullTurnOrder`; the first toggle by the DM shall set `showFullTurnOrderUserSet = true`. When toggled while a `polledState` is in memory, the panel shall re-broadcast immediately and re-render the preview.
24. When `selectEncounter` is called, both `showFullTurnOrder` and `showFullTurnOrderUserSet` shall be reset to `false`.
25. On the first `onPollUpdate` after a new selection (i.e. previous `polledState` was null), when `showFullTurnOrderUserSet === false` and `state.encounter.roundNum >= 2`, the panel shall auto-set `showFullTurnOrder = true` and sync the checkbox.

### DM-side preview

26. The panel shall render a `dm-ddb-preview` block containing a `Player preview — Round N` header (or `Player preview` when no encounter is selected; `Player preview — Encounter idle` when the encounter is not in progress) and a `<ul class="dm-ddb-preview-list">`.
27. The preview list shall render every participant returned by `buildParticipants` — including those marked `hidden` — using the same `init-entry` / `init-active` / `init-friendly` / `init-pc-tag` / `init-name` / `init-hp-text` / `init-condition-*` classes the player view uses. Hidden combatants shall additionally carry the `init-hidden` class (dimmed).
28. When no encounter is selected, the preview shall display the empty-state text `No encounter selected. Click Choose Encounter to begin.`. When the polled encounter has no combatants, it shall display `Encounter has no combatants.`.

## Tests covering this

- `src/__tests__/ddb-client.test.ts` — `parseEncounter` (hidden filter, abstract filter, id coercion)
- `src/__tests__/ddb-panel-tracking-state.test.ts` — broadcast shape, sort, active-turn calc, reveal rule, PC HP toggle, `showFullTurnOrder` defaults and user-override stickiness, `getActiveEncounterStatus` id
- `src/__tests__/ddb-encounter-modal.test.ts` — modal renders rows from fetch, click invokes `onSelect` + closes, stale fetch is discarded
- `src/__tests__/ddb-to-player.integration.test.ts` — end-to-end poll → broadcast → `ws` client
- `src/__tests__/ddb-fixture-replay.integration.test.ts` — fixture replay: happy path, encounter not in progress, `manualEntries` parse alongside players and monsters

## Non-goals

- Editing combatants from the panel. Players and monsters are read from the upstream service.
- Manually starting / advancing the encounter from the panel. The DM does that on the upstream service.
- Multi-encounter tracking concurrently.
- Caching encounter state across panel close / re-open. State is dropped on `destroy` / `stopTracking`.
