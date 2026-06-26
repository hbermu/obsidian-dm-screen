import { beforeAll, describe, expect, it, vi } from "vitest";
import { DnDBeyondPanel } from "../views/DnDBeyondPanel";

beforeAll(() => {
  if (!HTMLElement.prototype.empty) {
    (HTMLElement.prototype as any).empty = function () {
      while (this.firstChild) this.removeChild(this.firstChild);
    };
  }
  if (!HTMLElement.prototype.addClass) {
    HTMLElement.prototype.addClass = function (cls: string) { this.classList.add(cls); };
  }
  if (!HTMLElement.prototype.createDiv) {
    (HTMLElement.prototype as any).createDiv = function (arg?: string | { cls?: string; text?: string }) {
      const div = document.createElement("div");
      if (typeof arg === "string") div.className = arg;
      else if (arg) { if (arg.cls) div.className = arg.cls; if (arg.text) div.textContent = arg.text; }
      this.appendChild(div);
      return div;
    };
  }
  if (!HTMLElement.prototype.createEl) {
    (HTMLElement.prototype as any).createEl = function (tag: string, opts?: { type?: string; text?: string; cls?: string; attr?: Record<string, string> }) {
      const el = document.createElement(tag);
      if (opts?.type) (el as HTMLInputElement).type = opts.type;
      if (opts?.cls) el.className = opts.cls;
      if (opts?.text) el.textContent = opts.text;
      if (opts?.attr) for (const [k, v] of Object.entries(opts.attr)) el.setAttribute(k, v);
      this.appendChild(el);
      return el;
    };
  }
  if (!HTMLElement.prototype.createSpan) {
    (HTMLElement.prototype as any).createSpan = function (opts?: { text?: string; cls?: string }) {
      const el = document.createElement("span");
      if (opts?.cls) el.className = opts.cls;
      if (opts?.text) el.textContent = opts.text;
      this.appendChild(el);
      return el;
    };
  }
  if (!HTMLElement.prototype.setText) {
    (HTMLElement.prototype as any).setText = function (text: string) { this.textContent = text; };
  }
});

function makePlugin() {
  return { settings: { ddbCobaltSession: "" }, sendInitiativeUpdate: vi.fn() } as any;
}

function makeState(participants: Array<{ name: string; initiative: number }>) {
  const monsters = participants.map((p, i) => ({
    id: 100 + i, name: p.name, initiative: p.initiative,
    currentHitPoints: 10, maximumHitPoints: 10, uniqueId: `monster-uid-${i}`,
  }));
  return {
    encounter: {
      id: "e1", name: "Test Encounter", roundNum: 1, turnNum: 1, inProgress: true,
      players: [], monsters, manualEntries: [],
    },
    characters: new Map(),
  } as any;
}

describe("DnDBeyondPanel monsterNames", () => {
  it("broadcasts the override name, clean (no renamed/originalName fields)", () => {
    const plugin = makePlugin();
    const panel = new DnDBeyondPanel(plugin, document.createElement("div"));
    (panel as any).showFullTurnOrder = true;
    const state = makeState([{ name: "Goblin", initiative: 12 }]);
    (panel as any).monsterNames.set("monster-uid-0", "Sneaky Pete");
    (panel as any).broadcastToPlayerScreen(state);
    const sent = plugin.sendInitiativeUpdate.mock.calls[0][0];
    expect(sent[0].name).toBe("Sneaky Pete");
    expect(sent[0]).not.toHaveProperty("renamed");
    expect(sent[0]).not.toHaveProperty("originalName");
  });

  it("keeps overrides per-instance for duplicate template ids", () => {
    const plugin = makePlugin();
    const panel = new DnDBeyondPanel(plugin, document.createElement("div"));
    (panel as any).showFullTurnOrder = true;
    const state = makeState([
      { name: "Goblin (A)", initiative: 12 },
      { name: "Goblin (B)", initiative: 11 },
    ]);
    (panel as any).monsterNames.set("monster-uid-0", "Boss");
    (panel as any).broadcastToPlayerScreen(state);
    const sent = plugin.sendInitiativeUpdate.mock.calls[0][0];
    expect(sent[0].name).toBe("Boss");
    expect(sent[1].name).toBe("Goblin (B)");
  });

  it("buildParticipants marks renamed and keeps originalName", () => {
    const panel = new DnDBeyondPanel(makePlugin(), document.createElement("div"));
    (panel as any).showFullTurnOrder = true;
    const state = makeState([{ name: "Goblin", initiative: 12 }]);
    (panel as any).monsterNames.set("monster-uid-0", "Pete");
    const { participants } = (panel as any).buildParticipants(state);
    expect(participants[0].name).toBe("Pete");
    expect(participants[0].originalName).toBe("Goblin");
    expect(participants[0].renamed).toBe(true);
  });

  it("applyMonsterName: empty is a no-op, equal-to-original resets, else sets", () => {
    const plugin = makePlugin();
    const panel = new DnDBeyondPanel(plugin, document.createElement("div"));
    (panel as any).showFullTurnOrder = true;
    (panel as any).polledState = makeState([{ name: "Goblin", initiative: 12 }]);

    (panel as any).applyMonsterName("monster-uid-0", "   ");
    expect((panel as any).monsterNames.has("monster-uid-0")).toBe(false);

    (panel as any).applyMonsterName("monster-uid-0", "Pete");
    expect((panel as any).monsterNames.get("monster-uid-0")).toBe("Pete");

    (panel as any).applyMonsterName("monster-uid-0", "Goblin");
    expect((panel as any).monsterNames.has("monster-uid-0")).toBe(false);
  });

  it("resetMonsterName deletes the override and re-broadcasts", () => {
    const plugin = makePlugin();
    const panel = new DnDBeyondPanel(plugin, document.createElement("div"));
    (panel as any).showFullTurnOrder = true;
    (panel as any).polledState = makeState([{ name: "Goblin", initiative: 12 }]);
    (panel as any).monsterNames.set("monster-uid-0", "Pete");
    (panel as any).resetMonsterName("monster-uid-0");
    expect((panel as any).monsterNames.has("monster-uid-0")).toBe(false);
    expect(plugin.sendInitiativeUpdate).toHaveBeenCalled();
  });

  it("stopTracking clears monsterNames", () => {
    const panel = new DnDBeyondPanel(makePlugin(), document.createElement("div"));
    (panel as any).poller = { stop: vi.fn() };
    (panel as any).selectedEncounterId = "enc-1";
    (panel as any).monsterNames.set("monster-uid-0", "Pete");
    panel.stopTracking();
    expect((panel as any).monsterNames.size).toBe(0);
  });
});

describe("DM preview rename marker", () => {
  function renderRow(panel: any, key: string, name: string, renamed: boolean): HTMLElement {
    panel.previewEl = document.createElement("div");
    panel.previewEl.createEl("ul", { cls: "dm-ddb-preview-list" });
    panel.polledState = makeState([{ name, initiative: 12 }]);
    if (renamed) panel.monsterNames.set(key, name);
    panel.showFullTurnOrder = true;
    panel.renderPreview();
    return panel.previewEl.querySelector(".init-name") as HTMLElement;
  }

  it("prefixes a renamed monster with '* '", () => {
    const panel = new DnDBeyondPanel(makePlugin(), document.createElement("div")) as any;
    const nameEl = renderRow(panel, "monster-uid-0", "Sneaky Pete", true);
    expect(nameEl.textContent?.startsWith("* ")).toBe(true);
    expect(nameEl.textContent).toContain("Sneaky Pete");
  });

  it("does not prefix a non-renamed monster", () => {
    const panel = new DnDBeyondPanel(makePlugin(), document.createElement("div")) as any;
    const nameEl = renderRow(panel, "monster-uid-0", "Goblin", false);
    expect(nameEl.textContent?.startsWith("*")).toBe(false);
  });
});
