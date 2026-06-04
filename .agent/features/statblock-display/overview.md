# Statblock Display

> Inline 5e statblock panel rendered in the DM Control Panel under each expanded combatant when initiative is sourced from the Initiative Tracker plugin. Reads from the Fantasy Statblocks community plugin's bestiary. Players never see statblocks.

## Source files

- `src/views/StatblockPanel.ts` — `renderStatblock(container, creature)`, ability-score modifier formatting, sections for traits / actions / reactions / legendary actions / bonus actions / saves / skills / damage resistances / immunities / senses / languages / CR
- `src/types.ts` — `StatblockCreature`, `StatblockAction`
- `src/main.ts` — `lookupStatblock(name, baseName)`, `statblockCache` (positive + negative results cached)
- `src/views/DmControlPanel.ts` — `renderPluginCombatantRow` shows the expand button, mounts the panel when expanded
- `src/global.d.ts` — `window.FantasyStatblocks` augmentation

## Settings used

- `none`

## Requirements

1. The expand button on a plugin-synced combatant row shall toggle `expandedCreature` between the combatant's `name` and `null`, re-rendering the panel each time.
2. While `expandedCreature === combatant.name`, the row's wrapper shall include a `.dm-statblock-container` child mounted via `renderStatblock(container, c.statblock)`.
3. If the combatant has no statblock (lookup returned `null`), the panel shall display the text `Statblock not found in bestiary` in a `.dm-statblock-not-found` div.
4. `lookupStatblock(name, baseName)` shall:
   - Return a cached result immediately if present (positive or negative).
   - Try `window.FantasyStatblocks.getCreatureFromBestiary(name)`.
   - If that misses and `baseName !== name`, try `getCreatureFromBestiary(baseName)`.
   - Cache the result keyed by `name` and return it.
5. `baseName` shall be `name.replace(/\s+\d+$/, "")` so `"Goblin 3"` resolves to `"Goblin"`.
6. `renderStatblock` shall render in the following order: header (name, size/type/alignment subtitle), AC / HP / Speed core row, ability scores grid with modifier in parentheses, saves and skills (if any), damage and condition modifiers (if any), senses and languages (if any), CR (if any), traits, actions, bonus actions, reactions, legendary actions.
7. The ability-score modifier shall be computed as `floor((score - 10) / 2)` and prefixed with `+` for non-negative values.
8. Sections shall be omitted entirely when their data is missing (no empty headings).

## Tests covering this

- `src/__tests__/statblock-panel.test.ts` — every rendered section, ability modifier formatting, fallback for missing data, empty-section omission, polyfilled DOM methods
- `src/__tests__/initiative-tracker-fs-roundtrip.integration.test.ts` — Fantasy Statblocks roundtrip: lookup falls back from `"Goblin 1"` → `"Goblin"`, cache is reused across consecutive Initiative Tracker syncs

## Non-goals

- Editing statblocks. Read-only display.
- Re-fetching when the Fantasy Statblocks bestiary updates mid-session. The cache is session-scoped; negative results stick until reload.
- Manual statblock entry inside the DM panel. Lookups go through Fantasy Statblocks only.
- Pushing statblocks to the player screen.
- Spell descriptions. Spells are listed as references only (Fantasy Statblocks' `spells` field is rendered minimally).
- Statblock expansion in manual mode or D&D Beyond mode. Only Initiative Tracker plugin sync surfaces statblocks (D&D Beyond gives raw HP / initiative only).
