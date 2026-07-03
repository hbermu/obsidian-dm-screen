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
    broadcastMapCalibration: vi.fn(),
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
      statuses: [],
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
      statuses: [],
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
      statuses: [],
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

describe("DmControlPanel.restoreState rebroadcast", () => {
  function makeServerStub() {
    const broadcasts: any[] = [];
    return {
      lastState: new Map<string, string>(),
      broadcast: vi.fn((msg: any) => {
        broadcasts.push(msg);
      }),
      _broadcasts: broadcasts,
    };
  }

  it("re-broadcasts image-layers-sync after restoring layers when the server is running", () => {
    const layers = [
      {
        id: "l1", label: "Goblin", dataUrl: "data:image/png;base64,X",
        x: 10, y: 20, width: 30, height: 40, zIndex: 1,
        rotation: 0, visible: true, fogEnabled: false, fogDataUrl: "", bordered: true,
      },
    ];
    const serverStub = makeServerStub();
    const plugin = makePlugin({
      settings: {
        lastImageLayers: JSON.stringify(layers),
        lastBroadcastCache: {},
        lastPlayerScreenWidth: 0,
        lastPlayerScreenHeight: 0,
      },
      server: serverStub as any,
    });
    const panel = makePanel(plugin);

    (panel as any).restoreState();

    expect(serverStub.broadcast).toHaveBeenCalledTimes(2);
    const [msg] = serverStub.broadcast.mock.calls[0];
    expect(msg.type).toBe("image-layers-sync");
    expect(msg.payload.layers).toEqual(layers);
    expect(serverStub.broadcast.mock.calls[1][0].type).toBe("image-layers-geometry");
  });

  it("does not broadcast when there are no restored layers", () => {
    const serverStub = makeServerStub();
    const plugin = makePlugin({
      settings: {
        lastImageLayers: "[]",
        lastBroadcastCache: {},
        lastPlayerScreenWidth: 0,
        lastPlayerScreenHeight: 0,
      },
      server: serverStub as any,
    });
    const panel = makePanel(plugin);

    (panel as any).restoreState();

    expect(serverStub.broadcast).not.toHaveBeenCalled();
  });

  it("does not broadcast when the server is not running", () => {
    const plugin = makePlugin({
      settings: {
        lastImageLayers: JSON.stringify([
          {
            id: "l1", label: "Goblin", dataUrl: "data:image/png;base64,X",
            x: 0, y: 0, width: 30, height: 60, zIndex: 1,
            rotation: 0, visible: true, fogEnabled: false, fogDataUrl: "", bordered: true,
          },
        ]),
        lastBroadcastCache: {},
        lastPlayerScreenWidth: 0,
        lastPlayerScreenHeight: 0,
      },
      server: null,
    });
    const panel = makePanel(plugin);

    expect(() => (panel as any).restoreState()).not.toThrow();
  });
});

describe("DmControlPanel.republishToServer", () => {
  it("broadcasts the current image layers when called and the server is running", () => {
    const serverStub = {
      lastState: new Map<string, string>(),
      broadcast: vi.fn(),
    };
    const plugin = makePlugin({
      settings: {
        lastImageLayers: "[]",
        lastBroadcastCache: {},
        lastPlayerScreenWidth: 0,
        lastPlayerScreenHeight: 0,
      },
      server: serverStub as any,
    });
    const panel = makePanel(plugin);
    panel.imageLayers = [
      {
        id: "l1", label: "Goblin", dataUrl: "data:image/png;base64,X",
        x: 0, y: 0, width: 30, height: 60, zIndex: 1,
        rotation: 0, visible: true, fogEnabled: false, fogDataUrl: "", bordered: true,
      } as any,
    ];

    panel.republishToServer();

    expect(serverStub.broadcast).toHaveBeenCalledTimes(2);
    const types = (serverStub.broadcast as any).mock.calls.map(([m]: any[]) => m.type);
    expect(types).toEqual(["image-layers-sync", "image-layers-geometry"]);
    const geometry = (serverStub.broadcast as any).mock.calls[1][0].payload.layers[0];
    expect(geometry).toEqual({
      id: "l1", x: 0, y: 0, width: 30, height: 60,
      zIndex: 1, rotation: 0, visible: true, bordered: true,
    });
    expect("dataUrl" in geometry).toBe(false);
  });

  it("is a no-op when the server is not running", () => {
    const plugin = makePlugin({ server: null });
    const panel = makePanel(plugin);
    panel.imageLayers = [
      {
        id: "l1", label: "Goblin", dataUrl: "data:image/png;base64,X",
        x: 0, y: 0, width: 30, height: 60, zIndex: 1,
        rotation: 0, visible: true, fogEnabled: false, fogDataUrl: "", bordered: true,
      } as any,
    ];
    expect(() => panel.republishToServer()).not.toThrow();
  });

  it("broadcasts show-background-media when activeBackgroundUrl is set", () => {
    const serverStub = {
      lastState: new Map<string, string>(),
      broadcast: vi.fn(),
    };
    const plugin = makePlugin({
      settings: {
        lastImageLayers: "[]",
        lastBroadcastCache: {},
        lastPlayerScreenWidth: 0,
        lastPlayerScreenHeight: 0,
      },
      server: serverStub as any,
    });
    const panel = makePanel(plugin);
    panel.activeBackgroundUrl = "/vault/maps%2Fdungeon.png";

    panel.republishToServer();

    expect(serverStub.broadcast).toHaveBeenCalledTimes(1);
    const [msg] = (serverStub.broadcast as any).mock.calls[0];
    expect(msg.type).toBe("show-background-media");
    expect(msg.payload.url).toBe("/vault/maps%2Fdungeon.png");
    expect(msg.payload.mediaType).toBe("image");
  });

  it("broadcasts show-background-media with mediaType video for video URLs", () => {
    const serverStub = {
      lastState: new Map<string, string>(),
      broadcast: vi.fn(),
    };
    const plugin = makePlugin({
      settings: {
        lastImageLayers: "[]",
        lastBroadcastCache: {},
        lastPlayerScreenWidth: 0,
        lastPlayerScreenHeight: 0,
      },
      server: serverStub as any,
    });
    const panel = makePanel(plugin);
    panel.activeBackgroundUrl = "/vault/videos%2Fintro.mp4";

    panel.republishToServer();

    const [msg] = (serverStub.broadcast as any).mock.calls[0];
    expect(msg.type).toBe("show-background-media");
    expect(msg.payload.mediaType).toBe("video");
  });
});

describe("DmControlPanel.addImageLayer id uniqueness", () => {
  it("assigns distinct ids even when several layers are added in the same millisecond", () => {
    class MockImage {
      onload: () => void = () => {};
      naturalWidth = 100;
      naturalHeight = 100;
      set src(_v: string) {
        this.onload();
      }
    }
    const originalImage = (globalThis as any).Image;
    (globalThis as any).Image = MockImage as any;
    const originalNow = Date.now;
    Date.now = () => 1000;
    try {
      const panel = makePanel();
      (panel as any).getEffectiveResolution = () => ({ width: 1000, height: 1000 });
      (panel as any).broadcastAndRender = vi.fn();
      panel.addImageLayer("A", "data:image/png;base64,1", "image", true);
      panel.addImageLayer("B", "data:image/png;base64,2", "image", true);
      panel.addImageLayer("C", "data:image/png;base64,3", "image", true);
      const ids = panel.imageLayers.map((l) => l.id);
      expect(new Set(ids).size).toBe(3);
    } finally {
      (globalThis as any).Image = originalImage;
      Date.now = originalNow;
    }
  });
});

describe("DmControlPanel.addImageLayer pixel-derived sizing", () => {
  function withMockImage(naturalWidth: number, naturalHeight: number, fn: () => void) {
    class MockImage {
      onload: () => void = () => {};
      naturalWidth = naturalWidth;
      naturalHeight = naturalHeight;
      set src(_v: string) {
        this.onload();
      }
    }
    const original = (globalThis as any).Image;
    (globalThis as any).Image = MockImage as any;
    try { fn(); } finally { (globalThis as any).Image = original; }
  }

  function preparePanel(tvW: number, tvH: number) {
    const panel = makePanel();
    (panel as any).getEffectiveResolution = () => ({ width: tvW, height: tvH });
    (panel as any).broadcastAndRender = vi.fn();
    return panel;
  }

  it("clamps a wide image larger than the viewport to ≤100% on both axes, preserves aspect ratio, and centres it", () => {
    const panel = preparePanel(1000, 1000);
    withMockImage(2000, 500, () => {
      panel.addImageLayer("wide-big", "data:image/png;base64,Z", "image", true);
    });

    expect(panel.imageLayers.length).toBe(1);
    const l = panel.imageLayers[0];
    expect(l.width).toBeCloseTo(100, 6);
    expect(l.height).toBeCloseTo(25, 6);
    expect(l.x).toBeCloseTo(0, 6);
    expect(l.y).toBeCloseTo(37.5, 6);
  });

  it("does not upscale an image smaller than the viewport, just centres it", () => {
    const panel = preparePanel(1000, 1000);
    withMockImage(500, 500, () => {
      panel.addImageLayer("small", "data:image/png;base64,Z", "image", true);
    });

    const l = panel.imageLayers[0];
    expect(l.width).toBeCloseTo(50, 6);
    expect(l.height).toBeCloseTo(50, 6);
    expect(l.x).toBeCloseTo(25, 6);
    expect(l.y).toBeCloseTo(25, 6);
  });
});

describe("DmControlPanel.getActiveCombatLabel — DDB title clickability", () => {
  it("returns ddbId when active source is DnDBeyondPanel with a tracked encounter", () => {
    const panel = makePanel();
    (panel as any).combatTab = "dndbeyond";
    (panel as any).ddbPanel = {
      getActiveEncounterStatus: () => ({ id: "enc-42", name: "Goblin Ambush", roundNum: 2 }),
    };
    const label = (panel as any).getActiveCombatLabel();
    expect(label).toEqual({ text: "Goblin Ambush — Round 2", ddbId: "enc-42" });
  });

  it("returns null ddbId for plugin source", () => {
    const panel = makePanel();
    (panel as any).combatTab = "initiative";
    (panel as any).trackerSource = "plugin";
    (panel as any).encounterName = "Manual Combat";
    (panel as any).pluginRound = 3;
    const label = (panel as any).getActiveCombatLabel();
    expect(label).toEqual({ text: "Manual Combat — Round 3", ddbId: null });
  });

  it("returns empty/null when nothing is active", () => {
    const panel = makePanel();
    const label = (panel as any).getActiveCombatLabel();
    expect(label).toEqual({ text: "", ddbId: null });
  });
});

describe("DmControlPanel.broadcastManualInitiative round-1 hide", () => {
  it("hides combatants past the active turn during round 1", () => {
    const plugin = makePlugin();
    const panel = makePanel(plugin);
    panel.manualRound = 1;
    panel.manualCombatants = [
      { name: "A", hp: 10, maxHp: 10, initiative: 20, active: false, statuses: [] },
      { name: "B", hp: 10, maxHp: 10, initiative: 15, active: true, statuses: [] },
      { name: "C", hp: 10, maxHp: 10, initiative: 10, active: false, statuses: [] },
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
      { name: "A", hp: 10, maxHp: 10, initiative: 20, active: false, statuses: [] },
      { name: "B", hp: 10, maxHp: 10, initiative: 15, active: true, statuses: [] },
      { name: "C", hp: 10, maxHp: 10, initiative: 10, active: false, statuses: [] },
    ];

    (panel as any).broadcastManualInitiative();

    const [combatants] = (plugin.sendInitiativeUpdate as any).mock.calls[0];
    expect(combatants.every((c: any) => c.hidden === false)).toBe(true);
  });
});
