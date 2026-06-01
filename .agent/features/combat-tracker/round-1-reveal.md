# Round-1 Reveal Rule

> The single rule shared by every initiative source: in round 1, combatants whose turn has not yet come are hidden from the player screen, so the players discover the encounter as it unfolds.

## Source files

- `src/main.ts` — `onInitiativeStateChange` applies the rule for the Initiative Tracker plugin source
- `src/views/DmControlPanel.ts` — `broadcastManualInitiative` applies the rule for manual mode
- `src/views/DnDBeyondPanel.ts` — `broadcastToPlayerScreen` applies the rule for D&D Beyond
- `src/main.ts` — `sendInitiativeUpdate` filters `hidden` before broadcasting

## Settings used

- `none`

## Requirements

1. Each source shall sort its combatant list by initiative DESC before applying the rule.
2. Let `activeIdx` be the index of the active combatant in the sorted list. Let `isRoundOne` be `round === 1`.
3. While `isRoundOne` and `activeIdx >= 0`, the source shall set `hidden = true` for every combatant at index `> activeIdx` (preserving any pre-existing `hidden` for combatants at earlier indices).
4. When `round > 1`, the source shall NOT add any hidden flag from this rule (existing `hidden` from upstream metadata still applies).
5. `sendInitiativeUpdate` shall filter the combatant array to only include entries with `hidden !== true` before broadcasting.
6. The DM panel itself shall continue to render hidden combatants (with a `[hidden]` badge) so the DM sees the full picture; only the broadcast is filtered.

## Tests covering this

- `src/__tests__/main.test.ts` — the round-1 reveal rule applied by `onInitiativeStateChange`, hidden filter in `sendInitiativeUpdate`
- `src/__tests__/ddb-panel-tracking-state.test.ts` — the same rule applied by the D&D Beyond panel
- `src/__tests__/dm-control-combat.test.ts` — manual broadcast applies the rule

## Non-goals

- Configurable round-1 reveal (it is always on).
- Per-combatant manual override of the round-1 hide. The DM cannot mark a specific combatant as "revealed early" — they roll past it by advancing the turn.
- Hiding by anything other than position relative to the active combatant in round 1.
