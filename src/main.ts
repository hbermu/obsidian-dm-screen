import {
  Plugin,
  WorkspaceLeaf,
  MarkdownPostProcessorContext,
  TFile,
  Notice,
} from "obsidian";
import { DmControlPanel, DM_CONTROL_VIEW_TYPE } from "./views/DmControlPanel";
import { PoiSidebar, POI_SIDEBAR_VIEW_TYPE } from "./views/PoiSidebar";
import { EncounterBattlemapPanel, ENCOUNTER_BATTLEMAP_VIEW_TYPE } from "./views/EncounterBattlemapPanel";
import { PlayerScreenServer } from "./server";
import { DmScreenSettingTab, DmScreenSettings, DEFAULT_SETTINGS, type FogRegion } from "./settings";
import type { InitiativeViewState, TrackerCombatant } from "./types";

// Faction zone data sent to the player screen
interface FactionZone {
  name: string;
  color: string;
  points: number[][]; // [[y, x], ...]
}

// Deterministic fallback colors for factions without a color field
const FACTION_PALETTE = [
  "#8B0000", "#006400", "#00008B", "#8B8B00", "#8B008B",
  "#008B8B", "#FF4500", "#2E8B57", "#4169E1", "#DAA520",
  "#9932CC", "#DC143C", "#228B22", "#4682B4", "#CD853F",
];

function defaultFactionColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return FACTION_PALETTE[Math.abs(hash) % FACTION_PALETTE.length];
}

export default class DmScreenPlugin extends Plugin {
  settings: DmScreenSettings = DEFAULT_SETTINGS;
  server: PlayerScreenServer | null = null;

  async onload() {
    await this.loadSettings();

    // Register views
    this.registerView(DM_CONTROL_VIEW_TYPE, (leaf) => new DmControlPanel(leaf, this));
    this.registerView(POI_SIDEBAR_VIEW_TYPE, (leaf) => new PoiSidebar(leaf, this));
    this.registerView(ENCOUNTER_BATTLEMAP_VIEW_TYPE, (leaf) => new EncounterBattlemapPanel(leaf, this));

    // Register markdown post-processor for navigation elements
    this.registerMarkdownPostProcessor(this.addNavigationElements.bind(this));

    // Commands
    this.addCommand({
      id: "open-dm-control-panel",
      name: "Open DM Control Panel",
      callback: () => this.activateView(DM_CONTROL_VIEW_TYPE),
    });

    this.addCommand({
      id: "open-poi-sidebar",
      name: "Open POI Sidebar",
      callback: () => this.activateView(POI_SIDEBAR_VIEW_TYPE),
    });

    this.addCommand({
      id: "open-encounter-battlemaps",
      name: "Open Encounter Battlemaps",
      callback: () => this.activateView(ENCOUNTER_BATTLEMAP_VIEW_TYPE),
    });

    this.addCommand({
      id: "push-to-player-screen",
      name: "Push current note to Player Screen",
      callback: () => this.pushCurrentNoteToPlayerScreen(),
    });

    this.addCommand({
      id: "open-map-for-place",
      name: "Open map for current place",
      callback: () => this.openMapForCurrentPlace(),
    });

    this.addCommand({
      id: "open-parent-map",
      name: "Go to parent map",
      callback: () => this.openParentMap(),
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
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  startServer() {
    if (this.server) return;
    this.server = new PlayerScreenServer(this);
    this.server.onClientInfo = (info) => this.onPlayerClientInfo(info);
    this.server.onClientCountChanged = () => {
      const leaves = this.app.workspace.getLeavesOfType(DM_CONTROL_VIEW_TYPE);
      for (const leaf of leaves) {
        const view = leaf.view as DmControlPanel;
        view.debouncedRender?.();
      }
    };
    this.server.start(this.settings.serverPort);
    new Notice(`Player Screen server started on port ${this.settings.serverPort}`);
  }

  private onPlayerClientInfo(info: { width: number; height: number; devicePixelRatio: number }) {
    const leaves = this.app.workspace.getLeavesOfType(DM_CONTROL_VIEW_TYPE);
    for (const leaf of leaves) {
      const view = leaf.view as DmControlPanel;
      if (view.onPlayerConnected) {
        view.onPlayerConnected(info);
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

  // ─── Navigation Elements (MarkdownPostProcessor) ───────────────────

  addNavigationElements(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
    const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!(file instanceof TFile)) return;

    const metadata = this.app.metadataCache.getFileCache(file);
    const fm = metadata?.frontmatter;
    if (!fm) return;

    const firstH1 = el.querySelector("h1");
    if (!firstH1) return;

    if (fm.type === "map") {
      this.injectMapNavigation(el, firstH1, file, fm);
    } else if (fm.type === "place") {
      this.injectPlaceNavigation(el, firstH1, file, fm);
    }
  }

  // Inject breadcrumbs on map notes
  private injectMapNavigation(
    el: HTMLElement,
    firstH1: Element,
    file: TFile,
    fm: Record<string, unknown>
  ) {
    const navBar = document.createElement("div");
    navBar.className = "dm-nav-bar";

    // Breadcrumbs
    const breadcrumbEl = document.createElement("div");
    breadcrumbEl.className = "dm-map-breadcrumbs";
    navBar.appendChild(breadcrumbEl);

    this.buildBreadcrumbs(file, fm).then((crumbs) => {
      crumbs.forEach((crumb, i) => {
        if (i > 0) {
          const sep = document.createElement("span");
          sep.className = "dm-breadcrumb-sep";
          sep.textContent = " / ";
          breadcrumbEl.appendChild(sep);
        }

        const isLast = i === crumbs.length - 1;
        if (isLast) {
          const current = document.createElement("span");
          current.className = "dm-breadcrumb-current";
          current.textContent = crumb.name;
          breadcrumbEl.appendChild(current);
        } else {
          const link = document.createElement("a");
          link.className = "dm-breadcrumb-link internal-link";
          link.textContent = crumb.name;
          link.dataset.href = crumb.path;
          link.addEventListener("click", (e) => {
            e.preventDefault();
            this.openFilePath(crumb.path);
          });
          breadcrumbEl.appendChild(link);
        }
      });
    });

    firstH1.parentElement?.insertBefore(navBar, firstH1);
  }

  // Inject breadcrumbs + "View Map" banner + "Back to parent map" on place notes
  private injectPlaceNavigation(
    el: HTMLElement,
    firstH1: Element,
    file: TFile,
    fm: Record<string, unknown>
  ) {
    const navBar = document.createElement("div");
    navBar.className = "dm-nav-bar";

    // Breadcrumbs (parent hierarchy)
    const breadcrumbEl = document.createElement("div");
    breadcrumbEl.className = "dm-place-breadcrumbs";
    navBar.appendChild(breadcrumbEl);

    this.buildPlaceBreadcrumbs(file, fm).then((crumbs) => {
      if (crumbs.length === 0) return;

      crumbs.forEach((crumb, i) => {
        if (i > 0) {
          const sep = document.createElement("span");
          sep.className = "dm-breadcrumb-sep";
          sep.textContent = " / ";
          breadcrumbEl.appendChild(sep);
        }

        const isLast = i === crumbs.length - 1;
        if (isLast) {
          const current = document.createElement("span");
          current.className = "dm-breadcrumb-current";
          current.textContent = crumb.name;
          breadcrumbEl.appendChild(current);
        } else {
          const link = document.createElement("a");
          link.className = "dm-breadcrumb-link internal-link";
          link.textContent = crumb.name;
          link.addEventListener("click", (e) => {
            e.preventDefault();
            this.openFilePath(crumb.path);
          });
          breadcrumbEl.appendChild(link);
        }
      });
    });

    // Action buttons row
    const actionsEl = document.createElement("div");
    actionsEl.className = "dm-place-actions";
    navBar.appendChild(actionsEl);

    // "View Map" button — if this place has its own map
    const mapNoteLink = fm["map-note"] as string | undefined;
    if (mapNoteLink) {
      const viewMapBtn = document.createElement("a");
      viewMapBtn.className = "dm-action-btn dm-view-map-btn";
      viewMapBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon><line x1="8" y1="2" x2="8" y2="18"></line><line x1="16" y1="6" x2="16" y2="22"></line></svg> View Map`;
      viewMapBtn.addEventListener("click", (e) => {
        e.preventDefault();
        const mapPath = mapNoteLink.replace(/\[\[|\]\]/g, "");
        const mapFile = this.app.metadataCache.getFirstLinkpathDest(mapPath, file.path);
        if (mapFile) {
          this.app.workspace.getLeaf(false).openFile(mapFile);
        }
      });
      actionsEl.appendChild(viewMapBtn);
    }

    // "Parent Map" button — go to parent place's map
    const parentLink = fm.parent as string | undefined;
    if (parentLink) {
      const parentPath = parentLink.replace(/\[\[|\]\]/g, "");
      const parentFile = this.app.metadataCache.getFirstLinkpathDest(parentPath, file.path);
      if (parentFile) {
        const parentMeta = this.app.metadataCache.getFileCache(parentFile);
        const parentFm = parentMeta?.frontmatter;
        const parentMapNote = parentFm?.["map-note"] as string | undefined;

        if (parentMapNote) {
          const parentMapBtn = document.createElement("a");
          parentMapBtn.className = "dm-action-btn dm-parent-map-btn";
          const parentName = parentFm?.name || parentFile.basename;
          parentMapBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg> ${parentName} Map`;
          parentMapBtn.addEventListener("click", (e) => {
            e.preventDefault();
            const pmPath = parentMapNote.replace(/\[\[|\]\]/g, "");
            const pmFile = this.app.metadataCache.getFirstLinkpathDest(pmPath, parentFile.path);
            if (pmFile) {
              this.app.workspace.getLeaf(false).openFile(pmFile);
            }
          });
          actionsEl.appendChild(parentMapBtn);
        }
      }
    }

    // Only insert if we have something to show
    if (breadcrumbEl.childElementCount > 0 || actionsEl.childElementCount > 0) {
      firstH1.parentElement?.insertBefore(navBar, firstH1);
    }
  }

  // ─── Breadcrumb builders ───────────────────────────────────────────

  // For map notes: walk up from the linked place
  async buildBreadcrumbs(
    mapFile: TFile,
    mapFrontmatter: Record<string, unknown>
  ): Promise<Array<{ name: string; path: string }>> {
    const placeLink = mapFrontmatter.place as string | undefined;
    if (!placeLink) return [];

    const placePath = placeLink.replace(/\[\[|\]\]/g, "");
    const placeFile = this.app.metadataCache.getFirstLinkpathDest(placePath, mapFile.path);
    if (!placeFile) return [];

    const placeMeta = this.app.metadataCache.getFileCache(placeFile);
    const placeFm = placeMeta?.frontmatter;
    if (!placeFm) return [{ name: placeFile.basename, path: mapFile.path }];

    return this.walkParentChain(placeFile, placeFm, true);
  }

  // For place notes: walk up from the current place
  async buildPlaceBreadcrumbs(
    placeFile: TFile,
    placeFm: Record<string, unknown>
  ): Promise<Array<{ name: string; path: string }>> {
    return this.walkParentChain(placeFile, placeFm, false);
  }

  // Shared: walk up the parent chain, building breadcrumb entries
  // If useMapLinks=true, breadcrumbs link to map notes; otherwise to place notes
  private walkParentChain(
    startFile: TFile,
    startFm: Record<string, unknown>,
    useMapLinks: boolean
  ): Array<{ name: string; path: string }> {
    const crumbs: Array<{ name: string; path: string }> = [];
    let currentFile: TFile | null = startFile;
    let currentFm: Record<string, unknown> | undefined = startFm;

    const visited = new Set<string>();
    while (currentFile && !visited.has(currentFile.path)) {
      visited.add(currentFile.path);
      const name = (currentFm?.name as string) || currentFile.basename;

      let linkPath = currentFile.path;
      if (useMapLinks) {
        const mapNoteLink = currentFm?.["map-note"] as string | undefined;
        if (mapNoteLink) {
          const mapNoteFile = this.app.metadataCache.getFirstLinkpathDest(
            mapNoteLink.replace(/\[\[|\]\]/g, ""),
            currentFile.path
          );
          if (mapNoteFile) linkPath = mapNoteFile.path;
        }
      }

      crumbs.unshift({ name, path: linkPath });

      // Go to parent
      const parentLink = currentFm?.parent as string | undefined;
      if (!parentLink) break;
      const parentPath = parentLink.replace(/\[\[|\]\]/g, "");
      currentFile = this.app.metadataCache.getFirstLinkpathDest(parentPath, currentFile.path);
      if (currentFile) {
        const meta = this.app.metadataCache.getFileCache(currentFile);
        currentFm = meta?.frontmatter;
      }
    }

    return crumbs;
  }

  // ─── File navigation helpers ───────────────────────────────────────

  private openFilePath(path: string) {
    const targetFile = this.app.vault.getAbstractFileByPath(path);
    if (targetFile instanceof TFile) {
      this.app.workspace.getLeaf(false).openFile(targetFile);
    }
  }

  // Navigate from a Place note to its Map note
  async openMapForCurrentPlace() {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) return;

    const metadata = this.app.metadataCache.getFileCache(activeFile);
    const frontmatter = metadata?.frontmatter;
    if (!frontmatter) return;

    const mapNote = frontmatter["map-note"];
    if (!mapNote) {
      new Notice("This place has no associated map");
      return;
    }

    const mapPath = mapNote.replace(/\[\[|\]\]/g, "");
    const mapFile = this.app.metadataCache.getFirstLinkpathDest(mapPath, activeFile.path);
    if (mapFile) {
      await this.app.workspace.getLeaf(false).openFile(mapFile);
    } else {
      new Notice(`Map note "${mapPath}" not found`);
    }
  }

  // Navigate from current note to the parent's map
  async openParentMap() {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) return;

    const metadata = this.app.metadataCache.getFileCache(activeFile);
    const fm = metadata?.frontmatter;
    if (!fm) return;

    // If we're on a map note, resolve its place first then get the place's parent
    let placeFile: TFile | null = null;
    if (fm.type === "map" && fm.place) {
      const placePath = (fm.place as string).replace(/\[\[|\]\]/g, "");
      placeFile = this.app.metadataCache.getFirstLinkpathDest(placePath, activeFile.path);
    } else if (fm.type === "place") {
      placeFile = activeFile;
    }

    if (!placeFile) {
      new Notice("Cannot determine parent from this note");
      return;
    }

    const placeMeta = this.app.metadataCache.getFileCache(placeFile);
    const placeFm = placeMeta?.frontmatter;
    const parentLink = placeFm?.parent as string | undefined;
    if (!parentLink) {
      new Notice("This is the top-level location");
      return;
    }

    const parentPath = parentLink.replace(/\[\[|\]\]/g, "");
    const parentFile = this.app.metadataCache.getFirstLinkpathDest(parentPath, placeFile.path);
    if (!parentFile) {
      new Notice("Parent place not found");
      return;
    }

    const parentMeta = this.app.metadataCache.getFileCache(parentFile);
    const parentMapNote = parentMeta?.frontmatter?.["map-note"] as string | undefined;
    if (parentMapNote) {
      const mapPath = parentMapNote.replace(/\[\[|\]\]/g, "");
      const mapFile = this.app.metadataCache.getFirstLinkpathDest(mapPath, parentFile.path);
      if (mapFile) {
        await this.app.workspace.getLeaf(false).openFile(mapFile);
        return;
      }
    }

    // Fallback: open the parent place note
    await this.app.workspace.getLeaf(false).openFile(parentFile);
  }

  // ─── Resolve helpers (exported for use by other views) ─────────────

  resolveLink(linkStr: string, sourcePath: string): TFile | null {
    const cleanPath = linkStr.replace(/\[\[|\]\]/g, "");
    return this.app.metadataCache.getFirstLinkpathDest(cleanPath, sourcePath);
  }

  getFrontmatter(file: TFile): Record<string, unknown> | undefined {
    return this.app.metadataCache.getFileCache(file)?.frontmatter;
  }

  // ─── Player Screen ────────────────────────────────────────────────

  async pushCurrentNoteToPlayerScreen() {
    if (!this.server) {
      new Notice("Player Screen server is not running. Start it first.");
      return;
    }

    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice("No active file");
      return;
    }

    const metadata = this.app.metadataCache.getFileCache(activeFile);
    const frontmatter = metadata?.frontmatter;
    if (!frontmatter) {
      new Notice("No frontmatter found in active file");
      return;
    }

    if (frontmatter.type === "map") {
      const placeLink = frontmatter.place;
      const placeFile = placeLink
        ? this.resolveLink(placeLink as string, activeFile.path)
        : null;

      let mapImage = "";
      let mapBounds = [0, 0, 1000, 1000];
      let markers: Array<{ name: string; location: number[]; type: string; link: string }> = [];
      let factionZones: FactionZone[] = [];
      let fogOfWar = false;

      if (placeFile) {
        const placeFm = this.getFrontmatter(placeFile);
        if (placeFm) {
          mapImage = (placeFm["map-image"] as string) || "";
          mapBounds = (placeFm["map-bounds"] as number[]) || mapBounds;
          fogOfWar = (placeFm["fogOfWar"] as boolean) === true;
          const result = await this.getChildMarkers(placeFile);
          markers = result.markers;
          factionZones = result.factionZones;
        }
      }

      // Fallback: parse leaflet codeblock for image and bounds
      if (!mapImage) {
        const content = await this.app.vault.read(activeFile);
        const leafletMatch = content.match(/```leaflet\n([\s\S]*?)```/);
        if (leafletMatch) {
          const block = leafletMatch[1];
          const imageMatch = block.match(/image:\s*\[\[(.+?)\]\]/);
          if (imageMatch) {
            const resolved = this.app.metadataCache.getFirstLinkpathDest(imageMatch[1], activeFile.path);
            if (resolved) mapImage = resolved.path;
          }
          const boundsMatch = block.match(/bounds:\s*\[\[(\d+)\s*,\s*(\d+)\]\s*,\s*\[(\d+)\s*,\s*(\d+)\]\]/);
          if (boundsMatch) {
            mapBounds = [
              parseInt(boundsMatch[1]), parseInt(boundsMatch[2]),
              parseInt(boundsMatch[3]), parseInt(boundsMatch[4]),
            ];
          }
        }
      }

      let imageDataUrl = "";
      if (mapImage) {
        imageDataUrl = await this.imageToDataUrl(mapImage);
      }

      const mapName = (frontmatter.name as string) || activeFile.basename;
      const fogRevealed = fogOfWar ? (this.settings.fogOfWarState[mapName] || []) : [];

      this.server.broadcast({
        type: "show-map",
        payload: {
          name: mapName,
          image: imageDataUrl,
          bounds: mapBounds,
          markers: markers.filter((m) => m.location),
          factionZones,
          factionZoneOpacity: this.settings.factionZoneOpacity,
          showFactionZones: this.settings.showFactionZonesByDefault,
          fogOfWar,
          fogRevealed,
        },
      });

      // Notify DM Control Panel about active fog state
      if (fogOfWar) {
        const leaves = this.app.workspace.getLeavesOfType(DM_CONTROL_VIEW_TYPE);
        for (const leaf of leaves) {
          const view = leaf.view as DmControlPanel;
          if (view.setFogOfWarState) {
            view.setFogOfWarState(mapName, mapBounds, fogRevealed);
          }
        }
      }

      new Notice("Map pushed to Player Screen");
    } else if (frontmatter.type === "encounter") {
      const battlemapPath = (frontmatter.battlemap as string) || "";
      let imageDataUrl = "";
      if (battlemapPath) {
        imageDataUrl = await this.imageToDataUrl(battlemapPath);
      }

      this.server.broadcast({
        type: "show-battlemap",
        payload: {
          name: frontmatter.name || activeFile.basename,
          image: imageDataUrl,
          gridSize: frontmatter["grid-size"] || 5,
          gridType: frontmatter["grid-type"] || "square",
          creatures: frontmatter.creatures || [],
        },
      });
      new Notice("Battlemap pushed to Player Screen");
    } else {
      new Notice("Current note is not a map or encounter");
    }
  }

  async getChildMarkers(
    placeFile: TFile
  ): Promise<{
    markers: Array<{ name: string; location: number[]; type: string; link: string }>;
    factionZones: FactionZone[];
  }> {
    const markers: Array<{ name: string; location: number[]; type: string; link: string }> = [];
    // Build faction zones: group POI locations by faction
    const factionMap = new Map<string, { color: string; points: number[][] }>();
    const allFiles = this.app.vault.getMarkdownFiles();

    for (const file of allFiles) {
      const fm = this.getFrontmatter(file);
      if (!fm) continue;
      if (!fm.location || !Array.isArray(fm.location)) continue;

      const parentLink = fm.parent as string | undefined;
      if (!parentLink) continue;

      const resolvedParent = this.resolveLink(parentLink, file.path);
      if (resolvedParent && resolvedParent.path === placeFile.path) {
        if (fm["player-visible"] !== false) {
          markers.push({
            name: (fm.name as string) || file.basename,
            location: fm.location as number[],
            type: (fm.mapmarker as string) || "poi",
            link: file.basename,
          });
        }

        // Resolve faction for this POI (even if not player-visible, factions still define territory)
        const factionLink = (fm.faction as string) ||
          (Array.isArray(fm.factions) && fm.factions.length > 0 ? fm.factions[0] as string : null);

        if (factionLink) {
          const factionFile = this.resolveLink(factionLink, file.path);
          const factionName = factionFile
            ? (this.getFrontmatter(factionFile)?.name as string || factionFile.basename)
            : factionLink.replace(/\[\[|\]\]/g, "");

          if (!factionMap.has(factionName)) {
            const color = this.getFactionColor(factionFile, factionName);
            factionMap.set(factionName, { color, points: [] });
          }
          factionMap.get(factionName)!.points.push(fm.location as number[]);
        }
      }
    }

    const factionZones: FactionZone[] = [];
    for (const [name, data] of factionMap) {
      if (data.points.length > 0) {
        factionZones.push({ name, color: data.color, points: data.points });
      }
    }

    return { markers, factionZones };
  }

  private getFactionColor(factionFile: TFile | null, factionName: string): string {
    if (factionFile) {
      const fm = this.getFrontmatter(factionFile);
      if (fm?.color && typeof fm.color === "string") {
        return fm.color;
      }
    }
    return defaultFactionColor(factionName);
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

  // ─── Fog of War ─────────────────────────────────────────────────

  broadcastFogUpdate(mapName: string, revealed: FogRegion[]) {
    if (!this.server) return;
    this.server.broadcast({
      type: "fog-update",
      payload: { revealed },
    });
    // Persist fog state
    this.settings.fogOfWarState[mapName] = revealed;
    this.saveSettings();
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
