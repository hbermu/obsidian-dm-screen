import { beforeAll, describe, expect, it, vi } from "vitest";
import { DmControlPanel } from "../views/DmControlPanel";

beforeAll(() => {
  // Polyfill the few HTMLElement extensions used by DmControlPanel render paths
  // (not strictly needed for these tests since we don't call render(), but keep
  // for safety in case test logic touches the DOM).
  if (!HTMLElement.prototype.addClass) {
    HTMLElement.prototype.addClass = function (cls: string) {
      this.classList.add(cls);
    };
  }
});

function makePlugin(overrides: Record<string, unknown> = {}) {
  return {
    settings: {
      ddbEnabled: false,
      ddbCobaltSession: "",
      combatTrackerScale: 1,
      ...((overrides.settings as object) ?? {}),
    },
    server: null,
    sendInitiativeUpdate: vi.fn(),
    saveSettings: vi.fn(async () => {}),
    app: { workspace: { getLeavesOfType: () => [] } },
    ...overrides,
  } as any;
}

function makePanel(plugin = makePlugin()): DmControlPanel {
  // Bypass ItemView constructor: stub `obsidian` provides empty ItemView, so
  // calling `super(leaf)` is a no-op and `leaf` is never accessed.
  const panel = new DmControlPanel({} as any, plugin);
  // Stop debouncedRender / render from touching the DOM during tests.
  (panel as any).render = vi.fn();
  (panel as any).debouncedRender = vi.fn();
  return panel;
}

describe("DmControlPanel.isCombatBroadcasting", () => {
  it("returns false when there are no combatants and no DDB tracking", () => {
    const panel = makePanel();
    expect(panel.isCombatBroadcasting()).toBe(false);
  });

  it("returns true when manualCombatants has entries", () => {
    const panel = makePanel();
    panel.manualCombatants.push({
      name: "Goblin",
      hp: 5,
      maxHp: 7,
      initiative: 12,
      active: true,
    });
    expect(panel.isCombatBroadcasting()).toBe(true);
  });

  it("returns true when trackerSource is plugin and pluginCombatants has entries", () => {
    const panel = makePanel();
    panel.trackerSource = "plugin";
    panel.pluginCombatants = [{ name: "Hero" } as any];
    expect(panel.isCombatBroadcasting()).toBe(true);
  });

  it("returns false when trackerSource is plugin but pluginCombatants is empty", () => {
    const panel = makePanel();
    panel.trackerSource = "plugin";
    panel.pluginCombatants = [];
    expect(panel.isCombatBroadcasting()).toBe(false);
  });

  it("returns true when ddbPanel.isTracking() is true", () => {
    const panel = makePanel();
    (panel as any).ddbPanel = { isTracking: () => true };
    expect(panel.isCombatBroadcasting()).toBe(true);
  });

  it("returns false when ddbPanel exists but isTracking() is false", () => {
    const panel = makePanel();
    (panel as any).ddbPanel = { isTracking: () => false };
    expect(panel.isCombatBroadcasting()).toBe(false);
  });
});

describe("DmControlPanel.stopAllCombatBroadcast", () => {
  it("clears manual combatants and resets currentTurn", () => {
    const panel = makePanel();
    panel.manualCombatants.push({
      name: "Goblin",
      hp: 5,
      maxHp: 7,
      initiative: 12,
      active: true,
    });
    panel.currentTurn = 3;

    panel.stopAllCombatBroadcast();

    expect(panel.manualCombatants).toEqual([]);
    expect(panel.currentTurn).toBe(0);
  });

  it("resets plugin tracker state", () => {
    const panel = makePanel();
    panel.trackerSource = "plugin";
    panel.pluginCombatants = [{ name: "Hero" } as any];
    panel.pluginRound = 5;
    panel.encounterName = "Big Fight";

    panel.stopAllCombatBroadcast();

    expect(panel.trackerSource).toBe("manual");
    expect(panel.pluginCombatants).toEqual([]);
    expect(panel.pluginRound).toBe(0);
    expect(panel.encounterName).toBe("");
  });

  it("calls ddbPanel.stopTracking() when ddbPanel exists", () => {
    const panel = makePanel();
    const stopSpy = vi.fn();
    (panel as any).ddbPanel = { stopTracking: stopSpy, isTracking: () => true };

    panel.stopAllCombatBroadcast();

    expect(stopSpy).toHaveBeenCalledOnce();
  });

  it("emits an empty initiative update exactly once", () => {
    const plugin = makePlugin();
    const panel = makePanel(plugin);
    panel.manualCombatants.push({
      name: "Goblin",
      hp: 5,
      maxHp: 7,
      initiative: 12,
      active: false,
    });

    panel.stopAllCombatBroadcast();

    expect(plugin.sendInitiativeUpdate).toHaveBeenCalledTimes(1);
    expect(plugin.sendInitiativeUpdate).toHaveBeenCalledWith([], 0);
  });
});

describe("DmControlPanel.addImageLayer dedup", () => {
  it("does not add a layer with a duplicate label (case-insensitive)", () => {
    const panel = makePanel();
    panel.imageLayers = [
      {
        id: "l1",
        label: "Adult Red Dragon",
        dataUrl: "data:image/png;base64,X",
        x: 0, y: 0, width: 30, height: 60, zIndex: 1,
        rotation: 0, visible: true, fogEnabled: false, fogDataUrl: "", bordered: true,
      } as any,
    ];

    panel.addImageLayer("adult red dragon", "data:image/png;base64,Y", "monster", false);

    expect(panel.imageLayers.length).toBe(1);
    expect(panel.imageLayers[0].dataUrl).toBe("data:image/png;base64,X");
  });
});

describe("DmControlPanel.broadcastManualInitiative round-1 hide", () => {
  it("hides combatants past the active turn during round 1", () => {
    const plugin = makePlugin();
    const panel = makePanel(plugin);
    panel.manualRound = 1;
    panel.manualCombatants = [
      { name: "A", hp: 10, maxHp: 10, initiative: 20, active: false },
      { name: "B", hp: 10, maxHp: 10, initiative: 15, active: true },
      { name: "C", hp: 10, maxHp: 10, initiative: 10, active: false },
    ];

    (panel as any).broadcastManualInitiative();

    expect(plugin.sendInitiativeUpdate).toHaveBeenCalledTimes(1);
    const [combatants, round] = (plugin.sendInitiativeUpdate as any).mock.calls[0];
    expect(round).toBe(1);
    expect(combatants.map((c: any) => c.hidden)).toEqual([false, false, true]);
  });

  it("does not hide anyone after round 1", () => {
    const plugin = makePlugin();
    const panel = makePanel(plugin);
    panel.manualRound = 2;
    panel.manualCombatants = [
      { name: "A", hp: 10, maxHp: 10, initiative: 20, active: false },
      { name: "B", hp: 10, maxHp: 10, initiative: 15, active: true },
      { name: "C", hp: 10, maxHp: 10, initiative: 10, active: false },
    ];

    (panel as any).broadcastManualInitiative();

    const [combatants] = (plugin.sendInitiativeUpdate as any).mock.calls[0];
    expect(combatants.every((c: any) => c.hidden === false)).toBe(true);
  });
});
