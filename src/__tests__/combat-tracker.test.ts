import { describe, expect, it } from "vitest";
import { sortByInitiative, clampTrackerScale, advanceTurn, applyRound1Reveal } from "../combat/tracker";

describe("sortByInitiative", () => {
  it("sorts descending in place and returns the same array", () => {
    const list = [{ initiative: 5 }, { initiative: 20 }, { initiative: 12 }];
    const out = sortByInitiative(list);
    expect(out).toBe(list);
    expect(list.map((c) => c.initiative)).toEqual([20, 12, 5]);
  });

  it("is a no-op on an empty list", () => {
    expect(sortByInitiative([])).toEqual([]);
  });
});

describe("clampTrackerScale", () => {
  it("bounds to [0.5, 2]", () => {
    expect(clampTrackerScale(0.1)).toBe(0.5);
    expect(clampTrackerScale(9)).toBe(2);
  });

  it("rounds to the nearest tenth", () => {
    expect(clampTrackerScale(1.23)).toBe(1.2);
    expect(clampTrackerScale(1.25)).toBe(1.3);
    expect(clampTrackerScale(1)).toBe(1);
  });
});

describe("advanceTurn", () => {
  it("advances within the round", () => {
    expect(advanceTurn(0, 1, 3)).toEqual({ currentTurn: 1, round: 1 });
  });

  it("wraps to 0 and bumps the round on the last combatant", () => {
    expect(advanceTurn(2, 1, 3)).toEqual({ currentTurn: 0, round: 2 });
  });

  it("is a no-op with no combatants", () => {
    expect(advanceTurn(0, 1, 0)).toEqual({ currentTurn: 0, round: 1 });
  });
});

describe("applyRound1Reveal", () => {
  it("hides combatants after the active one during round 1", () => {
    const list = [{ active: true }, { active: false }, { active: false }];
    const out = applyRound1Reveal(list, 1);
    expect(out.map((c) => c.hidden)).toEqual([false, true, true]);
  });

  it("reveals everyone from round 2 onward", () => {
    const list = [{ active: false }, { active: true }, { active: false }];
    expect(applyRound1Reveal(list, 2).every((c) => !c.hidden)).toBe(true);
  });

  it("hides no one when no combatant is active", () => {
    const list = [{ active: false }, { active: false }];
    expect(applyRound1Reveal(list, 1).every((c) => !c.hidden)).toBe(true);
  });

  it("does not mutate the input entries", () => {
    const list = [{ active: true, name: "a" }];
    applyRound1Reveal(list, 1);
    expect(list[0]).not.toHaveProperty("hidden");
  });
});
