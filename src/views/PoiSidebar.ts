import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import type DmScreenPlugin from "../main";

export const POI_SIDEBAR_VIEW_TYPE = "poi-sidebar";

interface PoiEntry {
  name: string;
  type: string;
  placeType: string;
  file: TFile;
  playerVisible: boolean;
  hasSubMap: boolean;
  mapNotePath: string | null;
  description: string;
}

export class PoiSidebar extends ItemView {
  plugin: DmScreenPlugin;
  pois: PoiEntry[] = [];
  filterType: string = "all";
  currentMapPlace: string = "";
  currentPlaceFile: TFile | null = null;
  parentPlaceFile: TFile | null = null;
  parentMapNotePath: string | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: DmScreenPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return POI_SIDEBAR_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "POI Sidebar";
  }

  getIcon(): string {
    return "map-pin";
  }

  async onOpen() {
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.refresh();
      })
    );
    this.registerEvent(
      this.app.metadataCache.on("changed", () => {
        // Re-render when frontmatter changes (e.g. visibility toggle)
        this.refresh();
      })
    );
    this.refresh();
  }

  async onClose() {}

  async refresh() {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      this.renderEmpty();
      return;
    }

    const fm = this.plugin.getFrontmatter(activeFile);
    if (!fm) {
      this.renderEmpty();
      return;
    }

    // Determine which place we're looking at
    let placeFile: TFile | null = null;

    if (fm.type === "map" && fm.place) {
      const placePath = (fm.place as string).replace(/\[\[|\]\]/g, "");
      placeFile = this.plugin.resolveLink(fm.place as string, activeFile.path);
    } else if (fm.type === "place") {
      placeFile = activeFile;
    } else if (fm.type === "person" || fm.type === "faction") {
      // Show POIs for the person's home location
      const homeLink = fm.home as string | undefined;
      if (homeLink) {
        placeFile = this.plugin.resolveLink(homeLink, activeFile.path);
      }
    }

    if (!placeFile) {
      this.renderEmpty();
      return;
    }

    const placeFm = this.plugin.getFrontmatter(placeFile);
    this.currentMapPlace = (placeFm?.name as string) || placeFile.basename;
    this.currentPlaceFile = placeFile;

    // Resolve parent for "go up" navigation
    this.parentPlaceFile = null;
    this.parentMapNotePath = null;
    const parentLink = placeFm?.parent as string | undefined;
    if (parentLink) {
      this.parentPlaceFile = this.plugin.resolveLink(parentLink, placeFile.path);
      if (this.parentPlaceFile) {
        const parentFm = this.plugin.getFrontmatter(this.parentPlaceFile);
        const parentMapNote = parentFm?.["map-note"] as string | undefined;
        if (parentMapNote) {
          const parentMapFile = this.plugin.resolveLink(parentMapNote, this.parentPlaceFile.path);
          this.parentMapNotePath = parentMapFile?.path || null;
        }
      }
    }

    await this.loadPois(placeFile);
    this.render();
  }

  async loadPois(placeFile: TFile) {
    this.pois = [];
    const allFiles = this.app.vault.getMarkdownFiles();

    for (const file of allFiles) {
      const fm = this.plugin.getFrontmatter(file);
      if (!fm || !fm.parent) continue;

      const resolvedParent = this.plugin.resolveLink(fm.parent as string, file.path);

      if (resolvedParent && resolvedParent.path === placeFile.path) {
        // Check if this POI has its own sub-map
        const mapNoteLink = fm["map-note"] as string | undefined;
        let mapNotePath: string | null = null;
        if (mapNoteLink) {
          const mapFile = this.plugin.resolveLink(mapNoteLink, file.path);
          mapNotePath = mapFile?.path || null;
        }

        this.pois.push({
          name: (fm.name as string) || file.basename,
          type: (fm.mapmarker as string) || "poi",
          placeType: (fm["place-type"] as string) || (fm.type as string) || "unknown",
          file,
          playerVisible: fm["player-visible"] !== false,
          hasSubMap: !!mapNotePath,
          mapNotePath,
          description: (fm.description as string) || "",
        });
      }
    }

    this.pois.sort((a, b) => a.name.localeCompare(b.name));
  }

  renderEmpty() {
    const container = this.contentEl;
    container.empty();
    container.createDiv({ cls: "dm-poi-empty", text: "Open a map or place note to see POIs" });
  }

  render() {
    const container = this.contentEl;
    container.empty();
    container.addClass("dm-poi-sidebar");

    // Header with parent nav
    const header = container.createDiv("dm-poi-header");

    // "Go up" button
    if (this.parentPlaceFile) {
      const upBtn = header.createEl("a", {
        cls: "dm-poi-up-btn",
      });
      const parentName = this.plugin.getFrontmatter(this.parentPlaceFile)?.name as string ||
        this.parentPlaceFile.basename;
      upBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg> ${parentName}`;
      upBtn.addEventListener("click", (e) => {
        e.preventDefault();
        if (this.parentMapNotePath) {
          const mapFile = this.app.vault.getAbstractFileByPath(this.parentMapNotePath);
          if (mapFile instanceof TFile) {
            this.app.workspace.getLeaf(false).openFile(mapFile);
            return;
          }
        }
        if (this.parentPlaceFile) {
          this.app.workspace.getLeaf(false).openFile(this.parentPlaceFile);
        }
      });
    }

    header.createEl("h3", { text: this.currentMapPlace });
    header.createEl("small", { text: `${this.pois.length} locations`, cls: "dm-poi-count" });

    // View map button for current place
    if (this.currentPlaceFile) {
      const currentFm = this.plugin.getFrontmatter(this.currentPlaceFile);
      const mapNoteLink = currentFm?.["map-note"] as string | undefined;
      if (mapNoteLink) {
        const viewMapBtn = header.createEl("a", { cls: "dm-poi-view-map-btn" });
        viewMapBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon><line x1="8" y1="2" x2="8" y2="18"></line><line x1="16" y1="6" x2="16" y2="22"></line></svg> View Map`;
        viewMapBtn.addEventListener("click", (e) => {
          e.preventDefault();
          const mapFile = this.plugin.resolveLink(mapNoteLink, this.currentPlaceFile!.path);
          if (mapFile) {
            this.app.workspace.getLeaf(false).openFile(mapFile);
          }
        });
      }
    }

    // Filter buttons
    const filterRow = container.createDiv("dm-filter-row");
    const types = ["all", ...new Set(this.pois.map((p) => p.type))];
    types.forEach((type) => {
      const btn = filterRow.createEl("button", {
        text: type,
        cls: `dm-filter-btn ${this.filterType === type ? "dm-filter-active" : ""}`,
      });
      btn.addEventListener("click", () => {
        this.filterType = type;
        this.render();
      });
    });

    // POI list
    const listEl = container.createDiv("dm-poi-list");
    const filtered =
      this.filterType === "all" ? this.pois : this.pois.filter((p) => p.type === this.filterType);

    if (filtered.length === 0) {
      listEl.createDiv({ cls: "dm-poi-empty", text: "No POIs found" });
      return;
    }

    filtered.forEach((poi) => {
      const row = listEl.createDiv({
        cls: `dm-poi-row ${poi.playerVisible ? "" : "dm-poi-hidden"}`,
      });

      // Marker type icon
      const icon = row.createSpan({ cls: "dm-poi-icon" });
      icon.textContent = this.getMarkerEmoji(poi.type);

      // Name — click to open the place note
      const nameEl = row.createEl("a", {
        text: poi.name,
        cls: "dm-poi-name internal-link",
      });
      nameEl.addEventListener("click", (e) => {
        e.preventDefault();
        this.app.workspace.getLeaf(false).openFile(poi.file);
      });

      // Tooltip with description
      if (poi.description) {
        nameEl.title = poi.description;
      }

      // Place type badge
      row.createSpan({ text: poi.placeType, cls: "dm-poi-type-badge" });

      // DM-only indicator
      if (!poi.playerVisible) {
        row.createSpan({ text: "DM", cls: "dm-poi-dm-only" });
      }

      // Action buttons
      const actions = row.createDiv("dm-poi-actions");

      // Drill-down button — if this POI has its own map
      if (poi.hasSubMap && poi.mapNotePath) {
        const drillBtn = actions.createEl("a", {
          cls: "dm-poi-drill-btn",
          attr: { title: `Open ${poi.name} map` },
        });
        drillBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon><line x1="8" y1="2" x2="8" y2="18"></line><line x1="16" y1="6" x2="16" y2="22"></line></svg>`;
        drillBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const mapFile = this.app.vault.getAbstractFileByPath(poi.mapNotePath!);
          if (mapFile instanceof TFile) {
            this.app.workspace.getLeaf(false).openFile(mapFile);
          }
        });
      }

      // Toggle visibility button
      const visBtn = actions.createEl("a", {
        cls: `dm-poi-vis-btn ${poi.playerVisible ? "dm-vis-on" : "dm-vis-off"}`,
        attr: { title: poi.playerVisible ? "Hide from players" : "Show to players" },
      });
      visBtn.innerHTML = poi.playerVisible
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
      visBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await this.togglePlayerVisibility(poi);
      });
    });
  }

  async togglePlayerVisibility(poi: PoiEntry) {
    const content = await this.app.vault.read(poi.file);
    const newVisibility = !poi.playerVisible;
    const updated = content.replace(
      /player-visible:\s*(true|false)/,
      `player-visible: ${newVisibility}`
    );
    await this.app.vault.modify(poi.file, updated);
    poi.playerVisible = newVisibility;
    // refresh will be triggered by metadata change event
  }

  getMarkerEmoji(type: string): string {
    const map: Record<string, string> = {
      city: "\u{1F3F0}",
      town: "\u{1F3D8}",
      village: "\u{1F3E0}",
      building: "\u{1F3DB}",
      dungeon: "\u{1F573}",
      npc: "\u{1F9D9}",
      quest: "\u{2757}",
      poi: "\u{1F4CD}",
    };
    return map[type] || "\u{1F4CD}";
  }
}
