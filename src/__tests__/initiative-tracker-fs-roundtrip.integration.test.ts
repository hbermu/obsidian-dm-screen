import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import type { InitiativeViewState, StatblockCreature, TrackerCombatant } from "../types";

vi.mock("obsidian", async () => {
  const actual = await vi.importActual<typeof import("obsidian")>("obsidian");
  return { ...actual, Notice: vi.fn() };
});

vi.mock("../server", () => ({ PlayerScreenServer: vi.fn() }));
vi.mock("../hydrus/cache", () => ({ HydrusCache: vi.fn() }));
vi.mock("../hydrus/client", () => ({ HydrusClient: vi.fn() }));
vi.mock("../dndbeyond/imageCache", () => ({ DdbImageCache: vi.fn() }));
vi.mock("../debug", () => ({
  initDebug: vi.fn(),
  debug: vi.fn(),
  debugWarn: vi.fn(),
  debugError: vi.fn(),
}));

import DmScreenPlugin from "../main";
import { DmControlPanel } from "../views/DmControlPanel";
import { DEFAULT_SETTINGS } from "../settings";

beforeAll(() => {
  if (!HTMLElement.prototype.addClass) {
    HTMLElement.prototype.addClass = function (cls: string) {
      this.classList.add(cls);
    };
  }
});

function makeFakeServer() {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    broadcast: vi.fn(),
    getConnectedClients: vi.fn(() => []),
    maxClients: 10,
    onClientInfo: null as any,
    onClientCountChanged: null as any,
  };
}

function makePlugin(): DmScreenPlugin {
  const plugin = Object.create(DmScreenPlugin.prototype) as DmScreenPlugin;
  plugin.settings = { ...DEFAULT_SETTINGS } as any;
  plugin.server = null;
  plugin.hydrusCache = null;
  (plugin as any).statblockCache = new Map();
  (plugin as any).app = {
    workspace: {
      getLeavesOfType: vi.fn(() => []),
      on: vi.fn(),
    },
  };
  return plugin;
}

function makePanel(plugin: DmScreenPlugin): DmControlPanel {
  const panel = new DmControlPanel({} as any, plugin);
  (panel as any).render = vi.fn();
  (panel as any).debouncedRender = vi.fn();
  return panel;
}

function wirePanel(plugin: DmScreenPlugin, panel: DmControlPanel) {
  (plugin as any).app.workspace.getLeavesOfType = vi.fn(() => [{ view: panel }]);
}

const baseState: InitiativeViewState = {
  creatures: [
    {
      name: "Aria",
      display: "Aria the Wizard",
      hp: 30, currentHP: 28, currentMaxHP: 30,
      ac: 13, currentAC: 13,
      initiative: 18,
      active: false,
      hidden: false,
      friendly: true,
      player: true,
      status: [],
    },
    {
      name: "Goblin Chief",
      display: "Goblin Chief",
      hp: 22, currentHP: 22, currentMaxHP: 22,
      ac: 15, currentAC: 15,
      initiative: 14,
      active: true,
      hidden: false,
      friendly: false,
      player: false,
      status: ["poisoned"],
    },
    {
      name: "Skeleton 2",
      display: "Skeleton 2",
      hp: 13, currentHP: 13, currentMaxHP: 13,
      ac: 13, currentAC: 13,
      initiative: 8,
      active: false,
      hidden: false,
      friendly: false,
      player: false,
      status: [],
    },
  ],
  state: true,
  name: "Ambush in the Pass",
  round: 1,
};

describe("Initiative Tracker + Fantasy Statblocks roundtrip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).FantasyStatblocks = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("A. happy path: panel state + broadcast carry combatants, statuses, round, statblock", () => {
    const plugin = makePlugin();
    plugin.server = makeFakeServer() as any;
    const panel = makePanel(plugin);
    wirePanel(plugin, panel);

    const goblinStatblock: StatblockCreature = { name: "Goblin Chief", ac: 15, hp: 22 };
    (window as any).FantasyStatblocks = {
      getCreatureFromBestiary: vi.fn((name: string) =>
        name === "Goblin Chief" ? goblinStatblock : undefined
      ),
    };

    (plugin as any).onInitiativeStateChange(baseState);

    expect(panel.trackerSource).toBe("plugin");
    expect(panel.pluginRound).toBe(1);
    expect(panel.encounterName).toBe("Ambush in the Pass");
    expect(panel.pluginCombatants).toHaveLength(3);

    const goblin = panel.pluginCombatants.find((c) => c.name === "Goblin Chief")!;
    expect(goblin.statuses).toEqual(["poisoned"]);
    expect(goblin.statblock).toBe(goblinStatblock);
    expect(goblin.source).toBe("tracker-plugin");
    expect(goblin.isPlayer).toBe(false);
    expect(goblin.hp).toBe(22);

    const aria = panel.pluginCombatants.find((c) => c.name === "Aria")!;
    expect(aria.isPlayer).toBe(true);
    expect(aria.friendly).toBe(true);

    const broadcast = (plugin.server as any).broadcast.mock.calls[0][0];
    expect(broadcast.type).toBe("initiative-update");
    expect(broadcast.payload.round).toBe(1);
    // Round-1 reveal: Skeleton 2 sits after the active Goblin Chief, so
    // sendInitiativeUpdate filters it out of the broadcast even though the
    // panel still holds it in pluginCombatants.
    expect(broadcast.payload.combatants.map((c: any) => c.name)).toEqual([
      "Aria the Wizard",
      "Goblin Chief",
    ]);
    expect(broadcast.payload.combatants[1]).toEqual(
      expect.objectContaining({ name: "Goblin Chief", active: true, statuses: ["poisoned"] })
    );

    expect((plugin as any).statblockCache.get("Goblin Chief")).toBe(goblinStatblock);
  });

  it("B. FS not installed: every combatant.statblock is null, sync still works", () => {
    const plugin = makePlugin();
    plugin.server = makeFakeServer() as any;
    const panel = makePanel(plugin);
    wirePanel(plugin, panel);

    (plugin as any).onInitiativeStateChange(baseState);

    expect(panel.pluginCombatants).toHaveLength(3);
    expect(panel.pluginCombatants.every((c: TrackerCombatant) => c.statblock === null)).toBe(true);
    expect((plugin.server as any).broadcast).toHaveBeenCalledTimes(1);
    expect((plugin.server as any).broadcast.mock.calls[0][0].type).toBe("initiative-update");
  });

  it("C. FS lookup falls back from 'Skeleton 2' to 'Skeleton'", () => {
    const plugin = makePlugin();
    plugin.server = makeFakeServer() as any;
    const panel = makePanel(plugin);
    wirePanel(plugin, panel);

    const skeletonStatblock: StatblockCreature = { name: "Skeleton" };
    const fsLookup = vi.fn((name: string) =>
      name === "Skeleton" ? skeletonStatblock : undefined
    );
    (window as any).FantasyStatblocks = { getCreatureFromBestiary: fsLookup };

    (plugin as any).onInitiativeStateChange(baseState);

    expect(fsLookup).toHaveBeenCalledWith("Skeleton 2");
    expect(fsLookup).toHaveBeenCalledWith("Skeleton");

    const skeleton = panel.pluginCombatants.find((c) => c.name === "Skeleton 2")!;
    expect(skeleton.statblock).toBe(skeletonStatblock);
  });

  it("D. stop-viewing resets panel state and clears expandedCreature", () => {
    const plugin = makePlugin();
    plugin.server = makeFakeServer() as any;
    const panel = makePanel(plugin);
    wirePanel(plugin, panel);

    (plugin as any).onInitiativeStateChange(baseState);
    panel.expandedCreature = "Goblin Chief";
    expect(panel.trackerSource).toBe("plugin");

    (plugin as any).onInitiativeStop();

    expect(panel.trackerSource).toBe("manual");
    expect(panel.pluginCombatants).toEqual([]);
    expect(panel.pluginRound).toBe(0);
    expect(panel.encounterName).toBe("");
    expect(panel.expandedCreature).toBeNull();
    expect((panel as any).render).toHaveBeenCalled();
  });

  it("E. round-2 broadcast carries every combatant (round-1 reveal filter is off)", () => {
    const plugin = makePlugin();
    plugin.server = makeFakeServer() as any;
    const panel = makePanel(plugin);
    wirePanel(plugin, panel);

    const round2: InitiativeViewState = { ...baseState, round: 2 };
    (plugin as any).onInitiativeStateChange(round2);

    expect(panel.pluginRound).toBe(2);
    const broadcast = (plugin.server as any).broadcast.mock.calls[0][0];
    expect(broadcast.type).toBe("initiative-update");
    expect(broadcast.payload.round).toBe(2);
    expect(broadcast.payload.combatants.map((c: any) => c.name)).toEqual([
      "Aria the Wizard",
      "Goblin Chief",
      "Skeleton 2",
    ]);
  });

  it("F. multiple open DM panels each receive the sync", () => {
    const plugin = makePlugin();
    plugin.server = makeFakeServer() as any;
    const panelA = makePanel(plugin);
    const panelB = makePanel(plugin);
    (plugin as any).app.workspace.getLeavesOfType = vi.fn(() => [
      { view: panelA },
      { view: panelB },
    ]);

    (plugin as any).onInitiativeStateChange(baseState);

    for (const panel of [panelA, panelB]) {
      expect(panel.trackerSource).toBe("plugin");
      expect(panel.pluginRound).toBe(1);
      expect(panel.encounterName).toBe("Ambush in the Pass");
      expect(panel.pluginCombatants).toHaveLength(3);
    }
    // sendInitiativeUpdate is invoked once per state change, not per panel.
    expect((plugin.server as any).broadcast).toHaveBeenCalledTimes(1);
  });

  it("G. lookupStatblock caches both hits and misses across syncs", () => {
    const plugin = makePlugin();
    plugin.server = makeFakeServer() as any;
    const panel = makePanel(plugin);
    wirePanel(plugin, panel);

    const goblinStatblock: StatblockCreature = { name: "Goblin Chief", ac: 15, hp: 22 };
    const fsLookup = vi.fn((name: string) =>
      name === "Goblin Chief" ? goblinStatblock : undefined
    );
    (window as any).FantasyStatblocks = { getCreatureFromBestiary: fsLookup };

    (plugin as any).onInitiativeStateChange(baseState);
    const callsAfterFirst = fsLookup.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    // Same state again — every name + baseName should resolve from the cache,
    // not by re-asking Fantasy Statblocks.
    (plugin as any).onInitiativeStateChange(baseState);
    expect(fsLookup.mock.calls.length).toBe(callsAfterFirst);

    const goblin = panel.pluginCombatants.find((c) => c.name === "Goblin Chief")!;
    expect(goblin.statblock).toBe(goblinStatblock);
  });
});
