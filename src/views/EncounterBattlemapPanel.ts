import { ItemView, WorkspaceLeaf, Menu, Notice } from "obsidian";
import type DmScreenPlugin from "../main";

export const ENCOUNTER_BATTLEMAP_VIEW_TYPE = "encounter-battlemap-panel";

interface EncounterCreature {
  name?: string;
  hp?: number;
  currentHP?: number;
  currentMaxHP?: number;
  ac?: number;
  currentAC?: number;
  cr?: string | number;
  initiative?: number;
  modifier?: number;
  hidden?: boolean;
  friendly?: boolean;
  hit_dice?: string;
  enabled?: boolean;
}

interface EncounterData {
  creatures: EncounterCreature[];
  name: string;
  state: boolean;
  round: number;
  roll?: boolean;
  rollHP?: boolean;
}

export class EncounterBattlemapPanel extends ItemView {
  plugin: DmScreenPlugin;
  private expandedEncounter: string | null = null;
  private searchQuery = "";

  constructor(leaf: WorkspaceLeaf, plugin: DmScreenPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return ENCOUNTER_BATTLEMAP_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Encounter Battlemaps";
  }

  getIcon(): string {
    return "swords";
  }

  async onOpen() {
    this.render();
  }

  async onClose() {}

  render() {
    const container = this.contentEl;
    container.empty();
    container.addClass("dm-control-panel");

    const itPlugin = (this.plugin.app as any).plugins?.getPlugin?.("initiative-tracker");
    if (!itPlugin) {
      container.createDiv({ text: "Initiative Tracker plugin not installed", cls: "dm-empty-tracker" });
      return;
    }

    const itData = itPlugin.data || itPlugin.settings;
    const encounters: Record<string, EncounterData> = itData?.encounters || {};
    const encounterNames = Object.keys(encounters);

    if (encounterNames.length === 0) {
      container.createDiv({ text: "No encounters found. Create one in Initiative Tracker.", cls: "dm-empty-tracker" });
      return;
    }

    // Toolbar: search + sync
    const toolbar = container.createDiv("dm-encounter-toolbar");
    const searchInput = toolbar.createEl("input", {
      type: "text",
      placeholder: "Search encounters...",
      cls: "dm-encounter-search",
    });
    searchInput.value = this.searchQuery;
    searchInput.addEventListener("input", () => {
      this.searchQuery = searchInput.value;
      this.render();
    });
    // Re-focus after render
    setTimeout(() => {
      searchInput.focus();
      searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
    }, 0);

    const syncBtn = toolbar.createEl("button", { text: "Sync", cls: "dm-layer-btn" });
    syncBtn.addEventListener("click", () => this.render());

    // Filter by search
    const query = this.searchQuery.toLowerCase();
    const filteredNames = query
      ? encounterNames.filter(n => n.toLowerCase().includes(query))
      : encounterNames;

    if (filteredNames.length === 0) {
      container.createDiv({ text: "No matches", cls: "dm-empty-tracker" });
      return;
    }

    const mapping = this.plugin.settings.encounterBattlemaps;

    for (const name of filteredNames) {
      const encounter = encounters[name];
      const section = container.createDiv("dm-section dm-encounter-card");

      // Header row: name + launch button
      const headerRow = section.createDiv("dm-encounter-header");
      const titleArea = headerRow.createDiv("dm-encounter-title-area");

      const toggleIcon = titleArea.createSpan({
        text: this.expandedEncounter === name ? "▼" : "▶",
        cls: "dm-toggle-icon",
      });

      titleArea.createEl("h3", { text: name });
      titleArea.style.cursor = "pointer";
      titleArea.addEventListener("click", () => {
        this.expandedEncounter = this.expandedEncounter === name ? null : name;
        this.render();
      });

      // Creature count badge
      const creatures = (encounter.creatures || []).filter(c => c.name);
      headerRow.createSpan({
        text: `${creatures.length} creature${creatures.length !== 1 ? "s" : ""}`,
        cls: "dm-encounter-count",
      });

      // Show Map button (battlemap only, no initiative)
      const battlemapPath = mapping[name];
      if (battlemapPath) {
        const showMapBtn = headerRow.createEl("button", { text: "Show Map", cls: "dm-encounter-launch" });
        showMapBtn.addEventListener("click", () => this.showBattlemapOnly(name));
      }

      // Launch button (starts initiative + pushes map)
      const launchBtn = headerRow.createEl("button", { text: "Launch", cls: "mod-cta dm-encounter-launch" });
      launchBtn.addEventListener("click", () => this.launchEncounter(name, encounter));

      // Expanded content
      if (this.expandedEncounter === name) {
        // Battlemap selector
        const mapRow = section.createDiv("dm-encounter-map-row");
        mapRow.createSpan({ text: "Battlemap:", cls: "dm-encounter-field-label" });

        const currentPath = mapping[name] || "";
        const input = mapRow.createEl("input", {
          type: "text",
          placeholder: "Select battlemap...",
          cls: "dm-encounter-map-input",
        });
        input.value = currentPath;

        const browseBtn = mapRow.createEl("button", { text: "Browse", cls: "dm-layer-btn" });
        browseBtn.addEventListener("click", (evt: MouseEvent) => {
          this.showImageBrowser(evt, name, input);
        });

        input.addEventListener("change", async () => {
          if (input.value.trim()) {
            this.plugin.settings.encounterBattlemaps[name] = input.value.trim();
          } else {
            delete this.plugin.settings.encounterBattlemaps[name];
          }
          await this.plugin.saveSettings();
        });

        if (currentPath) {
          const file = this.plugin.app.vault.getAbstractFileByPath(currentPath);
          const indicator = mapRow.createSpan({ cls: "dm-encounter-map-status" });
          indicator.textContent = file ? "✓" : "✗";
          indicator.style.color = file ? "#4caf50" : "#f44336";
        }

        // Creature list
        if (creatures.length > 0) {
          const creatureSection = section.createDiv("dm-encounter-creatures");

          const table = creatureSection.createEl("table", { cls: "dm-creature-table" });
          const thead = table.createEl("thead");
          const headRow = thead.createEl("tr");
          for (const h of ["Name", "CR", "AC", "HP", "Init"]) {
            headRow.createEl("th", { text: h });
          }

          const tbody = table.createEl("tbody");
          for (const c of creatures) {
            const tr = tbody.createEl("tr");
            if (c.hidden) tr.addClass("dm-creature-hidden");
            if (c.friendly) tr.addClass("dm-creature-friendly");

            tr.createEl("td", { text: c.name || "Unknown", cls: "dm-creature-name-cell" });
            tr.createEl("td", { text: c.cr != null ? String(c.cr) : "—" });
            tr.createEl("td", { text: c.ac != null ? String(c.currentAC ?? c.ac) : "—" });
            tr.createEl("td", { text: c.hp != null ? `${c.currentHP ?? c.hp}/${c.currentMaxHP ?? c.hp}` : "—" });
            tr.createEl("td", { text: c.modifier != null ? `${c.modifier >= 0 ? "+" : ""}${c.modifier}` : "—" });
          }
        }
      }
    }

  }

  private showImageBrowser(evt: MouseEvent, encounterName: string, input: HTMLInputElement) {
    const files = this.plugin.app.vault.getFiles()
      .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f.path))
      .sort((a, b) => a.path.localeCompare(b.path));

    const menu = new Menu();
    const battlemapFiles = files.filter(f => f.path.toLowerCase().includes("battlemap"));
    const otherFiles = files.filter(f => !f.path.toLowerCase().includes("battlemap")).slice(0, 20);
    const showFiles = [...battlemapFiles, ...otherFiles];

    for (const file of showFiles) {
      menu.addItem((item) => {
        item.setTitle(file.path);
        item.onClick(async () => {
          input.value = file.path;
          this.plugin.settings.encounterBattlemaps[encounterName] = file.path;
          await this.plugin.saveSettings();
          this.render();
        });
      });
    }
    menu.showAtMouseEvent(evt);
  }

  private async showBattlemapOnly(name: string) {
    const battlemapPath = this.plugin.settings.encounterBattlemaps[name];
    if (!battlemapPath) return;

    const dataUrl = await this.plugin.imageToDataUrl(battlemapPath);
    if (!dataUrl) {
      new Notice("Failed to load battlemap image");
      return;
    }

    const { DM_CONTROL_VIEW_TYPE } = await import("./DmControlPanel");
    const leaves = this.plugin.app.workspace.getLeavesOfType(DM_CONTROL_VIEW_TYPE);
    for (const leaf of leaves) {
      const view = leaf.view as any;
      if (view.addImageLayer) {
        view.addImageLayer(name, dataUrl, "encounter");
      }
    }
    new Notice(`Showing battlemap: ${name}`);
  }

  private async launchEncounter(name: string, encounter: EncounterData) {
    // Launch the encounter in Initiative Tracker
    const itPlugin = (this.plugin.app as any).plugins?.getPlugin?.("initiative-tracker");
    if (itPlugin) {
      // Use the Initiative Tracker API to start the encounter
      this.plugin.app.workspace.trigger("initiative-tracker:start-encounter", encounter);
    }

    // Push battlemap to player screen via image layers
    const battlemapPath = this.plugin.settings.encounterBattlemaps[name];
    if (battlemapPath && this.plugin.server) {
      const dataUrl = await this.plugin.imageToDataUrl(battlemapPath);
      if (dataUrl) {
        // Add as image layer via DM Control Panel
        const { DM_CONTROL_VIEW_TYPE } = await import("./DmControlPanel");
        const leaves = this.plugin.app.workspace.getLeavesOfType(DM_CONTROL_VIEW_TYPE);
        for (const leaf of leaves) {
          const view = leaf.view as any;
          if (view.addImageLayer) {
            view.addImageLayer(name, dataUrl, "encounter");
          }
        }
        new Notice(`Launched "${name}" with battlemap`);
      }
    } else {
      new Notice(`Launched "${name}"`);
    }
  }
}
