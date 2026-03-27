# Plan: Initiative Tracker Integration + Statblock Display

## Goal
Extend the DM Control Panel to sync with Javalent's Initiative Tracker plugin and display Fantasy Statblocks data for each creature in combat.

## Phase 1: Type Definitions
**New file: `src/types.ts`**
- `CreatureState` — mirrors Javalent's creature data (name, HP, AC, initiative, statuses, hidden, friendly, etc.)
- `InitiativeViewState` — full encounter state (creatures[], round, name, active)
- `StatblockCreature` — Fantasy Statblocks bestiary data (stats, traits, actions, legendary actions, etc.)
- `TrackerCombatant` — unified internal model combining initiative + resolved statblock
- Window type augmentations for `window.InitiativeTracker` and `window.FantasyStatblocks`

## Phase 2: Event Wiring in `main.ts`
Listen to Initiative Tracker workspace events:
- `initiative-tracker:save-state` — fires on every state change. Forward to DmControlPanel + broadcast to player screen.
- `initiative-tracker:stop-viewing` — combat ended, revert to idle
- `initiative-tracker:unloaded` — cleanup

Pattern: `this.app.workspace.on("initiative-tracker:save-state" as any, ...)`

## Phase 3: DmControlPanel Refactor — Dual Mode

### Plugin mode (auto-activates when Initiative Tracker events arrive)
- "Synced with Initiative Tracker — Round N" indicator
- Combatant list from live event data
- HP/AC read-only (managed in Initiative Tracker)
- Turn controls hidden
- **Expand button per creature** → shows statblock panel inline
- "Disconnect" button to revert to manual

### Manual mode (fallback, existing behavior)
- Existing add/edit combatant form
- Hint "Start an encounter in Initiative Tracker to auto-sync" if plugin detected

### Statblock resolution
- `window.FantasyStatblocks.getCreatureFromBestiary(name)`
- Handle "Goblin 1" → strip trailing number → look up "Goblin"
- Cache results in `Map<string, StatblockCreature>`
- Clear cache on combat end

## Phase 4: Statblock Panel
**New file: `src/views/StatblockPanel.ts`**

Compact 5e statblock renderer for DM sidebar:
- Header (name, size/type, CR)
- AC, HP, Speed
- Ability scores row (STR/DEX/CON/INT/WIS/CHA with modifiers)
- Saving throws, skills
- Resistances/immunities/vulnerabilities
- Traits, Actions, Reactions, Legendary Actions

Shown inline when combatant row is expanded. DM-only (not on player screen).

## Phase 5: Player Screen Updates
Update `player.ts` to handle enriched payload:
- Round number ("Initiative — Round 3")
- Players/friendly vs enemies styled differently (blue vs red)
- Status effect badges
- Hidden creatures filtered out server-side
- Optional: hide enemy HP numbers (show bar only)

## Phase 6: Settings & Polish
New settings:
- `showEnemyHpOnPlayerScreen` (default: false)
- `autoSyncInitiative` (default: true)
- `statblockDefaultExpanded` (default: false)

CSS for statblock panel, status badges, hidden/friendly styling, source indicator.

## Key Design Decisions
- Graceful degradation: works without Initiative Tracker (manual mode) and without Fantasy Statblocks ("not found")
- Name matching: exact → strip trailing numbers → try display name
- Debounce renders (100ms) since save-state fires frequently
- Statblock cache cleared on combat end

## Build Order
Phase 1 → 2 → 3+4 (parallel) → 5 → 6
