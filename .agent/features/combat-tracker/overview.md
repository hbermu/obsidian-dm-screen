# Combat Tracker

> The COMBAT section in the DM Control Panel. Three exclusive sources of initiative state — manual entry, sync from the Initiative Tracker community plugin, or polling a D&D Beyond encounter — are surfaced via tabs. Whichever source is active broadcasts an `initiative-update` to the player screen.

## Source files

- `src/views/DmControlPanel.ts` — `renderInitiativeSection`, `renderManualTracker`, `renderPluginTracker`, `renderPluginCombatantRow`, `getActiveCombatLabel`, `isCombatBroadcasting`, `stopAllCombatBroadcast`, scale controls, the tab bar
- `src/main.ts` — `sendInitiativeUpdate`, `onInitiativeStateChange`, `onInitiativeStop`, `lookupStatblock` for plugin-synced creatures
- `src/views/DnDBeyondPanel.ts` — D&D Beyond tab implementation (specified in `../dndbeyond-integration/`)
- `src/player/player.ts` — `updateInitiative`, `applyCombatScale`
- `src/player/player.css` — `#initiative-tracker` (translucent panel chrome), `.init-entry`, `.init-active`, `.init-friendly`, condition colour classes

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
6. The broadcast button (`.dm-emit-toggle`, label `● Live`) in the COMBAT section header shall carry the `dm-emit-active` class and be enabled (green, clickable) while any source is broadcasting; clicking it shall call `stopAllCombatBroadcast`. When no source is broadcasting, the button shall carry the HTML `disabled` attribute (greyed out via CSS, not clickable).
7. `isCombatBroadcasting` shall return true if any of: plugin combatants present, manual combatants present, or D&D Beyond tracking active.
8. `stopAllCombatBroadcast` shall: stop the D&D Beyond poller (if any), clear manual combatants and round, set `trackerSource = "manual"`, clear plugin combatants and encounter name, send an empty `initiative-update`, and re-render.
9. Tracker scale controls (`−`, `1×`, `+`) shall adjust `combatTrackerScale` by ±0.1 (clamped `[0.5, 2.0]`, rounded to 1 decimal) or reset to `1`, persist to settings, and broadcast `combat-scale`.
10. On first render after each panel open, the DM panel shall broadcast the persisted `combatTrackerScale` exactly once.
11. The player shall apply the scale via `transform: scale(<scale>)` on `#initiative-tracker` with `transform-origin: top right`, and shall set the CSS variable `--combat-scale` so the tracker's `max-height` adapts.
12. The player shall render combatants in payload order (already sorted by initiative DESC on the DM side).
13. The player shall scroll the active combatant into view (`scroll-behavior: smooth`).
14. The player shall render HP as a condition word for hostile combatants: `Well` (100%), `Hurt` (<100%), `Bloodied` (≤50%), `Down` (≤0). Allies (`friendly` or `isPlayer`) shall show both numeric HP and condition unless `hideHp` is set.
15. Round-1 reveal behaviour is specified in `round-1-reveal.md`.
16. The player-screen tracker panel (`#initiative-tracker`) shall be rendered with a translucent dark background (`rgba(10, 10, 10, 0.55)`) layered over `backdrop-filter: blur(10px)` so the player-screen background remains partly visible through the panel while combatant text stays legible.
17. Stopping the Player Screen server (via the Stop Server button, the `Toggle Player Screen Server` command, or plugin unload) shall invoke `stopAllCombatBroadcast` on every open DM Control Panel view *before* tearing down the server. This guarantees the D&D Beyond poller is cancelled and no further encounter/character requests fire once there is no player screen to receive the broadcast.

### Conditions

18. Every combatant carries a `statuses: string[]` channel. Each entry is either a D&D 5e condition id from `src/conditions.ts` (`"blinded"`, `"charmed"`, …, 14 total) or the encoded form `"exhaustion:N"` with N in [1, 6]. Any other string is preserved and rendered as a plain-text badge (backwards-compat with the Initiative Tracker plugin source).
19. The player screen and the DM views shall render known status strings as inline SVG icons sourced from `CONDITIONS[id].iconSvg`, using the condition name as the native `title` for hover tooltips. Exhaustion shall additionally render the level number as a small badge in the bottom-right corner of the icon.
20. PC conditions originating from D&D Beyond shall be populated from the `DdbCharacterSummary.statuses` field (parsed from `data.conditions[]` on the character sheet — see `../dndbeyond-integration/encounters-and-tracking.md`). They are read-only from the DM's perspective: re-derived on every poll cycle.
21. The DM may add or remove conditions on D&D Beyond monster rows (click anywhere on the row) and on local manual combatants (click on the combatant's name span), opening an Obsidian `Menu` with 14 toggle items plus an Exhaustion section (Remove, Level 1..6). Toggling triggers an immediate broadcast and a re-render.
22. DM-assigned conditions are ephemeral: D&D Beyond monster conditions live in `DnDBeyondPanel.monsterStatuses` (a `Map<instanceKey, Set<status>>` keyed by the per-instance `uniqueId` returned by D&D Beyond, falling back to `${monster.id}:${monster.name}` when `uniqueId` is empty — this disambiguates "Goblin (A)" vs "Goblin (B)" that share a template id). The map is cleared by `selectEncounter` and `stopTracking`. Local manual conditions live on `ManualCombatant.statuses` and persist with the manual combatant for the lifetime of the panel, but they are not written to disk.

### Heroic Inspiration

23. Combatants carry an `inspired: boolean` channel. While `inspired === true`, the player view and the DM-side preview shall add the `init-inspired` class to the combatant's `<li>`. The class renders a red `box-shadow` glow (no `border-left`/`background` interference, so the glow stacks orthogonally with `init-active`, `init-friendly`, and `init-hidden`).
24. Only the D&D Beyond source populates `inspired` (sourced from `data.inspiration` on the character sheet — see `../dndbeyond-integration/encounters-and-tracking.md` Req 20). Initiative Tracker plugin sync and manual mode shall leave `inspired` undefined (treated as `false`).
25. While `settings.ddbInspirationPulse === true`, the player shall additionally animate `.init-inspired` with the `dm-inspired-pulse` keyframes (1.5 s ease-in-out infinite). The DM-side preview shall animate the same way when its container `.dm-ddb-panel` carries the `dm-inspired-pulse-on` class. When the setting is `false`, the glow is static and characteristic but does not pulse.
26. Toggling `ddbInspirationPulse` in settings shall (a) call `plugin.broadcastInspirationStyle()` to broadcast `inspiration-style` to every connected client and (b) call `plugin.refreshOpenDmPanels()` so the DM panel re-renders with the new container class.

## Broadcast / IPC

| Message type | Direction | Payload | When |
|--------------|-----------|---------|------|
| `initiative-update` | DM → player | `{ combatants: Combatant[], round: number }` | Manual turn change; Initiative Tracker plugin save-state; D&D Beyond poll cycle |
| `combat-scale` | DM → player | `{ scale: number }` | Scale +/-/1× pressed; first render after panel open |
| `inspiration-style` | DM → player | `{ pulse: boolean }` | Server start; `ddbInspirationPulse` setting toggled |

`Combatant` payload shape: `{ name, hp, maxHp, initiative, active, friendly?, isPlayer?, hidden?, hideHp?, statuses?, inspired? }`.

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
- Surfacing Heroic Inspiration for non-D&D-Beyond sources. The Initiative Tracker plugin and manual mode have no data channel for it; their combatants always render without the `init-inspired` highlight.
- Spending or toggling Heroic Inspiration from the plugin. The integration is read-only — the DM still toggles it on the D&D Beyond service itself; the plugin reflects the change on the next poll cycle.
