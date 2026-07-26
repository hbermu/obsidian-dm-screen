// Pure initiative-tracker helpers shared by the manual tracker in
// DmControlPanel. Kept free of DOM and plugin state so they are unit-testable;
// the view holds the mutable arrays and calls these to compute the next state.

// Sorts combatants by initiative descending, in place (callers hold the array
// reference and index into it by turn).
export function sortByInitiative<T extends { initiative: number }>(list: T[]): T[] {
  list.sort((a, b) => b.initiative - a.initiative);
  return list;
}

// The combat-tracker scale is stepped in tenths and bounded to [0.5, 2].
export function clampTrackerScale(value: number): number {
  return Math.max(0.5, Math.min(2, Math.round(value * 10) / 10));
}

// Advances the turn pointer, wrapping to 0 and bumping the round on wrap.
// Returns the next {currentTurn, round}; an empty roster is a no-op.
export function advanceTurn(currentTurn: number, round: number, count: number): {
  currentTurn: number;
  round: number;
} {
  if (count === 0) return { currentTurn, round };
  const next = currentTurn + 1;
  if (next >= count) return { currentTurn: 0, round: round + 1 };
  return { currentTurn: next, round };
}

// Round-1 reveal rule: while round === 1 and someone is active, every combatant
// after the active one is hidden from the broadcast (see
// .agent/features/combat-tracker/round-1-reveal.md). Returns a new array with a
// `hidden` flag on each entry; the input is not mutated.
export function applyRound1Reveal<T extends { active?: boolean }>(
  list: T[],
  round: number,
): (T & { hidden: boolean })[] {
  const isRoundOne = round === 1;
  const activeIdx = list.findIndex((c) => c.active);
  return list.map((c, i) => ({ ...c, hidden: isRoundOne && activeIdx >= 0 && i > activeIdx }));
}
