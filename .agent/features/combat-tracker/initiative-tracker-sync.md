# Initiative Tracker Plugin Sync

> When the Javalent Initiative Tracker community plugin is installed and an encounter is running, the DM Control Panel switches to a read-only synced view of that plugin's state. The plugin emits `initiative-tracker:save-state` events; the DM panel and the broadcast keep in lockstep.

## Source files

- `src/main.ts` — workspace event registrations (`save-state`, `stop-viewing`, `unloaded`), `onInitiativeStateChange`, `onInitiativeStop`, `lookupStatblock`, `sendInitiativeUpdate`
- `src/views/DmControlPanel.ts` — `syncFromInitiativeTracker`, `disconnectFromTracker`, `renderPluginTracker`, `renderPluginCombatantRow`, `trackerSource`, `pluginCombatants`, `pluginRound`, `encounterName`, `expandedCreature`
- `src/types.ts` — `CreatureState`, `InitiativeViewState`, `TrackerCombatant`

## Settings used

- `none`

## Requirements

1. On plugin load, the plugin shall register listeners for the workspace events `initiative-tracker:save-state`, `initiative-tracker:stop-viewing`, and `initiative-tracker:unloaded`.
2. When `initiative-tracker:save-state` fires, the plugin shall map every `CreatureState` to a `TrackerCombatant`:
   - `name` from `c.name`
   - `displayName` from `c.display || c.name`
   - `initiative` from `c.initiative ?? 0`
   - `hp` from `c.currentHP ?? c.hp ?? 0`
   - `maxHp` from `c.currentMaxHP ?? c.hp ?? 0`
   - `tempHp` from `c.tempHP ?? 0`
   - `ac` from `c.currentAC ?? c.ac ?? 0`
   - `active` from `c.active`
   - `hidden` from `c.hidden`
   - `friendly` from `c.friendly`
   - `isPlayer` from `c.player`
   - `statuses` from `c.status ?? []`
   - `statblock` from `lookupStatblock(displayName, baseName)`, with `baseName = name.replace(/\s+\d+$/, "")`
   - `source: "tracker-plugin"`
3. The plugin shall forward the mapped list, the round number, and the encounter name to every open `DmControlPanel` via `syncFromInitiativeTracker`.
4. The plugin shall broadcast `initiative-update` with the visible combatants (hidden filtered out via `sendInitiativeUpdate`), applying the round-1 reveal rule (see `round-1-reveal.md`).
5. When `initiative-tracker:stop-viewing` or `initiative-tracker:unloaded` fires, the plugin shall call `disconnectFromTracker` on every open DM panel.
6. `disconnectFromTracker` shall reset `trackerSource` to `"manual"`, clear `pluginCombatants`, `pluginRound`, `encounterName`, and `expandedCreature`, and re-render.
7. The synced view shall display a `Synced` badge, the encounter name, the round number, and a Disconnect button.
8. Each combatant row shall display: initiative number, display name with optional `(PC)` or `[hidden]` badge, status badges, an HP bar with colour by percentage, the AC, and an expand button.
9. When the expand button is clicked, the panel shall show or hide the statblock for that combatant.
10. The statblock shall be rendered via `renderStatblock` from `../statblock-display/overview.md`; if no statblock is found, the panel shall show `Statblock not found in bestiary`.
11. The Disconnect button shall call `disconnectFromTracker`.

## Statblock lookup

12. `lookupStatblock` shall first try `window.FantasyStatblocks.getCreatureFromBestiary(displayName)`.
13. If that misses and `baseName` differs from `displayName`, then `lookupStatblock` shall try `getCreatureFromBestiary(baseName)` (e.g. `"Goblin 3"` → `"Goblin"`).
14. The plugin shall cache the result in `statblockCache` keyed by `displayName`, including negative results.

## Tests covering this

- `src/__tests__/main.test.ts` — event registration, `CreatureState` mapping, `sendInitiativeUpdate` filtering, statblock lookup fallback and caching, `onInitiativeStop` disconnect propagation

## Non-goals

- Two-way sync. The Initiative Tracker plugin is the single source of truth while syncing; this plugin does not write back HP or status changes.
- Polling the Initiative Tracker API. The integration is event-driven only.
- Mapping arbitrary plugin events beyond the three listed.
- Re-running statblock lookup if Fantasy Statblocks is loaded after the sync. The cache holds negative results forever in the current session.
