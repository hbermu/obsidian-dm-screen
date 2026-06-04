import { App, Modal, Notice } from "obsidian";
import type DmScreenPlugin from "../main";
import type { DdbClient } from "../dndbeyond/client";
import type { DdbEncounter } from "../dndbeyond/types";
import { debug, debugWarn } from "../debug";

export class DnDBeyondEncounterModal extends Modal {
  private client: DdbClient;
  private onSelect: (id: string) => void;
  private encounters: DdbEncounter[] = [];
  private listEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private filter = "";
  private fetchSeq = 0;

  constructor(app: App, _plugin: DmScreenPlugin, client: DdbClient, onSelect: (id: string) => void) {
    super(app);
    this.client = client;
    this.onSelect = onSelect;
  }

  async onOpen(): Promise<void> {
    this.modalEl.addClass("dm-ddb-modal");
    this.titleEl.setText("Choose Encounter");
    const { contentEl } = this;
    contentEl.empty();

    const controls = contentEl.createDiv({ cls: "dm-ddb-modal-controls" });
    const input = controls.createEl("input", {
      type: "search",
      cls: "dm-ddb-modal-search",
      attr: { placeholder: "Search encounters…" },
    });
    input.addEventListener("input", () => {
      this.filter = input.value;
      this.renderList();
    });

    this.statusEl = contentEl.createDiv({ cls: "dm-ddb-modal-status" });
    this.listEl = contentEl.createDiv({ cls: "dm-ddb-modal-list" });

    await this.fetchAndRender();
    input.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async fetchAndRender(): Promise<void> {
    const mySeq = ++this.fetchSeq;
    this.setStatus("Loading encounters…");
    debug("DDB Modal: fetch start", mySeq);
    try {
      const list = await this.client.getEncounters();
      if (mySeq !== this.fetchSeq) {
        debug("DDB Modal: discarding stale fetch", mySeq, "current", this.fetchSeq);
        return;
      }
      this.encounters = list;
      this.setStatus(`${list.length} encounter${list.length === 1 ? "" : "s"}`);
      this.renderList();
    } catch (e) {
      if (mySeq !== this.fetchSeq) return;
      const msg = (e as Error).message;
      debugWarn("DDB Modal: fetch failed:", msg);
      this.setStatus(`Failed to load encounters: ${msg}`);
      new Notice(`Failed to load encounters: ${msg}`, 6000);
    }
  }

  private setStatus(text: string): void {
    this.statusEl?.setText(text);
  }

  private renderList(): void {
    if (!this.listEl) return;
    this.listEl.empty();
    const needle = this.filter.trim().toLowerCase();
    const filtered = needle
      ? this.encounters.filter((e) => e.name.toLowerCase().includes(needle))
      : this.encounters;
    if (filtered.length === 0) {
      this.listEl.createDiv({ cls: "dm-ddb-message", text: "No encounters match." });
      return;
    }
    for (const enc of filtered) {
      const row = this.listEl.createDiv({ cls: "dm-ddb-encounter-row" });
      row.createSpan({ cls: "dm-ddb-encounter-name", text: enc.name });
      if (enc.inProgress) row.createSpan({ cls: "dm-ddb-badge", text: "In Progress" });
      row.addEventListener("click", () => {
        debug("DDB Modal: select", enc.id);
        this.onSelect(enc.id);
        this.close();
      });
    }
  }
}
