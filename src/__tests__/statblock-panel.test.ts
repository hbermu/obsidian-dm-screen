import { beforeAll, describe, expect, it } from "vitest";
import { renderStatblock } from "../views/StatblockPanel";
import type { StatblockCreature } from "../types";

// Obsidian extends HTMLElement prototype with helper methods. Polyfill them.
beforeAll(() => {
  if (!HTMLElement.prototype.addClass) {
    HTMLElement.prototype.addClass = function (cls: string) {
      this.classList.add(cls);
    };
  }
  if (!HTMLElement.prototype.createDiv) {
    (HTMLElement.prototype as any).createDiv = function (
      arg?: string | { cls?: string; text?: string }
    ) {
      const div = document.createElement("div");
      if (typeof arg === "string") {
        div.className = arg;
      } else if (arg) {
        if (arg.cls) div.className = arg.cls;
        if (arg.text) div.textContent = arg.text;
      }
      this.appendChild(div);
      return div;
    };
  }
  if (!HTMLElement.prototype.createEl) {
    (HTMLElement.prototype as any).createEl = function (
      tag: string,
      opts?: { text?: string; cls?: string }
    ) {
      const el = document.createElement(tag);
      if (opts?.cls) el.className = opts.cls;
      if (opts?.text) el.textContent = opts.text;
      this.appendChild(el);
      return el;
    };
  }
  if (!HTMLElement.prototype.createSpan) {
    (HTMLElement.prototype as any).createSpan = function (
      opts?: { text?: string; cls?: string }
    ) {
      const el = document.createElement("span");
      if (opts?.cls) el.className = opts.cls;
      if (opts?.text) el.textContent = opts.text;
      this.appendChild(el);
      return el;
    };
  }
});

function makeContainer(): HTMLElement {
  return document.createElement("div");
}

function minCreature(overrides: Partial<StatblockCreature> = {}): StatblockCreature {
  return {
    name: "Goblin",
    ...overrides,
  };
}

describe("renderStatblock", () => {
  it("renders the creature name", () => {
    const el = makeContainer();
    renderStatblock(el, minCreature());
    expect(el.querySelector(".dm-sb-name")?.textContent).toBe("Goblin");
  });

  it("renders size, type, subtype, and alignment in subtitle", () => {
    const el = makeContainer();
    renderStatblock(el, minCreature({
      size: "Small",
      type: "humanoid",
      subtype: "goblinoid",
      alignment: "neutral evil",
    }));
    const subtitle = el.querySelector(".dm-sb-subtitle");
    expect(subtitle?.textContent).toBe("Small, humanoid (goblinoid), neutral evil");
  });

  it("renders AC, HP with hit dice, and speed", () => {
    const el = makeContainer();
    renderStatblock(el, minCreature({
      ac: 15,
      hp: 45,
      hit_dice: "6d8+12",
      speed: "30 ft.",
    }));
    const core = el.querySelector(".dm-sb-core")!;
    const stats = core.querySelectorAll(".dm-sb-stat");
    expect(stats[0]?.innerHTML).toContain("15");
    expect(stats[1]?.innerHTML).toContain("45");
    expect(stats[1]?.innerHTML).toContain("6d8+12");
    expect(stats[2]?.innerHTML).toContain("30 ft.");
  });

  it("renders ability scores with modifiers", () => {
    const el = makeContainer();
    renderStatblock(el, minCreature({
      stats: [10, 14, 8, 20, 12, 6],
    }));
    const abilities = el.querySelectorAll(".dm-sb-ability");
    expect(abilities).toHaveLength(6);
    expect(abilities[0]?.querySelector(".dm-sb-ability-label")?.textContent).toBe("STR");
    expect(abilities[0]?.querySelector(".dm-sb-ability-score")?.textContent).toBe("10 (+0)");
    expect(abilities[1]?.querySelector(".dm-sb-ability-score")?.textContent).toBe("14 (+2)");
    expect(abilities[2]?.querySelector(".dm-sb-ability-score")?.textContent).toBe("8 (-1)");
    expect(abilities[3]?.querySelector(".dm-sb-ability-score")?.textContent).toBe("20 (+5)");
    expect(abilities[5]?.querySelector(".dm-sb-ability-score")?.textContent).toBe("6 (-2)");
  });

  it("renders saving throws from object format", () => {
    const el = makeContainer();
    renderStatblock(el, minCreature({
      saves: { Dex: 5, Con: 3 },
    }));
    const props = el.querySelector(".dm-sb-props")!;
    expect(props.innerHTML).toContain("Saving Throws");
    expect(props.innerHTML).toContain("Dex +5");
    expect(props.innerHTML).toContain("Con +3");
  });

  it("renders saving throws from array format", () => {
    const el = makeContainer();
    renderStatblock(el, minCreature({
      saves: [{ Str: 6 }, { Con: -1 }],
    }));
    const props = el.querySelector(".dm-sb-props")!;
    expect(props.innerHTML).toContain("Str +6");
    expect(props.innerHTML).toContain("Con -1");
  });

  it("renders skills from object format", () => {
    const el = makeContainer();
    renderStatblock(el, minCreature({
      skillsaves: { Stealth: 6, Perception: 3 },
    }));
    const props = el.querySelector(".dm-sb-props")!;
    expect(props.innerHTML).toContain("Skills");
    expect(props.innerHTML).toContain("Stealth +6");
  });

  it("renders damage properties", () => {
    const el = makeContainer();
    renderStatblock(el, minCreature({
      damage_vulnerabilities: "fire",
      damage_resistances: "cold, lightning",
      damage_immunities: "poison",
      condition_immunities: "poisoned, charmed",
    }));
    const props = el.querySelector(".dm-sb-props")!;
    expect(props.innerHTML).toContain("Vulnerabilities");
    expect(props.innerHTML).toContain("fire");
    expect(props.innerHTML).toContain("Resistances");
    expect(props.innerHTML).toContain("cold, lightning");
    expect(props.innerHTML).toContain("Damage Immunities");
    expect(props.innerHTML).toContain("poison");
    expect(props.innerHTML).toContain("Condition Immunities");
    expect(props.innerHTML).toContain("poisoned, charmed");
  });

  it("renders senses, languages, and CR", () => {
    const el = makeContainer();
    renderStatblock(el, minCreature({
      senses: "darkvision 60 ft., passive Perception 14",
      languages: "Common, Goblin",
      cr: "1/4",
    }));
    const props = el.querySelector(".dm-sb-props")!;
    expect(props.innerHTML).toContain("darkvision 60 ft.");
    expect(props.innerHTML).toContain("Common, Goblin");
    expect(props.innerHTML).toContain("1/4");
  });

  it("renders traits, actions, reactions, and legendary actions", () => {
    const el = makeContainer();
    renderStatblock(el, minCreature({
      traits: [{ name: "Nimble Escape", desc: "Disengage or Hide as a bonus action." }],
      actions: [{ name: "Scimitar", desc: "Melee: +4, 1d6+2 slashing." }],
      reactions: [{ name: "Parry", desc: "+2 AC against one attack." }],
      legendary_actions: [{ name: "Detect", desc: "Makes a Perception check." }],
    }));
    const sections = el.querySelectorAll(".dm-sb-section-title");
    const titles = [...sections].map(s => s.textContent);
    expect(titles).toContain("Traits");
    expect(titles).toContain("Actions");
    expect(titles).toContain("Reactions");
    expect(titles).toContain("Legendary Actions");
    expect(el.innerHTML).toContain("Nimble Escape");
    expect(el.innerHTML).toContain("Scimitar");
  });

  it("renders bonus actions", () => {
    const el = makeContainer();
    renderStatblock(el, minCreature({
      bonus_actions: [{ name: "Cunning Action", desc: "Dash, Disengage, or Hide." }],
    }));
    const sections = el.querySelectorAll(".dm-sb-section-title");
    const titles = [...sections].map(s => s.textContent);
    expect(titles).toContain("Bonus Actions");
  });

  it("omits subtitle when no size/type/alignment", () => {
    const el = makeContainer();
    renderStatblock(el, minCreature());
    expect(el.querySelector(".dm-sb-subtitle")).toBeNull();
  });

  it("omits abilities section when stats is not length 6", () => {
    const el = makeContainer();
    renderStatblock(el, minCreature({ stats: [10, 12] }));
    expect(el.querySelectorAll(".dm-sb-ability")).toHaveLength(0);
  });
});
