import { Notice } from "obsidian";
import type DmScreenPlugin from "../main";
import { DdbClient } from "../dndbeyond/client";
import { DdbEncounterPoller, type DdbPolledState } from "../dndbeyond/poller";
import { DdbImageCache } from "../dndbeyond/imageCache";
import { debug } from "../debug";
import type { VaultAdapterLike } from "../hydrus/cache";
import type { DdbEncounter } from "../dndbeyond/types";

export class DnDBeyondPanel {
  private client: DdbClient | null = null;
  private poller: DdbEncounterPoller | null = null;
  private encounters: DdbEncounter[] = [];
  private selectedEncounterId: string | null = null;
  private searchFilter = "";
  private showPcHp = true;
  private polledState: DdbPolledState | null = null;
  private container: HTMLElement;

  constructor(private plugin: DmScreenPlugin, container: HTMLElement) {
    this.container = container;
  }

  setContainer(el: HTMLElement): void {
    this.container = el;
    this.render();
    this.loadEncounters().then(() => this.render());
  }

  async initialize(): Promise<void> {
    const session = this.plugin.settings.ddbCobaltSession;
    if (!session) {
      this.render();
      return;
    }
    try {
      this.client = new DdbClient(session);
      const valid = await this.client.validateSession();
      if (!valid) {
        this.client = null;
        new Notice("D&D Beyond session expired. Update cookie in settings.", 6000);
      } else {
        await this.loadEncounters();
      }
    } catch {
      this.client = null;
    }
    this.render();
  }

  destroy(): void {
    this.stopTracking();
  }

  render(): void {
    this.container.empty();

    if (!this.client) {
      const msg = this.container.createDiv({ cls: "dm-ddb-message" });
      msg.setText("Configure CobaltSession in settings to connect to D&D Beyond.");
      return;
    }

    // Controls row: search + show PC HP toggle
    const controlsRow = this.container.createDiv({ cls: "dm-ddb-controls" });

    const searchInput = controlsRow.createEl("input", {
      cls: "dm-ddb-search",
      attr: { type: "text", placeholder: "Search encounters..." },
    });
    searchInput.value = this.searchFilter;
    searchInput.addEventListener("input", () => {
      this.searchFilter = searchInput.value;
      this.renderList();
    });

    const hpToggle = controlsRow.createDiv({ cls: "dm-ddb-hp-toggle" });
    const hpCheck = hpToggle.createEl("input", { type: "checkbox" }) as HTMLInputElement;
    hpCheck.checked = this.showPcHp;
    hpCheck.id = "dm-ddb-show-pc-hp";
    hpCheck.addEventListener("change", () => {
      this.showPcHp = hpCheck.checked;
      if (this.polledState) this.broadcastToPlayerScreen(this.polledState);
    });
    hpToggle.createEl("label", { text: "Show PC HP", attr: { for: "dm-ddb-show-pc-hp" } });

    // Encounter list container
    this.container.createDiv({ cls: "dm-ddb-encounter-list" });
    this.renderList();

    // Tracking status
    if (this.selectedEncounterId && this.polledState) {
      this.renderTrackingStatus();
    }
  }

  private renderList(): void {
    const listEl = this.container.querySelector(".dm-ddb-encounter-list") as HTMLElement;
    if (!listEl) return;
    listEl.empty();

    const filtered = this.encounters.filter((e) =>
      e.name.toLowerCase().includes(this.searchFilter.toLowerCase())
    );

    if (filtered.length === 0) {
      listEl.createDiv({ cls: "dm-ddb-message", text: "No encounters found" });
      return;
    }

    for (const enc of filtered) {
      const row = listEl.createDiv({ cls: "dm-ddb-encounter-row" });
      if (enc.id === this.selectedEncounterId) {
        row.addClass("dm-ddb-encounter-selected");
      }

      // Select/deselect button
      const selectBtn = row.createEl("button", {
        cls: "dm-ddb-check",
        text: enc.id === this.selectedEncounterId ? "✓" : "○",
      });
      selectBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.selectedEncounterId === enc.id) {
          this.stopTracking();
        } else {
          this.selectEncounter(enc.id);
        }
      });

      // Encounter name (clicking opens in external browser)
      const nameEl = row.createEl("span", { cls: "dm-ddb-encounter-name", text: enc.name });
      nameEl.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        const url = `https://www.dndbeyond.com/encounters/${enc.id}`;
        try {
          require("electron").shell.openExternal(url);
        } catch {
          window.open(url, "_blank");
        }
      });

      // In progress badge
      if (enc.inProgress) {
        row.createEl("span", { cls: "dm-ddb-badge", text: "In Progress" });
      }
    }
  }

  private renderTrackingStatus(): void {
    const existing = this.container.querySelector(".dm-ddb-tracking");
    if (existing) existing.remove();

    if (!this.polledState) return;

    const tracking = this.container.createDiv({ cls: "dm-ddb-tracking" });
    const header = tracking.createDiv({ cls: "dm-ddb-tracking-header" });
    header.createEl("span", {
      text: `Tracking: ${this.polledState.encounter.name} — Round ${this.polledState.encounter.roundNum}`,
    });

    const stopBtn = header.createEl("button", { text: "Stop Tracking", cls: "dm-ddb-stop-btn" });
    stopBtn.addEventListener("click", () => this.stopTracking());
  }

  private async loadEncounters(): Promise<void> {
    if (!this.client) return;
    try {
      this.encounters = await this.client.getEncounters();
    } catch (e) {
      new Notice(`Failed to load encounters: ${(e as Error).message}`, 6000);
    }
  }

  private selectEncounter(id: string): void {
    if (this.poller) {
      this.poller.stop();
      this.poller = null;
    }
    this.selectedEncounterId = id;
    this.startTracking(id);
    this.renderList();
    this.renderTrackingStatus();

    // Load monster images in the background
    if (this.client) {
      this.client.getEncounter(id).then((enc) => this.loadMonsterImages(enc)).catch(() => {});
    }
  }

  private startTracking(encounterId: string): void {
    if (!this.client) return;
    this.poller = new DdbEncounterPoller(
      this.client,
      encounterId,
      (state) => this.onPollUpdate(state),
      (err) => this.onPollError(err)
    );
    this.poller.start();
  }

  private stopTracking(): void {
    if (this.poller) {
      this.poller.stop();
      this.poller = null;
    }
    this.selectedEncounterId = null;
    this.polledState = null;
    this.plugin.sendInitiativeUpdate([], 0);
    this.renderList();
    const trackingEl = this.container.querySelector(".dm-ddb-tracking");
    if (trackingEl) trackingEl.remove();
  }

  private onPollUpdate(state: DdbPolledState): void {
    this.polledState = state;
    this.broadcastToPlayerScreen(state);
    this.renderTrackingStatus();
  }

  private onPollError(err: Error): void {
    console.warn("[DDB Poller]", err.message);
  }

  private broadcastToPlayerScreen(state: DdbPolledState): void {
    const { encounter, characters } = state;
    const combatants: Array<{
      name: string; hp: number; maxHp: number; initiative: number;
      active: boolean; friendly?: boolean; isPlayer?: boolean;
      hidden?: boolean; hideHp?: boolean; statuses?: string[];
    }> = [];

    const players = encounter.players ?? [];
    const monsters = encounter.monsters ?? [];
    const manualEntries = encounter.manualEntries ?? [];

    const allParticipants = [
      ...players.map((p) => ({ ...p, kind: "player" as const })),
      ...monsters.map((m) => ({ ...m, kind: "monster" as const })),
      ...manualEntries.map((e) => ({ ...e, kind: "manual" as const })),
    ].sort((a, b) => b.initiative - a.initiative);

    // DDB turnNum is 1-indexed
    const currentTurnIdx = encounter.inProgress ? encounter.turnNum - 1 : -1;

    for (let i = 0; i < allParticipants.length; i++) {
      const p = allParticipants[i];
      const isActive = i === currentTurnIdx;

      if (p.kind === "player") {
        const char = characters.get(p.id);
        combatants.push({
          name: char?.name ?? p.name,
          hp: char?.currentHitPoints ?? 0,
          maxHp: char?.maxHitPoints ?? 0,
          initiative: p.initiative,
          active: isActive,
          friendly: true,
          isPlayer: true,
          hidden: false,
          hideHp: !this.showPcHp,
          statuses: [],
        });
      } else {
        combatants.push({
          name: p.name,
          hp: (p as { currentHitPoints: number }).currentHitPoints,
          maxHp: (p as { maximumHitPoints: number }).maximumHitPoints,
          initiative: p.initiative,
          active: isActive,
          friendly: false,
          isPlayer: false,
          hidden: false,
          statuses: [],
        });
      }
    }

    this.plugin.sendInitiativeUpdate(combatants, encounter.roundNum);
  }

  private async loadMonsterImages(encounter: DdbEncounter): Promise<void> {
    if (!this.client) return;

    const uniqueIds = [...new Set(encounter.monsters.map((m) => m.id))];
    if (uniqueIds.length === 0) return;

    debug("loadMonsterImages: encounter", encounter.name, "uniqueIds", uniqueIds);

    try {
      const avatarMap = await this.client.getMonsterImages(uniqueIds);
      debug("loadMonsterImages: avatarMap entries", avatarMap.size, [...avatarMap.entries()]);

      const cacheFolder =
        this.plugin.settings.hydrusCacheFolder.replace(/\/bg\/?$/, "") || ".dm-screen";
      const adapter = this.plugin.app.vault.adapter as unknown as VaultAdapterLike;
      const ttlDays = this.plugin.settings.hydrusCacheTtlDays || 30;
      const cache = new DdbImageCache(cacheFolder, adapter, ttlDays);

      const dmPanel = await this.plugin.findOpenDmControlPanel();
      if (!dmPanel) {
        debug("loadMonsterImages: no DM panel open, aborting");
        return;
      }

      for (const [monsterId, imageUrl] of avatarMap) {
        const monster = encounter.monsters.find((m) => m.id === monsterId);
        const name = monster?.name ?? `Monster ${monsterId}`;
        debug("loadMonsterImages: downloading", name, "id", monsterId, "url", imageUrl);
        const vaultPath = await cache.getOrDownload(monsterId, imageUrl, name);
        const dataUrl = await this.plugin.imageToDataUrl(vaultPath);
        if (dataUrl) {
          dmPanel.addImageLayer(name, dataUrl, "monster", false);
          debug("loadMonsterImages: added layer", name);
        }
      }
    } catch (e) {
      console.warn("[DDB] Failed to load monster images:", (e as Error).message);
    }
  }
}
