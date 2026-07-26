# Reveal Rule

> Hide combatants whose turn has not yet come in the current round so the players discover the encounter as it unfolds. The rule is forced for manual mode and the Initiative Tracker plugin source; for the D&D Beyond source it is DM-controlled via the `Show full turn order` toggle.

## Source files

- `src/main.ts` — `onInitiativeStateChange` applies the rule for the Initiative Tracker plugin source
- `src/views/DmControlPanel.ts` — `broadcastManualInitiative` applies the rule for manual mode via `applyRound1Reveal`
- `src/combat/tracker.ts` — `applyRound1Reveal` is the pure implementation of the rule
- `src/views/DnDBeyondPanel.ts` — `broadcastToPlayerScreen` applies the rule for D&D Beyond
- `src/main.ts` — `sendInitiativeUpdate` filters `hidden` before broadcasting

## Settings used

- `none`

## Requirements

### Shared

1. Each source shall sort its combatant list by initiative DESC before applying the rule.
2. Let `activeIdx` be the index of the active combatant in the sorted list.
3. `sendInitiativeUpdate` shall filter the combatant array to only include entries with `hidden !== true` before broadcasting.
4. The DM panel itself shall continue to render hidden combatants (with a `[hidden]` badge or, for D&D Beyond, the dimmed `init-hidden` row in the preview) so the DM sees the full picture; only the broadcast is filtered.

### Per-source behaviour

5. **Initiative Tracker plugin (`main.ts onInitiativeStateChange`)**: while `round === 1` and `activeIdx >= 0`, the source shall set `hidden = true` for every combatant at index `> activeIdx`. When `round > 1`, no new hidden flag is added.
6. **Manual mode (`DmControlPanel.broadcastManualInitiative`)**: identical behaviour to req 5.
7. **D&D Beyond (`DnDBeyondPanel.broadcastToPlayerScreen`)**: the panel exposes a `showFullTurnOrder: boolean` field controlling the rule across all rounds.
   - When `showFullTurnOrder === false`, the source shall set `hidden = true` for every combatant at index `> currentTurnIdx`, regardless of round number.
   - When `showFullTurnOrder === true`, the source shall not add any hidden flag.
   - On `selectEncounter`, both `showFullTurnOrder` and `showFullTurnOrderUserSet` are reset to `false`.
   - On the first poll for a new selection, if the DM has not toggled the checkbox (`showFullTurnOrderUserSet === false`) and `roundNum >= 2`, the panel shall auto-set `showFullTurnOrder = true` and sync the checkbox.
   - Once the DM toggles the checkbox manually, the value is sticky: it does NOT auto-flip on subsequent round transitions.

## Tests covering this

- `src/__tests__/main.test.ts` — round-1 reveal applied by `onInitiativeStateChange`, hidden filter in `sendInitiativeUpdate`
- `src/__tests__/ddb-panel-tracking-state.test.ts` — DDB reveal rule with `showFullTurnOrder` toggle, defaults by round, sticky override
- `src/__tests__/dm-control-combat.test.ts` — manual broadcast applies the round-1 rule
- `src/__tests__/combat-tracker.test.ts` — `applyRound1Reveal` hides post-active entries in round 1, reveals all from round 2, no-op with no active combatant, does not mutate inputs
- `test/e2e/specs/combat.e2e.ts` — real Obsidian: during round 1 the wire conceals combatants after the active one and reveals everyone once the round wraps

## Non-goals

- Per-combatant manual override of the hide. The DM cannot mark a specific combatant as "revealed early" — they roll past it by advancing the turn (or toggle `Show full turn order` for D&D Beyond).
- Per-source override beyond D&D Beyond. Manual mode and Initiative Tracker plugin retain the forced round-1 rule.
- Hiding by anything other than position relative to the active combatant.
