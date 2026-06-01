# Combat Tracker

> The COMBAT section in the DM Control Panel. Three exclusive sources of initiative state — manual entry, sync from the Initiative Tracker community plugin, or polling a D&D Beyond encounter — are surfaced via tabs. Whichever source is active broadcasts an `initiative-update` to the player screen.

## Source files

- `src/views/DmControlPanel.ts` — `renderInitiativeSection`, `renderManualTracker`, `renderPluginTracker`, `renderPluginCombatantRow`, `getActiveCombatLabel`, `isCombatBroadcasting`, `stopAllCombatBroadcast`, scale controls, the tab bar
- `src/main.ts` — `sendInitiativeUpdate`, `onInitiativeStateChange`, `onInitiativeStop`, `lookupStatblock` for plugin-synced creatures
- `src/views/DnDBeyondPanel.ts` — D&D Beyond tab implementation (specified in `../dndbeyond-integration/`)
- `src/player/player.ts` — `updateInitiative`, `applyCombatScale`
- `src/player/player.css` — `#initiative-tracker`, `.init-entry`, `.init-active`, `.init-friendly`, condition colour classes

## Settings used

- `combatTrackerScale` — player-side tracker scale, persisted; default `1.0`
- `ddbEnabled`, `ddbCobaltSession` — control whether the D&D Beyond tab is shown

## Requirements

1. The DM panel shall render a section titled `COMBAT` containing the broadcast toggle, the tab bar, the active-combat name row with scale controls, and the body of the active tab.
2. When neither `ddbEnabled` nor a `ddbCobaltSession` is set, the DM panel shall not render the D&D Beyond tab; only the Local Track tab exists.
3. When both `ddbEnabled` and `ddbCobaltSession` are set, the DM panel shall render two tabs: `Local Track` and `D&D Beyond`.
4. The Local Track tab shall switch between the manual tracker (when `trackerSource === "manual"`) and the plugin-synced tracker (when `trackerSource === "plugin"`). See `manual-mode.md` and `initiative-tracker-sync.md`.
5. The active-combat label shall display:
   - For D&D Beyond: `<encounter name> — Round <n>` from the poller status.
   - For plugin sync: `<encounter name> — Round <n>` from the last `save-state`.
   - For manual / no combat: empty string.
6. The broadcast toggle (red dot in the header) shall be active (`dm-emit-active`) while any source is broadcasting. Clicking it while active shall call `stopAllCombatBroadcast`.
7. `isCombatBroadcasting` shall return true if any of: plugin combatants present, manual combatants present, or D&D Beyond tracking active.
8. `stopAllCombatBroadcast` shall: stop the D&D Beyond poller (if any), clear manual combatants and round, set `trackerSource = "manual"`, clear plugin combatants and encounter name, send an empty `initiative-update`, and re-render.
9. Tracker scale controls (`−`, `1×`, `+`) shall adjust `combatTrackerScale` by ±0.1 (clamped `[0.5, 2.0]`, rounded to 1 decimal) or reset to `1`, persist to settings, and broadcast `combat-scale`.
10. On first render after each panel open, the DM panel shall broadcast the persisted `combatTrackerScale` exactly once.
11. The player shall apply the scale via `transform: scale(<scale>)` on `#initiative-tracker` with `transform-origin: top right`, and shall set the CSS variable `--combat-scale` so the tracker's `max-height` adapts.
12. The player shall render combatants in payload order (already sorted by initiative DESC on the DM side).
13. The player shall scroll the active combatant into view (`scroll-behavior: smooth`).
14. The player shall render HP as a condition word for hostile combatants: `Well` (100%), `Hurt` (<100%), `Bloodied` (≤50%), `Down` (≤0). Allies (`friendly` or `isPlayer`) shall show both numeric HP and condition unless `hideHp` is set.
15. Round-1 reveal behaviour is specified in `round-1-reveal.md`.

## Broadcast / IPC

| Message type | Direction | Payload | When |
|--------------|-----------|---------|------|
| `initiative-update` | DM → player | `{ combatants: Combatant[], round: number }` | Manual turn change; Initiative Tracker plugin save-state; D&D Beyond poll cycle |
| `combat-scale` | DM → player | `{ scale: number }` | Scale +/-/1× pressed; first render after panel open |

`Combatant` payload shape: `{ name, hp, maxHp, initiative, active, friendly?, isPlayer?, hidden?, hideHp?, statuses? }`.

## Tests covering this

- `src/__tests__/dm-control-combat.test.ts` — broadcast toggle state, stop-all behaviour, scale controls
- `src/__tests__/main.test.ts` — Initiative Tracker plugin event mapping into `TrackerCombatant[]`, `sendInitiativeUpdate` filters hidden
- `src/__tests__/server-combat-scale.test.ts` — `combat-scale` end-to-end
- `src/__tests__/ddb-to-player.integration.test.ts` — D&D Beyond → player `initiative-update`

## Non-goals

- Mixing two sources at once. The COMBAT section has exactly one active source; switching tabs does not merge combatants.
- Player-side combatant editing. Players see and only see what the DM broadcasts.
- Custom condition words beyond Well / Hurt / Bloodied / Down.
- Per-combatant scale or position on the player tracker; the entire `#initiative-tracker` is scaled as a unit.
- Persisting manual combatants across plugin reload (manual mode is session-scoped; the persisted state is `combatTrackerScale` only).
