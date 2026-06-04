import { beforeAll, describe, expect, it, vi } from "vitest";
import { DnDBeyondPanel } from "../views/DnDBeyondPanel";

// Polyfill Obsidian's HTMLElement extensions used in DnDBeyondPanel.render()
beforeAll(() => {
  if (!HTMLElement.prototype.empty) {
    (HTMLElement.prototype as any).empty = function () {
      while (this.firstChild) this.removeChild(this.firstChild);
    };
  }
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
      opts?: { text?: string; cls?: string; attr?: Record<string, string> }
    ) {
      const el = document.createElement(tag);
      if (opts?.cls) el.className = opts.cls;
      if (opts?.text) el.textContent = opts.text;
      if (opts?.attr) for (const [k, v] of Object.entries(opts.attr)) el.setAttribute(k, v);
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
  if (!HTMLElement.prototype.setText) {
    (HTMLElement.prototype as any).setText = function (text: string) {
      this.textContent = text;
    };
  }
});

function makePlugin() {
  return {
    settings: { ddbCobaltSession: "" },
    sendInitiativeUpdate: vi.fn(),
  } as any;
}

function makeState(opts: {
  roundNum: number;
  turnNum: number;
  inProgress?: boolean;
  participants: Array<{ name: string; initiative: number; kind: "player" | "monster"; id?: number; hp?: number; maxHp?: number }>;
}) {
  const players = opts.participants
    .filter((p) => p.kind === "player")
    .map((p) => ({ id: p.id ?? 1, name: p.name, initiative: p.initiative }));
  const monsters = opts.participants
    .filter((p) => p.kind === "monster")
    .map((p, i) => ({
      id: 100 + i,
      name: p.name,
      initiative: p.initiative,
      currentHitPoints: p.hp ?? 10,
      maximumHitPoints: p.maxHp ?? 10,
    }));
  const characters = new Map<number, any>(
    players.map((p) => [p.id, { id: p.id, name: p.name, currentHitPoints: 20, maxHitPoints: 20 }])
  );
  return {
    encounter: {
      id: "e1",
      name: "Test Encounter",
      roundNum: opts.roundNum,
      turnNum: opts.turnNum,
      inProgress: opts.inProgress ?? true,
      players,
      monsters,
      manualEntries: [],
    },
    characters,
  } as any;
}

describe("DnDBeyondPanel tracking state", () => {
  it("isTracking() returns false by default", () => {
    const container = document.createElement("div");
    const panel = new DnDBeyondPanel(makePlugin(), container);
    expect(panel.isTracking()).toBe(false);
  });

  it("isTracking() returns true after a poller and encounter id are set", () => {
    const container = document.createElement("div");
    const panel = new DnDBeyondPanel(makePlugin(), container);
    (panel as any).poller = { stop: vi.fn() };
    (panel as any).selectedEncounterId = "enc-1";
    expect(panel.isTracking()).toBe(true);
  });

  it("isTracking() returns false when only one of poller/encounter is set", () => {
    const container = document.createElement("div");
    const panel = new DnDBeyondPanel(makePlugin(), container);
    (panel as any).poller = { stop: vi.fn() };
    (panel as any).selectedEncounterId = null;
    expect(panel.isTracking()).toBe(false);

    (panel as any).poller = null;
    (panel as any).selectedEncounterId = "enc-1";
    expect(panel.isTracking()).toBe(false);
  });

  it("stopTracking() is callable from outside (public API) and clears tracking state", () => {
    const container = document.createElement("div");
    const plugin = makePlugin();
    const panel = new DnDBeyondPanel(plugin, container);
    const stopSpy = vi.fn();
    (panel as any).poller = { stop: stopSpy };
    (panel as any).selectedEncounterId = "enc-1";
    (panel as any).polledState = { encounter: { name: "x", roundNum: 1 }, characters: new Map() };

    panel.stopTracking();

    expect(stopSpy).toHaveBeenCalledOnce();
    expect((panel as any).poller).toBeNull();
    expect((panel as any).selectedEncounterId).toBeNull();
    expect((panel as any).polledState).toBeNull();
    expect(plugin.sendInitiativeUpdate).toHaveBeenCalledWith([], 0);
    expect(panel.isTracking()).toBe(false);
  });

  it("getActiveEncounterStatus returns id when tracking", () => {
    const container = document.createElement("div");
    const panel = new DnDBeyondPanel(makePlugin(), container);
    (panel as any).poller = { stop: vi.fn() };
    (panel as any).selectedEncounterId = "enc-7";
    (panel as any).polledState = { encounter: { name: "Goblin Ambush", roundNum: 3 }, characters: new Map() };
    expect(panel.getActiveEncounterStatus()).toEqual({ id: "enc-7", name: "Goblin Ambush", roundNum: 3 });
  });
});

describe("DnDBeyondPanel broadcast reveal rule", () => {
  it("hides post-active when showFullTurnOrder=false (round 5, generalisation)", () => {
    const container = document.createElement("div");
    const plugin = makePlugin();
    const panel = new DnDBeyondPanel(plugin, container);
    (panel as any).showFullTurnOrder = false;
    (panel as any).showPcHp = true;
    const state = makeState({
      roundNum: 5,
      turnNum: 2,
      participants: [
        { name: "Fast", initiative: 20, kind: "monster" },
        { name: "Mid", initiative: 15, kind: "monster" },
        { name: "Slow", initiative: 10, kind: "monster" },
      ],
    });
    (panel as any).broadcastToPlayerScreen(state);
    const sent = plugin.sendInitiativeUpdate.mock.calls[0][0];
    expect(sent[0].name).toBe("Fast");
    expect(sent[0].hidden).toBe(false);
    expect(sent[1].name).toBe("Mid");
    expect(sent[1].hidden).toBe(false);
    expect(sent[2].name).toBe("Slow");
    expect(sent[2].hidden).toBe(true);
  });

  it("reveals everyone when showFullTurnOrder=true (round 1)", () => {
    const container = document.createElement("div");
    const plugin = makePlugin();
    const panel = new DnDBeyondPanel(plugin, container);
    (panel as any).showFullTurnOrder = true;
    (panel as any).showPcHp = true;
    const state = makeState({
      roundNum: 1,
      turnNum: 1,
      participants: [
        { name: "A", initiative: 20, kind: "monster" },
        { name: "B", initiative: 15, kind: "monster" },
        { name: "C", initiative: 10, kind: "monster" },
      ],
    });
    (panel as any).broadcastToPlayerScreen(state);
    const sent = plugin.sendInitiativeUpdate.mock.calls[0][0];
    expect(sent.every((c: any) => c.hidden === false)).toBe(true);
  });

  it("auto-enables showFullTurnOrder on first poll when roundNum >= 2", () => {
    const container = document.createElement("div");
    const panel = new DnDBeyondPanel(makePlugin(), container);
    expect((panel as any).showFullTurnOrder).toBe(false);
    const state = makeState({
      roundNum: 3,
      turnNum: 1,
      participants: [{ name: "A", initiative: 10, kind: "monster" }],
    });
    (panel as any).onPollUpdate(state);
    expect((panel as any).showFullTurnOrder).toBe(true);
    expect((panel as any).showFullTurnOrderUserSet).toBe(false);
  });

  it("does NOT auto-enable on first poll when roundNum == 1", () => {
    const container = document.createElement("div");
    const panel = new DnDBeyondPanel(makePlugin(), container);
    const state = makeState({
      roundNum: 1,
      turnNum: 1,
      participants: [{ name: "A", initiative: 10, kind: "monster" }],
    });
    (panel as any).onPollUpdate(state);
    expect((panel as any).showFullTurnOrder).toBe(false);
  });

  it("respects DM override after manual toggle (sticky across polls)", () => {
    const container = document.createElement("div");
    const panel = new DnDBeyondPanel(makePlugin(), container);
    (panel as any).showFullTurnOrderUserSet = true;
    (panel as any).showFullTurnOrder = false;
    const state2 = makeState({
      roundNum: 2,
      turnNum: 1,
      participants: [{ name: "A", initiative: 10, kind: "monster" }],
    });
    (panel as any).onPollUpdate(state2);
    expect((panel as any).showFullTurnOrder).toBe(false);
    const state3 = makeState({
      roundNum: 3,
      turnNum: 1,
      participants: [{ name: "A", initiative: 10, kind: "monster" }],
    });
    (panel as any).onPollUpdate(state3);
    expect((panel as any).showFullTurnOrder).toBe(false);
  });
});
