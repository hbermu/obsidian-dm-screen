import { Notice } from "obsidian";
import type DmScreenPlugin from "../main";
import { DdbClient } from "../dndbeyond/client";
import { DdbEncounterPoller, type DdbPolledState } from "../dndbeyond/poller";
import type { DdbEncounterSummary } from "../dndbeyond/types";

export class DnDBeyondPanel {
  private client: DdbClient | null = null;
  private poller: DdbEncounterPoller | null = null;
  private encounters: DdbEncounterSummary[] = [];
  private selectedEncounterId: string | null = null;
  private searchFilter = "";
  private polledState: DdbPolledState | null = null;
  private container: HTMLElement;

  constructor(private plugin: DmScreenPlugin, container: HTMLElement) {
    this.container = container;
  }

  setContainer(el: HTMLElement): void {
    this.container = el;
    this.render();
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

    // Search input
    const searchInput = this.container.createEl("input", {
      cls: "dm-ddb-search",
      attr: { type: "text", placeholder: "Search encounters..." },
    });
    searchInput.value = this.searchFilter;
    searchInput.addEventListener("input", () => {
      this.searchFilter = searchInput.value;
      this.renderList();
    });

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

      // Checkbox indicator
      const check = row.createEl("span", { cls: "dm-ddb-check" });
      check.setText(enc.id === this.selectedEncounterId ? "✓" : "○");

      // Encounter name (clicking opens in browser)
      const nameEl = row.createEl("a", { cls: "dm-ddb-encounter-name", text: enc.name });
      nameEl.addEventListener("click", (e) => {
        e.stopPropagation();
        window.open(`https://www.dndbeyond.com/encounters/${enc.id}`);
      });

      // In progress badge
      if (enc.inProgress) {
        row.createEl("span", { cls: "dm-ddb-badge", text: "In Progress" });
      }

      // Row click to select/deselect
      row.addEventListener("click", () => {
        if (this.selectedEncounterId === enc.id) {
          this.stopTracking();
        } else {
          this.selectEncounter(enc.id);
        }
      });
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
    this.stopTracking();
    this.selectedEncounterId = id;
    this.startTracking(id);
    this.render();
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
    this.render();
  }

  private onPollUpdate(state: DdbPolledState): void {
    this.polledState = state;
    this.broadcastToPlayerScreen(state);
    this.renderTrackingStatus();
    this.renderList();
  }

  private onPollError(err: Error): void {
    console.warn("[DDB Poller]", err.message);
  }

  private broadcastToPlayerScreen(state: DdbPolledState): void {
    const { encounter, characters } = state;
    const combatants: Array<{
      name: string; hp: number; maxHp: number; initiative: number;
      active: boolean; friendly?: boolean; isPlayer?: boolean;
      hidden?: boolean; statuses?: string[];
    }> = [];

    // Determine current turn by index
    const allParticipants = [
      ...encounter.players.map((p) => ({ ...p, kind: "player" as const })),
      ...encounter.monsters.map((m) => ({ ...m, kind: "monster" as const })),
    ].sort((a, b) => b.initiative - a.initiative);

    const currentTurnIdx = encounter.inProgress ? encounter.turnNum : -1;

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
          statuses: [],
        });
      } else {
        combatants.push({
          name: p.name,
          hp: p.currentHitPoints,
          maxHp: p.maximumHitPoints,
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
}
