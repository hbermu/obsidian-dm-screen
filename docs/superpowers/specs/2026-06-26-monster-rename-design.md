# Ephemeral monster rename (D&D Beyond encounters) — Design

Date: 2026-06-26
Feature scope: `dndbeyond-integration` + `combat-tracker`
Status: approved (brainstorming)

## Problem

When the DM loads a D&D Beyond encounter, several monsters often share a
template name ("Goblin", "Goblin", "Goblin"). The DM wants to give an
individual monster a custom display name **for the duration of the current
combat only** — never written to disk, exactly like the existing ephemeral
condition assignments.

The new name must:

- Appear with the new name on the **player screen** (clean, no marker).
- Appear with the new name on the **DM side** (Obsidian preview), suffixed
  with a `*` so the DM can tell at a glance which monsters were renamed.

## Existing behaviour this builds on

- `DnDBeyondPanel.monsterStatuses: Map<instanceKey, Set<string>>` holds the
  ephemeral DM-assigned conditions, keyed by the per-instance `uniqueId`
  returned by D&D Beyond (fallback `${id}:${name}` via `monsterInstanceKey`).
  Cleared on `selectEncounter` and `stopTracking`.
- A monster row currently fires `addEventListener("click", …)` →
  `openMonsterConditionMenu`, an Obsidian `Menu` with the 14 conditions +
  Exhaustion. The `Menu` closes after every click, so toggling several
  conditions means reopening it repeatedly.
- `buildParticipants` produces `PreviewCombatant[]`; `p.name` flows into both
  `broadcastToPlayerScreen` (→ player screen) and `buildPreviewRow` (→ DM
  preview only). `buildPreviewRow` is **DM-only**; the player renders in
  `src/player/player.ts`.

## Decisions (from brainstorming)

1. **Scope**: D&D Beyond monsters only. Local manual combatants keep their
   current condition menu untouched. (Known inconsistency, possible follow-up.)
2. **Gesture**: right-click (`contextmenu`) on the monster row, replacing the
   current left-click trigger.
3. **Top-level menu**: `Rename…`, `Reset name` (disabled when no override),
   separator, `Conditions…`.
4. **Conditions move from a `Menu` to a modal** with icon + name + checkbox per
   condition and an Exhaustion `<select>` (None / 1..6), so the DM can add and
   remove several at once. Reason the old `Menu` could not do this: Obsidian's
   `Menu` closes on each item click. `setSubmenu` is also unavailable in the
   typings of Obsidian 1.12.3 (only `setSection` / `setIsLabel`), so a real
   hover submenu is not cleanly typeable — a modal is the better fit.
5. **Conditions modal commits atomically** via an explicit `Apply` button: one
   broadcast on apply, `Cancel` discards. (Not live-per-checkbox.)
6. **Reset**: explicit `Reset name` menu item returns to the original DDB name
   and removes the `*`.

## Architecture

### New ephemeral state (twin of `monsterStatuses`)

```ts
private monsterNames = new Map<string, string>(); // instanceKey -> override name
```

- Same `instanceKey` as `monsterStatuses` (`monsterInstanceKey`).
- Cleared in `selectEncounter` and `stopTracking` (alongside `monsterStatuses`).
- Never persisted to disk.

### Name flow in `buildParticipants` (monster branch)

```ts
const key = monsterInstanceKey(p);
const override = this.monsterNames.get(key);
const originalName = p.name;
const displayName = override ?? originalName;
participants.push({
  name: displayName,        // emitted to the player, clean
  originalName,             // DM-side only
  renamed: override != null, // DM-side only
  …
});
```

`PreviewCombatant` gains `originalName: string` and `renamed: boolean`.

### Player screen — unchanged payload shape

`broadcastToPlayerScreen` maps only the existing `Combatant` fields. It does
**not** forward `renamed`/`originalName`. The player therefore receives the new
name with no marker. The `Combatant` broadcast type is unchanged.

### DM preview — the `*` marker

`buildPreviewRow` appends `" *"` to the `.init-name` text (after the PC tag
logic, which never applies to monsters) when `c.renamed === true`. The marker
lives only in the DM preview DOM. Add `title`/tooltip showing the original name
is a nice-to-have, out of scope for the beta.

### Right-click handler

In `renderPreview`, for rows with `p.monsterKey != null`:

```ts
row.classList.add("dm-ddb-preview-row-clickable");
row.addEventListener("contextmenu", (evt) => {
  evt.preventDefault();
  this.openMonsterMenu(key, /* current display name */ p.name, originalName, evt);
});
```

`openMonsterMenu` (renamed/expanded from `openMonsterConditionMenu`) builds the
top-level `Menu`:

- `Rename…` → opens `RenameMonsterModal`.
- `Reset name` → `setDisabled(!this.monsterNames.has(key))`; on click deletes the
  override, re-broadcasts, re-renders.
- separator
- `Conditions…` → opens `MonsterConditionsModal`.

### `RenameMonsterModal` (new — `src/views/RenameMonsterModal.ts`)

`extends Modal`. Text input pre-filled with the current display name. Buttons
`Cancel` / `Save` (mod-cta); Enter submits. On submit:

- trimmed empty → no-op (close).
- trimmed equals `originalName` → delete override (reset; avoids a misleading `*`).
- otherwise → `monsterNames.set(key, trimmed)`.

Calls back into the panel to re-broadcast + re-render. Follows the
`SendToWebhookModal` structure (contentEl, rows, `mod-cta` Save).

### `MonsterConditionsModal` (new — `src/views/MonsterConditionsModal.ts`)

`extends Modal`. Receives the current `Set<string>` (snapshot). Renders:

- 14 condition rows: `CONDITIONS[id].iconSvg` icon + name + checkbox.
- An Exhaustion `<select>`: None / 1..6, pre-selected from the snapshot.
- `Clear all` convenience button (un-checks everything, sets Exhaustion None).
- `Cancel` / `Apply` (mod-cta).

On `Apply`: builds the new `Set<string>` from checkbox state + Exhaustion select
(using `encodeExhaustion`), calls back into the panel which sets/deletes
`monsterStatuses.get(key)`, re-broadcasts once, re-renders. The panel keeps
`setMonsterExhaustion`/`applyMonsterStatusChange` plumbing or a single
`applyMonsterStatuses(key, Set)` entry point.

The old `openMonsterConditionMenu` body (14 toggle items + Exhaustion items) is
deleted — its behaviour moves wholesale into the modal.

## Components & boundaries

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `monsterNames` map | hold ephemeral overrides | — |
| `buildParticipants` | resolve display name, set `renamed`/`originalName` | `monsterNames`, `monsterInstanceKey` |
| `broadcastToPlayerScreen` | emit clean name to player | `buildParticipants` |
| `buildPreviewRow` | render `*` for DM | `PreviewCombatant.renamed` |
| `openMonsterMenu` | top-level right-click menu | both modals, `monsterNames` |
| `RenameMonsterModal` | capture a new name | `Modal` |
| `MonsterConditionsModal` | edit the full condition set atomically | `CONDITIONS`, `encodeExhaustion` |

## Testing

- `buildParticipants`/broadcast: override resolves into `name`; player payload
  carries the new name and **no** `renamed`/`originalName` field.
- DM preview: `*` present when `renamed`, absent otherwise.
- `Reset name` deletes the override; `selectEncounter`/`stopTracking` clear
  `monsterNames`.
- `RenameMonsterModal`: trim, empty = no-op, equals-original = reset.
- `MonsterConditionsModal`: initial checkbox/exhaustion state from snapshot,
  `Apply` returns the union, `Clear all` empties, `Cancel` is a no-op.

Existing tests to update: `ddb-panel-tracking-state.test.ts` (broadcast shape /
statuses now applied via modal entry point), any test asserting the old
left-click condition menu.

## Spec updates (same commit as code)

- `.agent/features/dndbeyond-integration/encounters-and-tracking.md`
  - Req 21: monster `statuses` now edited via `MonsterConditionsModal` (right-click
    → `Conditions…`), applied atomically.
  - New requirement: ephemeral `monsterNames` override — display name resolution,
    player gets the clean name, DM preview gets `*`, cleared on
    `selectEncounter`/`stopTracking`.
- `.agent/features/combat-tracker/overview.md`
  - Req 21/22: right-click menu (`Rename…`, `Reset name`, `Conditions…`) on DDB
    monster rows; conditions modal; ephemeral name override channel. Keep the
    manual-tracker condition path unchanged.

## Non-goals (beta)

- Renaming PCs, manual entries, or Initiative Tracker plugin combatants.
- Persisting overrides across panel close / plugin reload.
- Forwarding the original name or `*` to the player screen.
- Editing names from the player side.

## Beta delivery

Cut a `feature/monster-rename` branch, bump the three version files to the next
`-beta.N`, push; `release.yml` publishes the prerelease for BRAT testing.
