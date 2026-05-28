import {
  Plugin,
  TFile,
  Notice,
} from "obsidian";
import { DmControlPanel, DM_CONTROL_VIEW_TYPE } from "./views/DmControlPanel";
import { EncounterBattlemapPanel, ENCOUNTER_BATTLEMAP_VIEW_TYPE } from "./views/EncounterBattlemapPanel";
import { PlayerScreenServer } from "./server";
import { DmScreenSettingTab, DmScreenSettings, DEFAULT_SETTINGS } from "./settings";
import type { InitiativeViewState, TrackerCombatant } from "./types";
import { HydrusCache } from "./hydrus/cache";
import type { VaultAdapterLike } from "./hydrus/cache";
import { HydrusClient } from "./hydrus/client";
import { DdbImageCache } from "./dndbeyond/imageCache";
import { initDebug } from "./debug";

export default class DmScreenPlugin extends Plugin {
  settings: DmScreenSettings = DEFAULT_SETTINGS;
  server: PlayerScreenServer | null = null;
  hydrusCache: HydrusCache | null = null;
  private hydrusSweepInterval: number | null = null;

  /** Returns the first DM Control Panel view that is currently open. */
  async findOpenDmControlPanel(): Promise<DmControlPanel | null> {
    const leaves = this.app.workspace.getLeavesOfType(DM_CONTROL_VIEW_TYPE);
    if (leaves.length === 0) return null;
    return leaves[0].view as DmControlPanel;
  }

  /** Build a HydrusClient from current settings. Returns null when not configured. */
  buildHydrusClient(): HydrusClient | null {
    const { hydrusEnabled, hydrusApiUrl, hydrusApiKey } = this.settings;
    if (!hydrusEnabled || !hydrusApiUrl || !hydrusApiKey) return null;
    try {
      return new HydrusClient({ baseUrl: hydrusApiUrl, apiKey: hydrusApiKey });
    } catch {
      return null;
    }
  }

  async onload() {
    await this.loadSettings();
    initDebug(this.settings);
    this.initHydrusCache();

    // Register views
    this.registerView(DM_CONTROL_VIEW_TYPE, (leaf) => new DmControlPanel(leaf, this));
    this.registerView(ENCOUNTER_BATTLEMAP_VIEW_TYPE, (leaf) => new EncounterBattlemapPanel(leaf, this));

    // Commands
    this.addCommand({
      id: "open-dm-control-panel",
      name: "Open DM Control Panel",
      callback: () => this.activateView(DM_CONTROL_VIEW_TYPE),
    });

    this.addCommand({
      id: "open-encounter-battlemaps",
      name: "Open Encounter Battlemaps",
      callback: () => this.activateView(ENCOUNTER_BATTLEMAP_VIEW_TYPE),
    });

    this.addCommand({
      id: "toggle-player-server",
      name: "Toggle Player Screen Server",
      callback: () => this.toggleServer(),
    });

    // Settings tab
    this.addSettingTab(new DmScreenSettingTab(this.app, this));

    // Start server if auto-start is enabled
    if (this.settings.autoStartServer) {
      this.startServer();
    }

    // Add ribbon icon
    this.addRibbonIcon("monitor", "DM Screen", () => {
      this.activateView(DM_CONTROL_VIEW_TYPE);
    });

    // Listen to Initiative Tracker plugin events
    this.registerEvent(
      (this.app.workspace.on as any)("initiative-tracker:save-state", (state: InitiativeViewState) => {
        this.onInitiativeStateChange(state);
      })
    );

    this.registerEvent(
      (this.app.workspace.on as any)("initiative-tracker:stop-viewing", () => {
        this.onInitiativeStop();
      })
    );

    this.registerEvent(
      (this.app.workspace.on as any)("initiative-tracker:unloaded", () => {
        this.onInitiativeStop();
      })
    );

  }

  async onunload() {
    this.stopServer();
    if (this.hydrusSweepInterval !== null) {
      window.clearInterval(this.hydrusSweepInterval);
      this.hydrusSweepInterval = null;
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    // Reflect any settings change in the live cache instance.
    this.initHydrusCache();
  }

  private initHydrusCache() {
    this.hydrusCache = new HydrusCache(this.app, {
      folder: this.settings.hydrusCacheFolder,
      ttlDays: this.settings.hydrusCacheTtlDays,
    });
    if (this.settings.hydrusEnabled) {
      // Don't await — startup must not block on a sweep.
      void this.hydrusCache.sweep().catch((e) =>
        console.error("[DM Screen] Hydrus cache sweep failed:", e)
      );
      if (this.hydrusSweepInterval === null) {
        this.hydrusSweepInterval = window.setInterval(() => {
          void this.hydrusCache?.sweep().catch(() => {});
        }, 24 * 60 * 60 * 1000);
      }
    }

    // Sweep stale DDB monster images
    const imgCacheFolder = this.settings.hydrusCacheFolder.replace(/\/bg\/?$/, "") || ".dm-screen";
    const imgCache = new DdbImageCache(
      imgCacheFolder,
      this.app.vault.adapter as unknown as VaultAdapterLike,
      this.settings.hydrusCacheTtlDays
    );
    void imgCache.sweep().then((n) => {
      if (n > 0) console.log(`[DM Screen] Swept ${n} stale monster image(s)`);
    }).catch(() => {});
  }

  startServer() {
    if (this.server) return;
    this.server = new PlayerScreenServer(this);
    this.server.maxClients = this.settings.maxClients;
    this.server.onClientInfo = (info) => this.onPlayerClientInfo(info);
    this.server.onClientCountChanged = () => {
      const clients = this.server?.getConnectedClients() ?? [];
      const leaves = this.app.workspace.getLeavesOfType(DM_CONTROL_VIEW_TYPE);
      for (const leaf of leaves) {
        const view = leaf.view as DmControlPanel;
        view.connectedClients = clients;
        view.playerConnected = clients.length > 0;
        view.debouncedRender?.();
      }
    };
    this.server.start(this.settings.serverPort);
    new Notice(`Player Screen server started on port ${this.settings.serverPort}`);
  }

  private onPlayerClientInfo(_info: { width: number; height: number; devicePixelRatio: number }) {
    const leaves = this.app.workspace.getLeavesOfType(DM_CONTROL_VIEW_TYPE);
    for (const leaf of leaves) {
      const view = leaf.view as DmControlPanel;
      if (view.onPlayerConnected) {
        view.onPlayerConnected(this.server?.getConnectedClients() ?? []);
      }
    }
  }

  stopServer() {
    if (this.server) {
      this.server.stop();
      this.server = null;
      new Notice("Player Screen server stopped");
    }
  }

  toggleServer() {
    if (this.server) {
      this.stopServer();
    } else {
      this.startServer();
    }
  }

  async activateView(viewType: string) {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(viewType)[0];
    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (rightLeaf) {
        leaf = rightLeaf;
        await leaf.setViewState({ type: viewType, active: true });
      }
    }
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }


  // ─── Resolve helpers (exported for use by other views) ─────────────

  resolveLink(linkStr: string, sourcePath: string): TFile | null {
    const cleanPath = linkStr.replace(/\[\[|\]\]/g, "");
    return this.app.metadataCache.getFirstLinkpathDest(cleanPath, sourcePath);
  }

  getFrontmatter(file: TFile): Record<string, unknown> | undefined {
    return this.app.metadataCache.getFileCache(file)?.frontmatter;
  }


  async imageToDataUrl(path: string): Promise<string> {
    const imgFile = this.app.vault.getAbstractFileByPath(path);
    if (!(imgFile instanceof TFile)) return "";
    const imgData = await this.app.vault.readBinary(imgFile);
    const base64 = arrayBufferToBase64(imgData);
    const ext = imgFile.extension.toLowerCase();
    const mime =
      ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/webp";
    return `data:${mime};base64,${base64}`;
  }

  sendInitiativeUpdate(combatants: Array<{
    name: string; hp: number; maxHp: number; initiative: number;
    active: boolean; friendly?: boolean; isPlayer?: boolean;
    hidden?: boolean; statuses?: string[];
  }>, round?: number) {
    if (!this.server) return;
    // Filter hidden creatures from player screen
    const visible = combatants.filter(c => !c.hidden);
    this.server.broadcast({
      type: "initiative-update",
      payload: { combatants: visible, round: round ?? 0 },
    });
  }

  // ─── Initiative Tracker Plugin Integration ──────────────────────────

  private onInitiativeStateChange(state: InitiativeViewState) {
    // Resolve statblocks and build TrackerCombatant list
    const combatants: TrackerCombatant[] = state.creatures.map(c => {
      const baseName = (c.name || "").replace(/\s+\d+$/, ""); // "Goblin 1" → "Goblin"
      const statblock = this.lookupStatblock(c.display || c.name || "", baseName);

      return {
        name: c.name || "Unknown",
        displayName: c.display || c.name || "Unknown",
        initiative: c.initiative ?? 0,
        hp: c.currentHP ?? c.hp ?? 0,
        maxHp: c.currentMaxHP ?? c.hp ?? 0,
        tempHp: c.tempHP ?? 0,
        ac: c.currentAC ?? c.ac ?? 0,
        active: c.active ?? false,
        hidden: c.hidden ?? false,
        friendly: c.friendly ?? false,
        isPlayer: c.player ?? false,
        statuses: c.status ?? [],
        statblock,
        source: "tracker-plugin" as const,
      };
    });

    // Auto-push battlemap if mapped for this encounter
    if (state.name && state.round <= 1) {
      const battlemapPath = this.settings.encounterBattlemaps[state.name];
      if (battlemapPath && this.server) {
        this.imageToDataUrl(battlemapPath).then(dataUrl => {
          if (dataUrl && this.server) {
            // Add to DM panel image layers
            const dmLeaves = this.app.workspace.getLeavesOfType(DM_CONTROL_VIEW_TYPE);
            for (const leaf of dmLeaves) {
              const view = leaf.view as DmControlPanel;
              if (view.addImageLayer) {
                view.addImageLayer(state.name || "Battlemap", dataUrl, "encounter", false);
              }
            }
          }
        });
      }
    }

    // Forward to DmControlPanel
    const leaves = this.app.workspace.getLeavesOfType(DM_CONTROL_VIEW_TYPE);
    for (const leaf of leaves) {
      const view = leaf.view as DmControlPanel;
      if (view.syncFromInitiativeTracker) {
        view.syncFromInitiativeTracker(combatants, state.round, state.name);
      }
    }

    // Broadcast to player screen
    this.sendInitiativeUpdate(combatants.map(c => ({
      name: c.displayName,
      hp: c.hp,
      maxHp: c.maxHp,
      initiative: c.initiative,
      active: c.active,
      friendly: c.friendly,
      isPlayer: c.isPlayer,
      hidden: c.hidden,
      statuses: c.statuses,
    })), state.round);
  }

  private onInitiativeStop() {
    const leaves = this.app.workspace.getLeavesOfType(DM_CONTROL_VIEW_TYPE);
    for (const leaf of leaves) {
      const view = leaf.view as DmControlPanel;
      if (view.disconnectFromTracker) {
        view.disconnectFromTracker();
      }
    }
  }

  private statblockCache = new Map<string, import("./types").StatblockCreature | null>();

  private lookupStatblock(name: string, baseName: string): import("./types").StatblockCreature | null {
    // Check cache first
    const cacheKey = name;
    if (this.statblockCache.has(cacheKey)) {
      return this.statblockCache.get(cacheKey)!;
    }

    const fsApi = window.FantasyStatblocks;
    if (!fsApi) {
      this.statblockCache.set(cacheKey, null);
      return null;
    }

    // Try exact name, then base name (without trailing number)
    let creature = fsApi.getCreatureFromBestiary(name) ?? undefined;
    if (!creature && baseName !== name) {
      creature = fsApi.getCreatureFromBestiary(baseName);
    }

    const result = creature ?? null;
    this.statblockCache.set(cacheKey, result);
    return result;
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
