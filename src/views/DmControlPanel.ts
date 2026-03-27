import { ItemView, WorkspaceLeaf, Notice, TFile } from "obsidian";
import type DmScreenPlugin from "../main";
import type { TrackerCombatant, ImageLayer } from "../types";
import { renderStatblock } from "./StatblockPanel";

export const DM_CONTROL_VIEW_TYPE = "dm-control-panel";

interface ManualCombatant {
  name: string;
  hp: number;
  maxHp: number;
  initiative: number;
  active: boolean;
}

export class DmControlPanel extends ItemView {
  plugin: DmScreenPlugin;
  mode: "exploration" | "combat" = "exploration";

  // Manual initiative state
  manualCombatants: ManualCombatant[] = [];
  currentTurn = 0;

  // Plugin-synced initiative state
  trackerSource: "manual" | "plugin" = "manual";
  pluginCombatants: TrackerCombatant[] = [];
  pluginRound = 0;
  encounterName = "";

  // Image layers state
  imageLayers: ImageLayer[] = [];
  private nextZIndex = 1;
  private activeVideoPath: string | null = null;
  private static LAYER_COLORS = [
    "#e74c3c", "#3498db", "#2ecc71", "#f39c12",
    "#9b59b6", "#1abc9c", "#e67e22", "#34495e",
  ];

  // UI state
  expandedCreature: string | null = null;
  private renderDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: DmScreenPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return DM_CONTROL_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "DM Control Panel";
  }

  getIcon(): string {
    return "monitor";
  }

  async onOpen() {
    this.render();
  }

  async onClose() {}

  // Called from main.ts when Initiative Tracker fires save-state
  syncFromInitiativeTracker(combatants: TrackerCombatant[], round: number, encounterName: string) {
    this.trackerSource = "plugin";
    this.pluginCombatants = combatants;
    this.pluginRound = round;
    this.encounterName = encounterName;

    // Auto-switch to combat mode
    if (this.mode !== "combat") {
      this.mode = "combat";
    }

    // Preserve expanded creature if still present
    if (this.expandedCreature) {
      const stillExists = combatants.some(c => c.name === this.expandedCreature);
      if (!stillExists) this.expandedCreature = null;
    }

    this.debouncedRender();
  }

  // Called from main.ts when Initiative Tracker stops
  disconnectFromTracker() {
    this.trackerSource = "manual";
    this.pluginCombatants = [];
    this.pluginRound = 0;
    this.encounterName = "";
    this.expandedCreature = null;
    this.render();
  }

  private debouncedRender() {
    if (this.renderDebounceTimer) clearTimeout(this.renderDebounceTimer);
    this.renderDebounceTimer = setTimeout(() => this.render(), 100);
  }

  render() {
    const container = this.contentEl;
    container.empty();
    container.addClass("dm-control-panel");

    this.renderServerSection(container);
    this.renderPushSection(container);
    this.renderImageLayersSection(container);
    this.renderModeSection(container);

    if (this.mode === "combat") {
      this.renderInitiativeSection(container);
    }
  }

  // ─── Server Section ─────────────────────────────────────────────────

  private renderServerSection(container: HTMLElement) {
    const section = container.createDiv("dm-section");
    section.createEl("h3", { text: "Player Screen Server" });

    const isRunning = !!this.plugin.server;
    const statusEl = section.createDiv("dm-server-status");
    statusEl.createSpan({
      text: isRunning ? "Running" : "Stopped",
      cls: isRunning ? "dm-status-on" : "dm-status-off",
    });

    if (isRunning) {
      statusEl.createSpan({
        text: ` on port ${this.plugin.settings.serverPort}`,
        cls: "dm-status-detail",
      });

      const url = `http://localhost:${this.plugin.settings.serverPort}`;
      const urlRow = section.createDiv("dm-server-url");
      const urlLink = urlRow.createEl("a", {
        text: url,
        href: url,
        cls: "dm-server-url-link",
      });
      urlLink.setAttr("target", "_blank");

      const copyBtn = urlRow.createEl("button", {
        text: "Copy",
        cls: "dm-copy-url-btn",
      });
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(url);
        copyBtn.textContent = "Copied!";
        setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
      });
    }

    const serverBtn = section.createEl("button", {
      text: isRunning ? "Stop Server" : "Start Server",
      cls: "mod-cta",
    });
    serverBtn.addEventListener("click", () => {
      this.plugin.toggleServer();
      this.render();
    });
  }

  // ─── Push Section ───────────────────────────────────────────────────

  private renderPushSection(container: HTMLElement) {
    const section = container.createDiv("dm-section");
    section.createEl("h3", { text: "Push Content" });

    const pushBtn = section.createEl("button", {
      text: "Push Current Note to Player Screen",
      cls: "mod-cta",
    });
    pushBtn.addEventListener("click", () => {
      this.plugin.pushCurrentNoteToPlayerScreen();
    });

    const clearBtn = section.createEl("button", { text: "Clear Player Screen" });
    clearBtn.addEventListener("click", () => {
      if (this.plugin.server) {
        this.plugin.server.broadcast({ type: "clear", payload: {} });
        this.imageLayers = [];
        this.nextZIndex = 1;
        new Notice("Player screen cleared");
        this.render();
      }
    });
  }

  // ─── Mode Section ──────────────────────────────────────────────────

  private renderModeSection(container: HTMLElement) {
    const section = container.createDiv("dm-section");
    section.createEl("h3", { text: "Mode" });

    const modeRow = section.createDiv("dm-mode-row");

    const explorationBtn = modeRow.createEl("button", {
      text: "Exploration",
      cls: this.mode === "exploration" ? "mod-cta" : "",
    });
    explorationBtn.addEventListener("click", () => {
      this.mode = "exploration";
      if (this.plugin.server) {
        this.plugin.server.broadcast({ type: "set-mode", payload: { mode: "exploration" } });
      }
      this.render();
    });

    const combatBtn = modeRow.createEl("button", {
      text: "Combat",
      cls: this.mode === "combat" ? "mod-cta" : "",
    });
    combatBtn.addEventListener("click", () => {
      this.mode = "combat";
      if (this.plugin.server) {
        this.plugin.server.broadcast({ type: "set-mode", payload: { mode: "combat" } });
      }
      this.render();
    });
  }

  // ─── Initiative Section ────────────────────────────────────────────

  private renderInitiativeSection(container: HTMLElement) {
    const section = container.createDiv("dm-section");

    if (this.trackerSource === "plugin") {
      this.renderPluginTracker(section);
    } else {
      this.renderManualTracker(section);
    }
  }

  // ─── Plugin-Synced Tracker ─────────────────────────────────────────

  private renderPluginTracker(section: HTMLElement) {
    // Header with sync indicator
    const headerRow = section.createDiv("dm-tracker-header");
    const titleCol = headerRow.createDiv("dm-tracker-title-col");
    titleCol.createEl("h3", { text: "Initiative Tracker" });

    const syncBadge = titleCol.createDiv("dm-tracker-sync-badge");
    syncBadge.createSpan({ text: "Synced", cls: "dm-sync-indicator" });
    if (this.encounterName) {
      syncBadge.createSpan({ text: ` — ${this.encounterName}`, cls: "dm-status-detail" });
    }

    const roundBadge = headerRow.createDiv("dm-round-badge");
    roundBadge.textContent = `Round ${this.pluginRound}`;

    // Disconnect button
    const disconnectBtn = section.createEl("button", {
      text: "Disconnect",
      cls: "dm-disconnect-btn",
    });
    disconnectBtn.addEventListener("click", () => {
      this.disconnectFromTracker();
    });

    // Combatant list
    const listEl = section.createDiv("dm-initiative-list");

    if (this.pluginCombatants.length === 0) {
      listEl.createDiv({ text: "No combatants", cls: "dm-empty-tracker" });
      return;
    }

    for (const c of this.pluginCombatants) {
      this.renderPluginCombatantRow(listEl, c);
    }
  }

  private renderPluginCombatantRow(listEl: HTMLElement, c: TrackerCombatant) {
    const rowClasses = ["dm-combatant-row"];
    if (c.active) rowClasses.push("dm-active-turn");
    if (c.hidden) rowClasses.push("dm-combatant-hidden");
    if (c.friendly || c.isPlayer) rowClasses.push("dm-combatant-friendly");

    const wrapper = listEl.createDiv("dm-combatant-wrapper");
    const row = wrapper.createDiv({ cls: rowClasses.join(" ") });

    // Initiative number
    row.createSpan({ text: `${c.initiative}`, cls: "dm-init-num" });

    // Name
    const nameEl = row.createSpan({ text: c.displayName, cls: "dm-combatant-name" });
    if (c.isPlayer) {
      nameEl.createSpan({ text: " (PC)", cls: "dm-pc-badge" });
    }
    if (c.hidden) {
      nameEl.createSpan({ text: " [hidden]", cls: "dm-hidden-badge" });
    }

    // Status badges
    if (c.statuses.length > 0) {
      const statusRow = row.createDiv("dm-status-badges");
      for (const status of c.statuses) {
        statusRow.createSpan({ text: status, cls: "dm-status-badge" });
      }
    }

    // HP display (read-only)
    const hpPercent = c.maxHp > 0 ? Math.max(0, Math.min(100, (c.hp / c.maxHp) * 100)) : 100;
    const hpColor = hpPercent > 50 ? "#4caf50" : hpPercent > 25 ? "#ff9800" : "#f44336";

    const hpContainer = row.createDiv("dm-hp-display");
    const hpBar = hpContainer.createDiv("dm-hp-bar-inline");
    const hpFill = hpBar.createDiv("dm-hp-fill-inline");
    hpFill.style.width = `${hpPercent}%`;
    hpFill.style.background = hpColor;

    hpContainer.createSpan({
      text: `${c.hp}/${c.maxHp}${c.tempHp > 0 ? ` +${c.tempHp}` : ""}`,
      cls: "dm-hp-text",
    });

    // AC
    row.createSpan({ text: `AC ${c.ac}`, cls: "dm-ac-display" });

    // Expand button for statblock
    const expandBtn = row.createEl("button", {
      text: this.expandedCreature === c.name ? "▼" : "▶",
      cls: "dm-expand-btn",
    });
    expandBtn.addEventListener("click", () => {
      this.expandedCreature = this.expandedCreature === c.name ? null : c.name;
      this.render();
    });

    // Expanded statblock panel
    if (this.expandedCreature === c.name) {
      const statblockContainer = wrapper.createDiv("dm-statblock-container");
      if (c.statblock) {
        renderStatblock(statblockContainer, c.statblock);
      } else {
        statblockContainer.createDiv({
          text: "Statblock not found in bestiary",
          cls: "dm-statblock-not-found",
        });
      }
    }
  }

  // ─── Manual Tracker ────────────────────────────────────────────────

  private renderManualTracker(section: HTMLElement) {
    section.createEl("h3", { text: "Initiative Tracker" });

    // Hint about auto-sync
    const hasInitiativeTracker = !!(this.plugin.app as any).plugins?.getPlugin?.("initiative-tracker");
    if (hasInitiativeTracker) {
      const hint = section.createDiv("dm-tracker-hint");
      hint.textContent = "Start an encounter in Initiative Tracker to auto-sync";
    }

    // Add combatant form
    const addRow = section.createDiv("dm-add-combatant");
    const nameInput = addRow.createEl("input", { type: "text", placeholder: "Name" });
    const initInput = addRow.createEl("input", { type: "number", placeholder: "Init" });
    initInput.style.width = "60px";
    const hpInput = addRow.createEl("input", { type: "number", placeholder: "HP" });
    hpInput.style.width = "60px";

    const addBtn = addRow.createEl("button", { text: "+", cls: "mod-cta" });
    addBtn.addEventListener("click", () => {
      const name = nameInput.value.trim();
      const initiative = parseInt(initInput.value) || 0;
      const hp = parseInt(hpInput.value) || 0;
      if (name) {
        this.manualCombatants.push({ name, initiative, hp, maxHp: hp, active: false });
        this.sortManualCombatants();
        this.broadcastManualInitiative();
        this.render();
      }
    });

    // Combatant list
    const listEl = section.createDiv("dm-initiative-list");
    this.manualCombatants.forEach((c, i) => {
      const row = listEl.createDiv({
        cls: `dm-combatant-row ${c.active ? "dm-active-turn" : ""}`,
      });

      row.createSpan({ text: `${c.initiative}`, cls: "dm-init-num" });
      row.createSpan({ text: c.name, cls: "dm-combatant-name" });

      const hpEl = row.createEl("input", { type: "number", cls: "dm-hp-input" });
      hpEl.value = String(c.hp);
      hpEl.style.width = "60px";
      hpEl.addEventListener("change", () => {
        c.hp = parseInt(hpEl.value) || 0;
        this.broadcastManualInitiative();
      });

      row.createSpan({ text: `/ ${c.maxHp}`, cls: "dm-hp-max" });

      const removeBtn = row.createEl("button", { text: "x", cls: "dm-remove-btn" });
      removeBtn.addEventListener("click", () => {
        this.manualCombatants.splice(i, 1);
        this.broadcastManualInitiative();
        this.render();
      });
    });

    // Turn controls
    if (this.manualCombatants.length > 0) {
      const turnRow = section.createDiv("dm-turn-controls");

      const nextBtn = turnRow.createEl("button", { text: "Next Turn", cls: "mod-cta" });
      nextBtn.addEventListener("click", () => this.advanceManualTurn());

      const resetBtn = turnRow.createEl("button", { text: "Reset Round" });
      resetBtn.addEventListener("click", () => {
        this.currentTurn = 0;
        this.manualCombatants.forEach(c => (c.active = false));
        if (this.manualCombatants.length > 0) this.manualCombatants[0].active = true;
        this.broadcastManualInitiative();
        this.render();
      });

      const clearAllBtn = turnRow.createEl("button", { text: "Clear All" });
      clearAllBtn.addEventListener("click", () => {
        this.manualCombatants = [];
        this.currentTurn = 0;
        this.broadcastManualInitiative();
        this.render();
      });
    }
  }

  // ─── Image Layers Section ─────────────────────────────────────────

  private renderImageLayersSection(container: HTMLElement) {
    const section = container.createDiv("dm-section");
    section.createEl("h3", { text: "Image Layers" });

    // Button row
    const btnRow = section.createDiv("dm-layer-btn-row");

    const addBtn = btnRow.createEl("button", {
      text: "Add Image",
      cls: "mod-cta",
    });
    addBtn.addEventListener("click", (evt: MouseEvent) => this.showImagePicker(evt));

    const videoBtnLabel = this.activeVideoPath ? "Stop Video BG" : "Video BG";
    const videoBtn = btnRow.createEl("button", { text: videoBtnLabel });
    videoBtn.addEventListener("click", (evt: MouseEvent) => {
      if (this.activeVideoPath) {
        // Stop video
        this.activeVideoPath = null;
        if (this.plugin.server) {
          this.plugin.server.broadcast({ type: "hide-video-bg", payload: {} });
        }
        this.render();
      } else {
        // Browse for video files
        const files = this.plugin.app.vault.getFiles()
          .filter(f => /\.(webm|mp4)$/i.test(f.path))
          .sort((a, b) => a.path.localeCompare(b.path));

        const { Menu } = require("obsidian");
        const menu = new Menu();
        for (const file of files) {
          menu.addItem((item: any) => {
            item.setTitle(file.path);
            item.onClick(() => {
              this.activeVideoPath = file.path;
              const port = this.plugin.settings.serverPort;
              const videoUrl = `http://localhost:${port}/vault/${encodeURIComponent(file.path)}`;
              if (this.plugin.server) {
                this.plugin.server.broadcast({ type: "show-video-bg", payload: { url: videoUrl } });
              }
              this.render();
            });
          });
        }
        if (files.length === 0) {
          menu.addItem((item: any) => item.setTitle("No .webm or .mp4 files found").setDisabled(true));
        }
        menu.showAtMouseEvent(evt);
      }
    });

    // Preview area
    const tvW = this.plugin.settings.tvWidth || 1920;
    const tvH = this.plugin.settings.tvHeight || 1080;
    const previewArea = section.createDiv("dm-layer-preview");
    previewArea.style.aspectRatio = `${tvW} / ${tvH}`;

    // Draw colored rectangles for each layer (sorted by zIndex ascending)
    const sorted = [...this.imageLayers].sort((a, b) => a.zIndex - b.zIndex);
    for (const layer of sorted) {
      const colorIdx = this.imageLayers.indexOf(layer) % DmControlPanel.LAYER_COLORS.length;
      const color = DmControlPanel.LAYER_COLORS[colorIdx];
      const rect = previewArea.createDiv("dm-layer-rect");
      rect.setAttribute("data-id", layer.id);
      rect.style.left = `${layer.x}%`;
      rect.style.top = `${layer.y}%`;
      rect.style.width = `${layer.width}%`;
      rect.style.height = `${layer.height}%`;
      rect.style.backgroundImage = `url(${layer.dataUrl})`;
      rect.style.backgroundSize = "cover";
      rect.style.backgroundPosition = "center";
      rect.style.borderColor = color;
      rect.style.zIndex = String(layer.zIndex);
      if (layer.rotation) {
        rect.style.transform = `rotate(${layer.rotation}deg)`;
      }
      rect.textContent = layer.label;
      rect.title = layer.label;
      if (!layer.visible) {
        rect.style.opacity = "0.25";
        rect.style.borderStyle = "dashed";
      }

      // Drag to reposition
      this.makeDraggable(rect, layer, previewArea);
    }

    // Layer list
    if (this.imageLayers.length > 0) {
      const list = section.createDiv("dm-layer-list");

      // Show highest z-index first
      const byZ = [...this.imageLayers].sort((a, b) => b.zIndex - a.zIndex);
      for (const layer of byZ) {
        const colorIdx = this.imageLayers.indexOf(layer) % DmControlPanel.LAYER_COLORS.length;
        const color = DmControlPanel.LAYER_COLORS[colorIdx];
        const row = list.createDiv("dm-layer-row");
        if (!layer.visible) row.addClass("dm-layer-hidden");

        // Visibility toggle
        const visBtn = row.createEl("button", {
          text: layer.visible ? "👁" : "👁‍🗨",
          cls: `dm-layer-btn dm-layer-vis-toggle ${layer.visible ? "dm-layer-vis-on" : "dm-layer-vis-off"}`,
        });
        visBtn.addEventListener("click", () => {
          layer.visible = !layer.visible;
          this.broadcastImageLayers();
          this.render();
        });

        const swatch = row.createDiv("dm-layer-swatch");
        swatch.style.backgroundColor = color;

        row.createSpan({ text: layer.label, cls: "dm-layer-label" });

        const controls = row.createDiv("dm-layer-controls");

        // Scale slider
        const scaleLabel = controls.createSpan({ text: `${layer.width}%`, cls: "dm-layer-scale-label" });
        const scaleSlider = controls.createEl("input", {
          type: "range",
          cls: "dm-layer-scale-slider",
        });
        scaleSlider.min = "10";
        scaleSlider.max = "500";
        scaleSlider.value = String(Math.round(layer.width));
        scaleSlider.addEventListener("keydown", (e: KeyboardEvent) => {
          if (e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
            e.preventDefault();
            const current = parseInt(scaleSlider.value);
            let newVal: number;
            if (e.key === "ArrowLeft") {
              newVal = Math.floor((current - 1) / 10) * 10;
            } else {
              newVal = Math.ceil((current + 1) / 10) * 10;
            }
            newVal = Math.max(10, Math.min(500, newVal));
            scaleSlider.value = String(newVal);
            scaleSlider.dispatchEvent(new Event("input"));
          }
        });
        scaleSlider.addEventListener("input", () => {
          const scale = parseInt(scaleSlider.value);
          // Keep the image centered when scaling
          const centerX = layer.x + layer.width / 2;
          const centerY = layer.y + layer.height / 2;
          const aspectRatio = layer.height / layer.width;
          layer.width = scale;
          layer.height = scale * aspectRatio;
          layer.x = centerX - layer.width / 2;
          layer.y = centerY - layer.height / 2;
          scaleLabel.textContent = `${scale}%`;
          this.broadcastImageLayers();
          // Update preview rectangles without full re-render
          const previewRect = this.contentEl.querySelector(`.dm-layer-rect[data-id="${layer.id}"]`) as HTMLElement;
          if (previewRect) {
            previewRect.style.left = `${layer.x}%`;
            previewRect.style.top = `${layer.y}%`;
            previewRect.style.width = `${layer.width}%`;
            previewRect.style.height = `${layer.height}%`;
          }
        });

        const rotLeftBtn = controls.createEl("button", { text: "↺", cls: "dm-layer-btn" });
        rotLeftBtn.addEventListener("click", () => {
          layer.rotation = (layer.rotation - 15) % 360;
          this.broadcastImageLayers();
          this.render();
        });

        const rotRightBtn = controls.createEl("button", { text: "↻", cls: "dm-layer-btn" });
        rotRightBtn.addEventListener("click", () => {
          layer.rotation = (layer.rotation + 15) % 360;
          this.broadcastImageLayers();
          this.render();
        });

        const upBtn = controls.createEl("button", { text: "▲", cls: "dm-layer-btn" });
        upBtn.addEventListener("click", () => {
          this.moveLayerUp(layer);
        });

        const downBtn = controls.createEl("button", { text: "▼", cls: "dm-layer-btn" });
        downBtn.addEventListener("click", () => {
          this.moveLayerDown(layer);
        });

        const removeBtn = controls.createEl("button", { text: "✕", cls: "dm-layer-btn dm-layer-remove" });
        removeBtn.addEventListener("click", () => {
          this.imageLayers = this.imageLayers.filter(l => l.id !== layer.id);
          this.broadcastImageLayers();
          this.render();
        });
      }

      const clearAllBtn = section.createEl("button", { text: "Clear All Layers" });
      clearAllBtn.addEventListener("click", () => {
        this.imageLayers = [];
        this.nextZIndex = 1;
        this.broadcastImageLayers();
        this.render();
      });
    }
  }

  addImageLayer(label: string, dataUrl: string, noteType?: string, visible = true) {
    const isPortrait = noteType === "person" || noteType === "monster";
    let x = 0, y = 0, width = 100, height = 100;
    if (isPortrait) {
      width = 30;
      height = 60;
      x = 35;
      y = 20;
    }

    const layer: ImageLayer = {
      id: `layer-${Date.now()}`,
      label,
      dataUrl,
      x,
      y,
      width,
      height,
      zIndex: this.nextZIndex++,
      rotation: 0,
      visible,
    };

    this.imageLayers.push(layer);
    this.broadcastImageLayers();
    this.render();
  }

  private showImagePicker(evt: MouseEvent) {
    const activeFile = this.plugin.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice("No active file");
      return;
    }

    const cache = this.plugin.app.metadataCache.getFileCache(activeFile);
    const fm = cache?.frontmatter;

    // Collect images from frontmatter fields
    const images: { label: string; path: string; source: string }[] = [];
    if (fm) {
      for (const key of ["map-image", "battlemap", "image"]) {
        if (fm[key]) {
          const resolved = this.plugin.app.metadataCache.getFirstLinkpathDest(fm[key], activeFile.path);
          if (resolved) {
            images.push({ label: `${key}: ${resolved.name}`, path: resolved.path, source: key });
          }
        }
      }
      // Portrait field (wiki-link format)
      if (fm["portrait"]) {
        const portraitStr = String(fm["portrait"]).replace(/^\[\[/, "").replace(/\]\]$/, "");
        const resolved = this.plugin.app.metadataCache.getFirstLinkpathDest(portraitStr, activeFile.path);
        if (resolved) {
          images.push({ label: `portrait: ${resolved.name}`, path: resolved.path, source: "portrait" });
        }
      }
    }

    // Collect embedded images from note body (![[image.ext]])
    if (cache?.embeds) {
      for (const embed of cache.embeds) {
        if (/\.(png|jpg|jpeg|webp|gif)$/i.test(embed.link)) {
          const resolved = this.plugin.app.metadataCache.getFirstLinkpathDest(embed.link, activeFile.path);
          if (resolved && !images.some(i => i.path === resolved.path)) {
            images.push({ label: `embed: ${resolved.name}`, path: resolved.path, source: "embed" });
          }
        }
      }
    }

    if (images.length === 0) {
      new Notice("No images found in this note");
      return;
    }

    const { Menu } = require("obsidian");
    const menu = new Menu();
    const noteType = fm?.["type"] as string | undefined;

    for (const img of images) {
      menu.addItem((item: any) => {
        item.setTitle(img.label);
        item.onClick(async () => {
          const dataUrl = await this.plugin.imageToDataUrl(img.path);
          if (dataUrl) {
            this.addImageLayer(`${activeFile.basename} (${img.source})`, dataUrl, noteType, false);
            new Notice(`Added: ${img.label} (hidden)`);
          }
        });
      });
    }

    // Add all at once option
    if (images.length > 1) {
      menu.addSeparator();
      menu.addItem((item: any) => {
        item.setTitle(`Add all ${images.length} images`);
        item.onClick(async () => {
          let added = 0;
          for (const img of images) {
            const dataUrl = await this.plugin.imageToDataUrl(img.path);
            if (dataUrl) {
              this.addImageLayer(`${activeFile.basename} (${img.source})`, dataUrl, noteType, false);
              added++;
            }
          }
          new Notice(`Added ${added} image${added > 1 ? "s" : ""} (hidden)`);
        });
      });
    }

    menu.showAtMouseEvent(evt);
  }

  private makeDraggable(rect: HTMLElement, layer: ImageLayer, preview: HTMLElement) {
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = layer.x;
      startTop = layer.y;
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    };

    const onMouseMove = (e: MouseEvent) => {
      const bounds = preview.getBoundingClientRect();
      const dx = ((e.clientX - startX) / bounds.width) * 100;
      const dy = ((e.clientY - startY) / bounds.height) * 100;
      layer.x = startLeft + dx;
      layer.y = startTop + dy;
      rect.style.left = `${layer.x}%`;
      rect.style.top = `${layer.y}%`;
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      this.broadcastImageLayers();
    };

    rect.addEventListener("mousedown", onMouseDown);
  }

  private moveLayerUp(layer: ImageLayer) {
    const sorted = [...this.imageLayers].sort((a, b) => b.zIndex - a.zIndex);
    const idx = sorted.indexOf(layer);
    if (idx > 0) {
      const other = sorted[idx - 1];
      const tmp = layer.zIndex;
      layer.zIndex = other.zIndex;
      other.zIndex = tmp;
      this.broadcastImageLayers();
      this.render();
    }
  }

  private moveLayerDown(layer: ImageLayer) {
    const sorted = [...this.imageLayers].sort((a, b) => b.zIndex - a.zIndex);
    const idx = sorted.indexOf(layer);
    if (idx < sorted.length - 1) {
      const other = sorted[idx + 1];
      const tmp = layer.zIndex;
      layer.zIndex = other.zIndex;
      other.zIndex = tmp;
      this.broadcastImageLayers();
      this.render();
    }
  }

  private broadcastImageLayers() {
    if (!this.plugin.server) return;
    this.plugin.server.broadcast({
      type: "image-layers-sync",
      payload: { layers: this.imageLayers },
    });
  }

  // ─── Manual Tracker Helpers ────────────────────────────────────────

  private sortManualCombatants() {
    this.manualCombatants.sort((a, b) => b.initiative - a.initiative);
  }

  private advanceManualTurn() {
    if (this.manualCombatants.length === 0) return;
    this.manualCombatants.forEach(c => (c.active = false));
    this.currentTurn = (this.currentTurn + 1) % this.manualCombatants.length;
    this.manualCombatants[this.currentTurn].active = true;
    this.broadcastManualInitiative();
    this.render();
  }

  private broadcastManualInitiative() {
    this.plugin.sendInitiativeUpdate(this.manualCombatants);
  }
}
