# Manual Initiative Mode

> Lightweight in-panel initiative tracker for when neither Initiative Tracker plugin nor D&D Beyond are in play. The DM adds combatants by name/init/HP, edits HP per row, advances turns, resets rounds, and clears the list.

## Source files

- `src/views/DmControlPanel.ts` — `renderManualTracker`, `sortManualCombatants`, `advanceManualTurn`, `broadcastManualInitiative`, `manualCombatants`, `currentTurn`, `manualRound`

## Settings used

- `none` (manual state is session-scoped)

## Requirements

1. The manual tracker shall render an Add row with three inputs (name, initiative, HP) and a `+` button.
2. When the `+` button is clicked with a non-empty name, the panel shall push a new combatant `{ name, initiative, hp: input, maxHp: input, active: false, statuses: [] }`, re-sort by initiative DESC, broadcast, and re-render.
3. Each combatant row shall expose: the initiative number, the name, an editable HP input, the maxHP read-only `/ <max>`, and a remove button.
4. When the HP input changes, the panel shall update `combatant.hp` and broadcast.
5. The Next Turn button shall: clear `active` on all combatants; advance `currentTurn` by 1, wrapping to 0 and incrementing `manualRound` on wrap; set the new current combatant `active = true`; broadcast.
6. The Reset Round button shall set `currentTurn = 0`, `manualRound = 1`, mark the first combatant active (if any), and broadcast.
7. The Clear All button shall empty `manualCombatants`, reset `currentTurn` to 0 and `manualRound` to 1, and broadcast an empty `initiative-update`.
8. The manual broadcast shall apply the round-1 reveal rule (see `round-1-reveal.md`).
9. If the Initiative Tracker plugin is installed, the manual tracker shall display a hint `Start an encounter in Initiative Tracker to auto-sync` above the Add row.

## Tests covering this

- `src/__tests__/dm-control-combat.test.ts` — sort order, broadcast wiring (manual mode shares the broadcast pipeline)
- `test/e2e/specs/combat.e2e.ts` — real Obsidian: add combatants through the panel form (sorted `initiative-update`), Next Turn cycling with round advance, scale buttons (`combat-scale`), Clear All empties the tracker

## Non-goals

- Statuses, AC, temp HP in manual mode. Those fields exist on `TrackerCombatant` for the plugin-synced and D&D Beyond sources but the manual entry form does not collect them.
- Statblock display in manual mode. The expand-row affordance is plugin-sync only.
- Persisting manual combatants across plugin reload. Manual state is intentionally session-scoped.
- Reordering by anything other than initiative DESC.
