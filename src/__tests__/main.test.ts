import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { TFile } from "obsidian";
import type { InitiativeViewState, CreatureState } from "../types";

// Mock obsidian module so static imports in main.ts resolve
vi.mock("obsidian", async () => {
  const actual = await vi.importActual<typeof import("obsidian")>("obsidian");
  return { ...actual, Notice: vi.fn() };
});

// Mock dependent modules to isolate main.ts logic
vi.mock("../server", () => ({
  PlayerScreenServer: vi.fn(),
}));

vi.mock("../hydrus/cache", () => ({
  HydrusCache: vi.fn(),
}));

vi.mock("../hydrus/client", () => ({
  HydrusClient: vi.fn(),
}));

vi.mock("../dndbeyond/imageCache", () => ({
  DdbImageCache: vi.fn(),
}));

vi.mock("../views/DmControlPanel", () => ({
  DmControlPanel: vi.fn(),
  DM_CONTROL_VIEW_TYPE: "dm-control-panel",
}));

vi.mock("../debug", () => ({
  initDebug: vi.fn(),
  debug: vi.fn(),
  debugWarn: vi.fn(),
  debugError: vi.fn(),
}));

import DmScreenPlugin from "../main";
import { DEFAULT_SETTINGS } from "../settings";
import { PlayerScreenServer } from "../server";
import { HydrusClient } from "../hydrus/client";
import { HydrusCache } from "../hydrus/cache";
import { DdbImageCache } from "../dndbeyond/imageCache";
import { Notice } from "obsidian";

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

function makePlugin(settingsOverrides: Record<string, unknown> = {}): DmScreenPlugin {
  const plugin = Object.create(DmScreenPlugin.prototype) as DmScreenPlugin;
  plugin.settings = { ...DEFAULT_SETTINGS, ...settingsOverrides } as any;
  plugin.server = null;
  plugin.hydrusCache = null;
  plugin.ddbImageCache = null;
  (plugin as any).hydrusSweepInterval = null;
  (plugin as any).ddbImageSweepInterval = null;
  (plugin as any).statblockCache = new Map();

  // Mock Obsidian Plugin API
  (plugin as any).app = {
    workspace: {
      getLeavesOfType: vi.fn(() => []),
      getRightLeaf: vi.fn(() => null),
      revealLeaf: vi.fn(),
      on: vi.fn(),
    },
    vault: {
      getAbstractFileByPath: vi.fn(() => null),
      readBinary: vi.fn(async () => new ArrayBuffer(0)),
      adapter: {
        exists: vi.fn(async () => false),
        readBinary: vi.fn(async () => new ArrayBuffer(0)),
      },
    },
    metadataCache: {
      getFirstLinkpathDest: vi.fn(() => null),
      getFileCache: vi.fn(() => null),
    },
  };
  (plugin as any).loadData = vi.fn(async () => ({}));
  (plugin as any).saveData = vi.fn(async () => {});
  (plugin as any).registerView = vi.fn();
  (plugin as any).registerEvent = vi.fn();
  (plugin as any).registerInterval = vi.fn((id: number) => id);
  (plugin as any).addCommand = vi.fn();
  (plugin as any).addSettingTab = vi.fn();
  (plugin as any).addRibbonIcon = vi.fn();

  return plugin;
}

describe("DmScreenPlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).FantasyStatblocks = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── buildHydrusClient ───────────────────────────────────────

  describe("buildHydrusClient", () => {
    it("returns null when hydrus is disabled", () => {
      const plugin = makePlugin({ hydrusEnabled: false, hydrusApiUrl: "http://x", hydrusApiKey: "abc" });
      expect(plugin.buildHydrusClient()).toBeNull();
    });

    it("returns null when API URL is empty", () => {
      const plugin = makePlugin({ hydrusEnabled: true, hydrusApiUrl: "", hydrusApiKey: "abc" });
      expect(plugin.buildHydrusClient()).toBeNull();
    });

    it("returns null when API key is empty", () => {
      const plugin = makePlugin({ hydrusEnabled: true, hydrusApiUrl: "http://x", hydrusApiKey: "" });
      expect(plugin.buildHydrusClient()).toBeNull();
    });

    it("returns a HydrusClient when fully configured", () => {
      const plugin = makePlugin({
        hydrusEnabled: true,
        hydrusApiUrl: "http://hydrus.local:45869",
        hydrusApiKey: "abc123",
      });
      const client = plugin.buildHydrusClient();
      expect(client).not.toBeNull();
      expect(HydrusClient).toHaveBeenCalledWith({
        baseUrl: "http://hydrus.local:45869",
        apiKey: "abc123",
      });
    });

    it("returns null if HydrusClient constructor throws", () => {
      (HydrusClient as any).mockImplementationOnce(function () { throw new Error("bad url"); });
      const plugin = makePlugin({
        hydrusEnabled: true,
        hydrusApiUrl: "http://hydrus.local:45869",
        hydrusApiKey: "abc123",
      });
      expect(plugin.buildHydrusClient()).toBeNull();
    });
  });

  // ─── loadSettings ────────────────────────────────────────────

  describe("loadSettings", () => {
    it("merges saved data with defaults", async () => {
      const plugin = makePlugin();
      (plugin as any).loadData = vi.fn(async () => ({ serverPort: 9999, debugMode: true }));
      await plugin.loadSettings();
      expect(plugin.settings.serverPort).toBe(9999);
      expect(plugin.settings.debugMode).toBe(true);
      expect(plugin.settings.autoStartServer).toBe(false); // default preserved
    });

    it("uses all defaults when no saved data", async () => {
      const plugin = makePlugin();
      (plugin as any).loadData = vi.fn(async () => null);
      await plugin.loadSettings();
      expect(plugin.settings).toEqual({ ...DEFAULT_SETTINGS });
    });
  });

  // ─── saveSettings ────────────────────────────────────────────

  describe("saveSettings", () => {
    it("persists settings without rebuilding the hydrus cache", async () => {
      const plugin = makePlugin();
      const initSpy = vi.spyOn(plugin as any, "initHydrusCache").mockImplementation(() => {});
      await plugin.saveSettings();
      expect((plugin as any).saveData).toHaveBeenCalledWith(plugin.settings);
      // initHydrusCache is now only triggered by Hydrus-specific setting
      // onChange handlers, not by every saveSettings call.
      expect(initSpy).not.toHaveBeenCalled();
    });
  });

  // ─── Server lifecycle ────────────────────────────────────────

  describe("startServer", () => {
    it("creates and starts a PlayerScreenServer", () => {
      const fakeServer = makeFakeServer();
      (PlayerScreenServer as any).mockImplementation(function () { return fakeServer; });
      const plugin = makePlugin({ serverPort: 4000, maxClients: 5 });
      plugin.startServer();
      expect(plugin.server).not.toBeNull();
      expect(PlayerScreenServer).toHaveBeenCalledWith(plugin);
      expect(fakeServer.start).toHaveBeenCalledWith(4000);
      expect(fakeServer.maxClients).toBe(5);
      expect(Notice).toHaveBeenCalledWith("Player Screen server started on port 4000");
    });

    it("does nothing if server is already running", () => {
      const fakeServer = makeFakeServer();
      (PlayerScreenServer as any).mockImplementation(function () { return fakeServer; });
      const plugin = makePlugin();
      plugin.startServer();
      const firstServer = plugin.server;
      plugin.startServer();
      expect(plugin.server).toBe(firstServer);
      expect(PlayerScreenServer).toHaveBeenCalledTimes(1);
    });
  });

  describe("stopServer", () => {
    it("stops the server and nullifies it", () => {
      const plugin = makePlugin();
      const fakeServer = makeFakeServer();
      plugin.server = fakeServer as any;
      plugin.stopServer();
      expect(fakeServer.stop).toHaveBeenCalled();
      expect(plugin.server).toBeNull();
      expect(Notice).toHaveBeenCalledWith("Player Screen server stopped");
    });

    it("does nothing if no server is running", () => {
      const plugin = makePlugin();
      plugin.stopServer();
      expect(Notice).not.toHaveBeenCalledWith("Player Screen server stopped");
    });

    it("stops combat broadcast on open DM Control Panel views before the server", () => {
      const plugin = makePlugin();
      const fakeServer = makeFakeServer();
      plugin.server = fakeServer as any;
      const stopBroadcast = vi.fn();
      const fakeLeaf = { view: { stopAllCombatBroadcast: stopBroadcast } };
      ((plugin as any).app.workspace.getLeavesOfType as any).mockReturnValue([fakeLeaf]);

      plugin.stopServer();

      expect(stopBroadcast).toHaveBeenCalledTimes(1);
      expect(fakeServer.stop).toHaveBeenCalled();
      expect(stopBroadcast.mock.invocationCallOrder[0]).toBeLessThan(
        fakeServer.stop.mock.invocationCallOrder[0]
      );
    });
  });

  describe("toggleServer", () => {
    it("starts server when not running", () => {
      (PlayerScreenServer as any).mockImplementation(function () { return makeFakeServer(); });
      const plugin = makePlugin();
      plugin.toggleServer();
      expect(plugin.server).not.toBeNull();
    });

    it("stops server when running", () => {
      const plugin = makePlugin();
      plugin.server = makeFakeServer() as any;
      plugin.toggleServer();
      expect(plugin.server).toBeNull();
    });
  });

  // ─── sendInitiativeUpdate ────────────────────────────────────

  describe("sendInitiativeUpdate", () => {
    it("does nothing when server is null", () => {
      const plugin = makePlugin();
      plugin.sendInitiativeUpdate([{ name: "Goblin", hp: 7, maxHp: 7, initiative: 15, active: true }]);
      // No error thrown
    });

    it("broadcasts visible combatants only (filters hidden)", () => {
      const plugin = makePlugin();
      const fakeServer = makeFakeServer();
      plugin.server = fakeServer as any;
      const combatants = [
        { name: "Fighter", hp: 30, maxHp: 30, initiative: 18, active: true, hidden: false },
        { name: "Hidden Assassin", hp: 20, maxHp: 20, initiative: 22, active: false, hidden: true },
        { name: "Goblin", hp: 7, maxHp: 7, initiative: 12, active: false, hidden: false },
      ];
      plugin.sendInitiativeUpdate(combatants, 2);

      expect(fakeServer.broadcast).toHaveBeenCalledWith({
        type: "initiative-update",
        payload: {
          combatants: [
            expect.objectContaining({ name: "Fighter" }),
            expect.objectContaining({ name: "Goblin" }),
          ],
          round: 2,
        },
      });
    });

    it("defaults round to 0 when not provided", () => {
      const plugin = makePlugin();
      const fakeServer = makeFakeServer();
      plugin.server = fakeServer as any;
      plugin.sendInitiativeUpdate([{ name: "A", hp: 1, maxHp: 1, initiative: 1, active: false }]);
      expect(fakeServer.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({ payload: expect.objectContaining({ round: 0 }) })
      );
    });
  });

  // ─── resolveLink ─────────────────────────────────────────────

  describe("resolveLink", () => {
    it("strips wikilink brackets and delegates to metadataCache", () => {
      const plugin = makePlugin();
      const mockFile = new TFile();
      (plugin as any).app.metadataCache.getFirstLinkpathDest = vi.fn(() => mockFile);
      const result = plugin.resolveLink("[[Monsters/Goblin]]", "Encounters/fight.md");
      expect((plugin as any).app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
        "Monsters/Goblin",
        "Encounters/fight.md"
      );
      expect(result).toBe(mockFile);
    });

    it("handles plain text (no brackets)", () => {
      const plugin = makePlugin();
      plugin.resolveLink("plain/path", "source.md");
      expect((plugin as any).app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
        "plain/path",
        "source.md"
      );
    });
  });

  // ─── getFrontmatter ──────────────────────────────────────────

  describe("getFrontmatter", () => {
    it("returns frontmatter when file has cache", () => {
      const plugin = makePlugin();
      const mockFile = new TFile();
      const fm = { title: "Dragon", cr: "5" };
      (plugin as any).app.metadataCache.getFileCache = vi.fn(() => ({ frontmatter: fm }));
      expect(plugin.getFrontmatter(mockFile)).toEqual(fm);
    });

    it("returns undefined when file has no cache", () => {
      const plugin = makePlugin();
      const mockFile = new TFile();
      (plugin as any).app.metadataCache.getFileCache = vi.fn(() => null);
      expect(plugin.getFrontmatter(mockFile)).toBeUndefined();
    });
  });

  // ─── imageToDataUrl ──────────────────────────────────────────

  describe("imageToDataUrl", () => {
    it("returns data URL for a vault-indexed PNG file", async () => {
      const plugin = makePlugin();
      const mockFile = Object.assign(new TFile(), { path: "img/map.png" });
      const pngBytes = new Uint8Array([137, 80, 78, 71]).buffer; // PNG magic bytes
      (plugin as any).app.vault.getAbstractFileByPath = vi.fn(() => mockFile);
      (plugin as any).app.vault.readBinary = vi.fn(async () => pngBytes);

      const result = await plugin.imageToDataUrl("img/map.png");
      expect(result).toMatch(/^data:image\/png;base64,/);
    });

    it("falls back to adapter for dotfolder paths", async () => {
      const plugin = makePlugin();
      const jpgBytes = new Uint8Array([255, 216, 255]).buffer;
      (plugin as any).app.vault.getAbstractFileByPath = vi.fn(() => null);
      (plugin as any).app.vault.adapter.exists = vi.fn(async () => true);
      (plugin as any).app.vault.adapter.readBinary = vi.fn(async () => jpgBytes);

      const result = await plugin.imageToDataUrl(".dm-screen/bg/pic.jpg");
      expect(result).toMatch(/^data:image\/jpeg;base64,/);
    });

    it("returns empty string when file not found", async () => {
      const plugin = makePlugin();
      (plugin as any).app.vault.getAbstractFileByPath = vi.fn(() => null);
      (plugin as any).app.vault.adapter.exists = vi.fn(async () => false);

      const result = await plugin.imageToDataUrl("nonexistent.webp");
      expect(result).toBe("");
    });

    it("detects webp MIME type", async () => {
      const plugin = makePlugin();
      const mockFile = Object.assign(new TFile(), { path: "img/bg.webp" });
      (plugin as any).app.vault.getAbstractFileByPath = vi.fn(() => mockFile);
      (plugin as any).app.vault.readBinary = vi.fn(async () => new Uint8Array([1, 2, 3]).buffer);

      const result = await plugin.imageToDataUrl("img/bg.webp");
      expect(result).toMatch(/^data:image\/webp;base64,/);
    });

    it("detects jpeg MIME type for .jpeg extension", async () => {
      const plugin = makePlugin();
      const mockFile = Object.assign(new TFile(), { path: "img/photo.jpeg" });
      (plugin as any).app.vault.getAbstractFileByPath = vi.fn(() => mockFile);
      (plugin as any).app.vault.readBinary = vi.fn(async () => new Uint8Array([1]).buffer);

      const result = await plugin.imageToDataUrl("img/photo.jpeg");
      expect(result).toMatch(/^data:image\/jpeg;base64,/);
    });
  });

  // ─── lookupStatblock (private, accessed via initiative flow) ──

  describe("lookupStatblock", () => {
    function callLookup(plugin: DmScreenPlugin, name: string, baseName: string) {
      return (plugin as any).lookupStatblock(name, baseName);
    }

    it("returns null when FantasyStatblocks API is not available", () => {
      const plugin = makePlugin();
      (window as any).FantasyStatblocks = undefined;
      expect(callLookup(plugin, "Goblin", "Goblin")).toBeNull();
    });

    it("returns creature from bestiary by exact name", () => {
      const plugin = makePlugin();
      const creature = { name: "Goblin", ac: 15, hp: 7 };
      (window as any).FantasyStatblocks = {
        getCreatureFromBestiary: vi.fn((name: string) => name === "Goblin" ? creature : undefined),
      };
      expect(callLookup(plugin, "Goblin", "Goblin")).toBe(creature);
    });

    it("falls back to base name when exact name not found", () => {
      const plugin = makePlugin();
      const creature = { name: "Goblin", ac: 15, hp: 7 };
      (window as any).FantasyStatblocks = {
        getCreatureFromBestiary: vi.fn((name: string) => name === "Goblin" ? creature : undefined),
      };
      expect(callLookup(plugin, "Goblin 3", "Goblin")).toBe(creature);
    });

    it("caches results for repeated lookups", () => {
      const plugin = makePlugin();
      const creature = { name: "Dragon" };
      const mockGet = vi.fn(() => creature);
      (window as any).FantasyStatblocks = { getCreatureFromBestiary: mockGet };

      callLookup(plugin, "Dragon", "Dragon");
      callLookup(plugin, "Dragon", "Dragon");
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it("caches null results too", () => {
      const plugin = makePlugin();
      const mockGet = vi.fn(() => undefined);
      (window as any).FantasyStatblocks = { getCreatureFromBestiary: mockGet };

      callLookup(plugin, "Unknown", "Unknown");
      callLookup(plugin, "Unknown", "Unknown");
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it("does not fall back when baseName equals name", () => {
      const plugin = makePlugin();
      const mockGet = vi.fn(() => undefined);
      (window as any).FantasyStatblocks = { getCreatureFromBestiary: mockGet };

      callLookup(plugin, "Orc", "Orc");
      expect(mockGet).toHaveBeenCalledTimes(1); // only one call, no fallback
    });
  });

  // ─── onInitiativeStateChange (private) ───────────────────────

  describe("onInitiativeStateChange", () => {
    function callOnState(plugin: DmScreenPlugin, state: InitiativeViewState) {
      return (plugin as any).onInitiativeStateChange(state);
    }

    it("maps creatures to TrackerCombatant format", () => {
      const plugin = makePlugin();
      const fakeServer = makeFakeServer();
      plugin.server = fakeServer as any;

      const state: InitiativeViewState = {
        creatures: [
          {
            name: "Goblin",
            display: "Goblin Chief",
            hp: 20,
            ac: 15,
            currentHP: 18,
            currentMaxHP: 20,
            tempHP: 5,
            currentAC: 15,
            initiative: 14,
            active: true,
            hidden: false,
            friendly: false,
            player: false,
            status: ["poisoned"],
          },
        ],
        state: true,
        name: "Ambush",
        round: 1,
      };

      callOnState(plugin, state);

      expect(fakeServer.broadcast).toHaveBeenCalledWith({
        type: "initiative-update",
        payload: {
          combatants: [
            expect.objectContaining({
              name: "Goblin Chief",
              hp: 18,
              maxHp: 20,
              initiative: 14,
              active: true,
              hidden: false,
              statuses: ["poisoned"],
            }),
          ],
          round: 1,
        },
      });
    });

    it("uses fallback values for missing creature fields", () => {
      const plugin = makePlugin();
      const fakeServer = makeFakeServer();
      plugin.server = fakeServer as any;

      const state: InitiativeViewState = {
        creatures: [{ name: "" } as CreatureState],
        state: true,
        name: "",
        round: 3,
      };

      callOnState(plugin, state);

      const payload = fakeServer.broadcast.mock.calls[0][0].payload;
      expect(payload.combatants[0]).toEqual(
        expect.objectContaining({
          name: "Unknown",
          hp: 0,
          maxHp: 0,
          initiative: 0,
          active: false,
          hidden: false,
          friendly: false,
        })
      );
    });

    it("strips trailing numbers from names for baseName lookup", () => {
      const plugin = makePlugin();
      const creature = { name: "Skeleton" };
      (window as any).FantasyStatblocks = {
        getCreatureFromBestiary: vi.fn((name: string) => name === "Skeleton" ? creature : undefined),
      };

      const state: InitiativeViewState = {
        creatures: [{ name: "Skeleton 2", initiative: 10 } as CreatureState],
        state: true,
        name: "",
        round: 1,
      };

      callOnState(plugin, state);

      expect((window as any).FantasyStatblocks.getCreatureFromBestiary).toHaveBeenCalledWith("Skeleton 2");
      expect((window as any).FantasyStatblocks.getCreatureFromBestiary).toHaveBeenCalledWith("Skeleton");
    });

    it("forwards state to open DmControlPanel views", () => {
      const plugin = makePlugin();
      const syncFn = vi.fn();
      const mockView = { syncFromInitiativeTracker: syncFn };
      (plugin as any).app.workspace.getLeavesOfType = vi.fn(() => [{ view: mockView }]);

      const state: InitiativeViewState = {
        creatures: [{ name: "Orc", initiative: 8 } as CreatureState],
        state: true,
        name: "Fight",
        round: 2,
      };

      callOnState(plugin, state);
      expect(syncFn).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ name: "Orc" })]),
        2,
        "Fight"
      );
    });

  });

  // ─── onInitiativeStop (private) ──────────────────────────────

  describe("onInitiativeStop", () => {
    it("calls disconnectFromTracker on all open DM panels", () => {
      const plugin = makePlugin();
      const disconnectFn = vi.fn();
      const mockView = { disconnectFromTracker: disconnectFn };
      (plugin as any).app.workspace.getLeavesOfType = vi.fn(() => [
        { view: mockView },
        { view: { disconnectFromTracker: disconnectFn } },
      ]);

      (plugin as any).onInitiativeStop();
      expect(disconnectFn).toHaveBeenCalledTimes(2);
    });
  });

  // ─── activateView ────────────────────────────────────────────

  describe("activateView", () => {
    it("reveals existing leaf when view is already open", async () => {
      const plugin = makePlugin();
      const mockLeaf = { setViewState: vi.fn() };
      (plugin as any).app.workspace.getLeavesOfType = vi.fn(() => [mockLeaf]);
      await plugin.activateView("dm-control-panel");
      expect((plugin as any).app.workspace.revealLeaf).toHaveBeenCalledWith(mockLeaf);
    });

    it("creates a new leaf in right sidebar when view not open", async () => {
      const plugin = makePlugin();
      const newLeaf = { setViewState: vi.fn(async () => {}) };
      (plugin as any).app.workspace.getLeavesOfType = vi.fn(() => []);
      (plugin as any).app.workspace.getRightLeaf = vi.fn(() => newLeaf);
      await plugin.activateView("dm-control-panel");
      expect(newLeaf.setViewState).toHaveBeenCalledWith({ type: "dm-control-panel", active: true });
      expect((plugin as any).app.workspace.revealLeaf).toHaveBeenCalledWith(newLeaf);
    });

    it("does nothing when no leaf exists and getRightLeaf returns null", async () => {
      const plugin = makePlugin();
      (plugin as any).app.workspace.getLeavesOfType = vi.fn(() => []);
      (plugin as any).app.workspace.getRightLeaf = vi.fn(() => null);
      await plugin.activateView("dm-control-panel");
      expect((plugin as any).app.workspace.revealLeaf).not.toHaveBeenCalled();
    });
  });

  // ─── onunload ────────────────────────────────────────────────

  describe("onunload", () => {
    it("stops server on unload (intervals cleaned by registerInterval)", async () => {
      const plugin = makePlugin();
      const fakeServer = makeFakeServer();
      plugin.server = fakeServer as any;

      await plugin.onunload();

      expect(plugin.server).toBeNull();
      expect(fakeServer.stop).toHaveBeenCalled();
    });

    it("handles case when no server is running", async () => {
      const plugin = makePlugin();
      await plugin.onunload(); // should not throw
    });
  });

  // ─── initHydrusCache (private) ───────────────────────────────

  describe("initHydrusCache", () => {
    beforeEach(() => {
      const fakeHydrusCache = { sweep: vi.fn(async () => 0), clear: vi.fn(async () => 0) };
      (HydrusCache as any).mockImplementation(function () { return fakeHydrusCache; });
      const fakeDdbImageCache = { sweep: vi.fn(async () => 0) };
      (DdbImageCache as any).mockImplementation(function () { return fakeDdbImageCache; });
    });

    it("creates HydrusCache with hydrus/ subfolder under cacheBaseFolder", () => {
      const plugin = makePlugin({
        cacheBaseFolder: ".custom/cache",
        hydrusCacheTtlDays: 14,
        hydrusEnabled: false,
      });
      (plugin as any).initHydrusCache();
      expect(HydrusCache).toHaveBeenCalledWith((plugin as any).app, {
        folder: ".custom/cache/hydrus",
        ttlDays: 14,
      });
      expect(plugin.hydrusCache).not.toBeNull();
    });

    it("triggers sweep when hydrus is enabled", () => {
      const plugin = makePlugin({ hydrusEnabled: true });
      (plugin as any).initHydrusCache();
      expect(plugin.hydrusCache!.sweep).toHaveBeenCalled();
    });

    it("sets each sweep interval only once across multiple inits", () => {
      const plugin = makePlugin({ hydrusEnabled: true });
      const setIntervalSpy = vi.spyOn(window, "setInterval").mockReturnValue(999 as any);
      (plugin as any).initHydrusCache();
      (plugin as any).initHydrusCache();
      // Two intervals total: Hydrus + DDB image cache. Both must be set
      // exactly once even when initHydrusCache is called multiple times.
      expect(setIntervalSpy).toHaveBeenCalledTimes(2);
    });

    it("creates and sweeps DdbImageCache regardless of hydrusEnabled", () => {
      const plugin = makePlugin({
        cacheBaseFolder: ".custom/cache",
        hydrusCacheTtlDays: 14,
        hydrusEnabled: false,
      });
      (plugin as any).initHydrusCache();
      expect(DdbImageCache).toHaveBeenCalledWith(
        ".custom/cache/beyond",
        (plugin as any).app.vault.adapter,
        14
      );
      expect(plugin.ddbImageCache).not.toBeNull();
      expect(plugin.ddbImageCache!.sweep).toHaveBeenCalled();
    });
  });

  // ─── findOpenDmControlPanel ──────────────────────────────────

  describe("findOpenDmControlPanel", () => {
    it("returns null when no panels are open", async () => {
      const plugin = makePlugin();
      (plugin as any).app.workspace.getLeavesOfType = vi.fn(() => []);
      expect(await plugin.findOpenDmControlPanel()).toBeNull();
    });

    it("returns the first open DM Control Panel view", async () => {
      const plugin = makePlugin();
      const mockView = { type: "dm-control-panel" };
      (plugin as any).app.workspace.getLeavesOfType = vi.fn(() => [{ view: mockView }]);
      expect(await plugin.findOpenDmControlPanel()).toBe(mockView);
    });
  });
});
