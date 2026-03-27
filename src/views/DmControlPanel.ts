import { ItemView, WorkspaceLeaf, Notice, TFile } from "obsidian";
import type DmScreenPlugin from "../main";
import type { TrackerCombatant, ImageLayer } from "../types";
import type { FogRegion } from "../settings";
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

  // Fog of War state (map-level, legacy)
  fogMapName: string | null = null;
  fogBounds: number[] = [0, 0, 1000, 1000];
  fogRevealed: FogRegion[] = [];
  private fogDrawing = false;

  // Per-layer fog drawing state
  private fogEditLayerId: string | null = null;
  private fogTool: "reveal-circle" | "reveal-rect" | "reveal-eraser" | "fog-circle" | "fog-rect" | "fog-pen" = "reveal-rect";
  private fogCanvases = new Map<string, HTMLCanvasElement>(); // layer id → offscreen fog canvas
  private static FOG_RESOLUTION = 1024; // fog canvas width (height scales with aspect)

  // Player viewport (what players see) — synced to player screen
  private playerPanX = 0; // percentage
  private playerPanY = 0;
  private playerZoom = 1;

  // DM preview zoom (local only, not sent to players)
  private dmZoom = 1;
  private dmPanX = 0;
  private dmPanY = 0;

  // Connected player screen info
  playerScreenWidth = 0;
  playerScreenHeight = 0;
  playerConnected = false;

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

  private escHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.fogEditLayerId) {
      this.fogEditLayerId = null;
      this.render();
    }
  };

  async onOpen() {
    document.addEventListener("keydown", this.escHandler);
    this.restoreState();
    this.render();
  }

  async onClose() {
    document.removeEventListener("keydown", this.escHandler);
    this.saveState();
  }

  private restoreState() {
    const s = this.plugin.settings;
    if (s.lastPlayerScreenWidth > 0) {
      this.playerScreenWidth = s.lastPlayerScreenWidth;
      this.playerScreenHeight = s.lastPlayerScreenHeight;
      this.playerConnected = true;
    }
    try {
      const layers = JSON.parse(s.lastImageLayers);
      if (Array.isArray(layers) && layers.length > 0) {
        this.imageLayers = layers;
        this.nextZIndex = Math.max(...layers.map((l: ImageLayer) => l.zIndex)) + 1;
      }
    } catch { /* ignore */ }

    // Restore broadcast cache to server for late joiners
    if (this.plugin.server && s.lastBroadcastCache) {
      for (const [type, data] of Object.entries(s.lastBroadcastCache)) {
        (this.plugin.server as any).lastState?.set(type, data);
      }
    }
  }

  saveState() {
    const s = this.plugin.settings;
    s.lastPlayerScreenWidth = this.playerScreenWidth;
    s.lastPlayerScreenHeight = this.playerScreenHeight;
    s.lastImageLayers = JSON.stringify(this.imageLayers);
    // Save broadcast cache
    if (this.plugin.server) {
      const cache: Record<string, string> = {};
      for (const [type, data] of (this.plugin.server as any).lastState?.entries() ?? []) {
        cache[type] = data;
      }
      s.lastBroadcastCache = cache;
    }
    this.plugin.saveSettings();
  }

  // Called from main.ts when a player screen browser connects or resizes
  onPlayerConnected(info: { width: number; height: number; devicePixelRatio: number }) {
    const wasConnected = this.playerConnected;
    this.playerScreenWidth = info.width;
    this.playerScreenHeight = info.height;
    this.playerConnected = true;
    // Full re-render only on first connect; resize just updates the viewport rect
    if (!wasConnected) {
      this.debouncedRender();
    } else {
      this.updateViewportRect();
    }
  }

  private updateViewportRect() {
    const existing = this.contentEl.querySelector(".dm-player-viewport-rect") as HTMLElement;
    if (existing) {
      // Recalculate rect based on player screen vs preview aspect ratios
      // For now just trigger a lightweight re-render of the rect
      this.debouncedRender();
    }
  }

  // Called from main.ts when a fog-of-war map is pushed
  setFogOfWarState(mapName: string, bounds: number[], revealed: FogRegion[]) {
    this.fogMapName = mapName;
    this.fogBounds = bounds;
    this.fogRevealed = [...revealed];
    this.render();
  }

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

  debouncedRender() {
    if (this.renderDebounceTimer) clearTimeout(this.renderDebounceTimer);
    this.renderDebounceTimer = setTimeout(() => this.render(), 100);
  }

  render() {
    const container = this.contentEl;
    container.empty();
    container.addClass("dm-control-panel");

    this.renderServerSection(container);
    this.renderPlayerScreenSection(container);
    if (this.fogMapName) {
      this.renderFogOfWarSection(container);
    }
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

      if (this.playerConnected) {
        const clientInfo = section.createDiv("dm-client-info");
        clientInfo.createSpan({
          text: `Player screen: ${this.playerScreenWidth}x${this.playerScreenHeight}`,
          cls: "dm-status-detail",
        });
      }
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

  // ─── Player Screen Section ──────────────────────────────────────────

  private renderPlayerScreenSection(container: HTMLElement) {
    const section = container.createDiv("dm-section");
    section.createEl("h3", { text: "Player Screen" });

    // Button row
    const btnRow = section.createDiv("dm-layer-btn-row");

    const addLayerBtn = btnRow.createEl("button", {
      text: "Add Image",
      cls: "mod-cta",
    });
    addLayerBtn.addEventListener("click", (evt: MouseEvent) => this.showImagePicker(evt));

    const videoBtnLabel = this.activeVideoPath ? "Stop Video BG" : "Video BG";
    const videoBtn = btnRow.createEl("button", { text: videoBtnLabel });
    videoBtn.addEventListener("click", (evt: MouseEvent) => {
      if (this.activeVideoPath) {
        this.activeVideoPath = null;
        if (this.plugin.server) {
          this.plugin.server.broadcast({ type: "hide-video-bg", payload: {} });
        }
        this.render();
      } else {
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

    const pushNoteBtn = btnRow.createEl("button", { text: "Push Note" });
    pushNoteBtn.addEventListener("click", () => {
      this.plugin.pushCurrentNoteToPlayerScreen();
    });

    // Preview area with pan/zoom — always use configured TV size for stable layout
    const tvW = this.plugin.settings.tvWidth || 1920;
    const tvH = this.plugin.settings.tvHeight || 1080;
    const previewArea = section.createDiv("dm-layer-preview");
    previewArea.style.aspectRatio = `${tvW} / ${tvH}`;

    // Inner container for pan/zoom transform (DM local view)
    const previewInner = previewArea.createDiv("dm-layer-preview-inner");
    previewInner.style.transform = `translate(${this.dmPanX}%, ${this.dmPanY}%) scale(${this.dmZoom})`;

    // Draw image layer rectangles (sorted by zIndex ascending)
    const sorted = [...this.imageLayers].sort((a, b) => a.zIndex - b.zIndex);
    for (const layer of sorted) {
      const colorIdx = this.imageLayers.indexOf(layer) % DmControlPanel.LAYER_COLORS.length;
      const color = DmControlPanel.LAYER_COLORS[colorIdx];
      const rect = previewInner.createDiv("dm-layer-rect");
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

      // Show fog overlay on preview
      if (layer.fogEnabled && layer.fogDataUrl) {
        const fogOverlay = rect.createDiv("dm-layer-fog-overlay");
        fogOverlay.style.backgroundImage = `url(${layer.fogDataUrl})`;
      }

      // If fog editing this layer, add drawing overlay
      if (this.fogEditLayerId === layer.id) {
        rect.addClass("dm-fog-editing");
        const fogDrawCanvas = rect.createEl("canvas", { cls: "dm-fog-draw-canvas-inline" });
        setTimeout(() => this.initInlineFogCanvas(fogDrawCanvas, layer, rect), 0);
      }

      if (this.fogEditLayerId !== layer.id) {
        this.makeDraggable(rect, layer, previewInner);
      }
    }

    // Player viewport indicator (green rectangle)
    // Represents the actual browser window aspect ratio, centered in the content.
    if (this.playerConnected && this.playerScreenWidth > 0 && this.playerScreenHeight > 0) {
      const vpRect = previewInner.createDiv("dm-player-viewport-rect");
      // The browser shows the content fitted — we need to show what portion
      // of the content space the browser can see based on its aspect ratio.
      // The content is 100%x100% in preview coords. The browser fits this
      // maintaining aspect, so one axis fills and the other may have black bars.
      const browserAspect = this.playerScreenWidth / this.playerScreenHeight;
      const previewAspect = tvW / tvH;

      let vpW: number, vpH: number;
      if (browserAspect > previewAspect) {
        // Browser is wider than content — full width, less height
        vpW = 100 / this.playerZoom;
        vpH = (100 / this.playerZoom) * (previewAspect / browserAspect);
      } else {
        // Browser is taller than content — full height, less width
        vpW = (100 / this.playerZoom) * (browserAspect / previewAspect);
        vpH = 100 / this.playerZoom;
      }
      const vpX = -this.playerPanX + (100 - vpW) / 2;
      const vpY = -this.playerPanY + (100 - vpH) / 2;
      vpRect.style.left = `${vpX}%`;
      vpRect.style.top = `${vpY}%`;
      vpRect.style.width = `${vpW}%`;
      vpRect.style.height = `${vpH}%`;

      // Scale visibility with zoom — more prominent when zoomed out further
      // Divide by dmZoom to compensate for the CSS transform scale on previewInner
      const zoomFactor = Math.max(0, Math.min(1, 1 - this.dmZoom)); // 0 at 100%, 1 at 0%
      const baseBorder = 2 + zoomFactor * 4;
      const borderWidth = baseBorder / this.dmZoom; // compensate for scale
      const fillOpacity = 0.02 + zoomFactor * 0.2;
      vpRect.style.borderWidth = `${borderWidth}px`;
      vpRect.style.backgroundColor = `rgba(0, 255, 0, ${fillOpacity})`;
    }

    // Pan/zoom via scroll wheel on preview
    this.setupPreviewPanZoom(previewArea, previewInner);

    // DM view controls (only show when zoomed/panned)
    if (this.dmZoom !== 1 || this.dmPanX !== 0 || this.dmPanY !== 0) {
      const viewControls = section.createDiv("dm-preview-view-controls");
      viewControls.createSpan({ text: `${Math.round(this.dmZoom * 100)}%`, cls: "dm-zoom-label" });
      const resetBtn = viewControls.createEl("button", { text: "Reset View", cls: "dm-layer-btn" });
      resetBtn.addEventListener("click", () => this.resetDmView());
    }

    // ── Layer list ──
    if (this.imageLayers.length > 0) {
      const list = section.createDiv("dm-layer-list");

      const byZ = [...this.imageLayers].sort((a, b) => b.zIndex - a.zIndex);
      for (const layer of byZ) {
        const colorIdx = this.imageLayers.indexOf(layer) % DmControlPanel.LAYER_COLORS.length;
        const color = DmControlPanel.LAYER_COLORS[colorIdx];
        const row = list.createDiv("dm-layer-row");
        if (!layer.visible) row.addClass("dm-layer-hidden");

        const visBtn = row.createEl("button", {
          text: layer.visible ? "\u{1F441}" : "\u{1F441}\u200D\u{1F5E8}",
          cls: `dm-layer-btn dm-layer-vis-toggle ${layer.visible ? "dm-layer-vis-on" : "dm-layer-vis-off"}`,
        });
        visBtn.addEventListener("click", () => {
          layer.visible = !layer.visible;
          this.broadcastImageLayers();
          this.render();
        });

        // Fog of war toggle (cloud icon)
        const fogBtn = row.createEl("button", {
          cls: `dm-layer-btn dm-fog-toggle ${layer.fogEnabled ? "dm-fog-active" : ""}`,
        });
        fogBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="${layer.fogEnabled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>`;
        fogBtn.title = layer.fogEnabled ? "Fog of War ON" : "Fog of War OFF";
        fogBtn.addEventListener("click", () => {
          layer.fogEnabled = !layer.fogEnabled;
          if (layer.fogEnabled && !layer.fogDataUrl) {
            this.initFogCanvas(layer);
          }
          if (layer.fogEnabled) {
            this.fogEditLayerId = layer.id;
          } else {
            if (this.fogEditLayerId === layer.id) this.fogEditLayerId = null;
            layer.fogDataUrl = "";
          }
          this.broadcastImageLayers();
          this.render();
        });

        const swatch = row.createDiv("dm-layer-swatch");
        swatch.style.backgroundColor = color;

        row.createSpan({ text: layer.label, cls: "dm-layer-label" });

        const controls = row.createDiv("dm-layer-controls");

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
          const centerX = layer.x + layer.width / 2;
          const centerY = layer.y + layer.height / 2;
          const aspectRatio = layer.height / layer.width;
          layer.width = scale;
          layer.height = scale * aspectRatio;
          layer.x = centerX - layer.width / 2;
          layer.y = centerY - layer.height / 2;
          scaleLabel.textContent = `${scale}%`;
          this.broadcastImageLayers();
          const previewRect = this.contentEl.querySelector(`.dm-layer-rect[data-id="${layer.id}"]`) as HTMLElement;
          if (previewRect) {
            previewRect.style.left = `${layer.x}%`;
            previewRect.style.top = `${layer.y}%`;
            previewRect.style.width = `${layer.width}%`;
            previewRect.style.height = `${layer.height}%`;
          }
        });

        const rotLeftBtn = controls.createEl("button", { text: "\u21BA", cls: "dm-layer-btn" });
        rotLeftBtn.addEventListener("click", () => {
          layer.rotation = (layer.rotation - 15) % 360;
          this.broadcastImageLayers();
          this.render();
        });

        const rotRightBtn = controls.createEl("button", { text: "\u21BB", cls: "dm-layer-btn" });
        rotRightBtn.addEventListener("click", () => {
          layer.rotation = (layer.rotation + 15) % 360;
          this.broadcastImageLayers();
          this.render();
        });

        const upBtn = controls.createEl("button", { text: "\u25B2", cls: "dm-layer-btn" });
        upBtn.addEventListener("click", () => {
          this.moveLayerUp(layer);
        });

        const downBtn = controls.createEl("button", { text: "\u25BC", cls: "dm-layer-btn" });
        downBtn.addEventListener("click", () => {
          this.moveLayerDown(layer);
        });

        const removeBtn = controls.createEl("button", { text: "\u2715", cls: "dm-layer-btn dm-layer-remove" });
        removeBtn.addEventListener("click", () => {
          this.fogCanvases.delete(layer.id);
          if (this.fogEditLayerId === layer.id) this.fogEditLayerId = null;
          this.imageLayers = this.imageLayers.filter(l => l.id !== layer.id);
          this.broadcastImageLayers();
          this.render();
        });

        // Fog tool selector (always visible when fog is enabled)
        if (layer.fogEnabled) {
          const fogEditor = list.createDiv("dm-fog-editor");

          const editLabel = fogEditor.createDiv("dm-fog-edit-label");
          editLabel.createSpan({ text: "Fog Drawing Tools", cls: "dm-fog-edit-title" });

          // Reveal row (outlined icons)
          const revealRow = fogEditor.createDiv("dm-fog-toolbar");
          revealRow.createSpan({ text: "Reveal:", cls: "dm-fog-tool-label" });

          this.createFogToolBtn(revealRow, "reveal-circle",
            `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>`, layer.id);
          this.createFogToolBtn(revealRow, "reveal-rect",
            `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>`, layer.id);
          this.createFogToolBtn(revealRow, "reveal-eraser",
            `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 20H7L3 16l9-9 8 8-4 4z"/><path d="M6.5 13.5L15 5"/></svg>`, layer.id);

          // Fog row (filled icons)
          const fogRow = fogEditor.createDiv("dm-fog-toolbar");
          fogRow.createSpan({ text: "Fog:", cls: "dm-fog-tool-label" });

          this.createFogToolBtn(fogRow, "fog-circle",
            `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>`, layer.id);
          this.createFogToolBtn(fogRow, "fog-rect",
            `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>`, layer.id);
          this.createFogToolBtn(fogRow, "fog-pen",
            `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>`, layer.id);

          if (this.fogEditLayerId === layer.id) {
            fogEditor.createDiv({ text: "Hold Shift to keep drawing after release.", cls: "dm-fog-hint" });
          }
        }
      }
    }

    // ── Clear all ──
    if (this.imageLayers.length > 0) {
      const clearRow = section.createDiv("dm-layer-btn-row");
      const clearLayersBtn = clearRow.createEl("button", { text: "Clear All Layers" });
      clearLayersBtn.addEventListener("click", () => {
        this.imageLayers = [];
        this.nextZIndex = 1;
        this.broadcastImageLayers();
        this.render();
      });
      const clearAllBtn = clearRow.createEl("button", { text: "Clear Player Screen" });
      clearAllBtn.addEventListener("click", () => {
        if (this.plugin.server) {
          this.plugin.server.broadcast({ type: "clear", payload: {} });
          this.imageLayers = [];
          this.nextZIndex = 1;
          new Notice("Player screen cleared");
          this.render();
        }
      });
    }
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

  // ─── Fog of War Section ──────────────────────────────────────────

  private renderFogOfWarSection(container: HTMLElement) {
    const section = container.createDiv("dm-section");
    const headerRow = section.createDiv("dm-fog-header");
    headerRow.createEl("h3", { text: `Fog of War — ${this.fogMapName}` });

    const [y0, x0, y1, x1] = this.fogBounds;
    const mapW = x1 - x0;
    const mapH = y1 - y0;

    // Preview canvas where DM can draw reveal rectangles
    const previewWrapper = section.createDiv("dm-fog-preview-wrapper");
    const preview = previewWrapper.createEl("canvas", { cls: "dm-fog-preview" });
    preview.style.aspectRatio = `${mapW} / ${mapH}`;
    preview.width = 400;
    preview.height = Math.round(400 * (mapH / mapW));

    // Draw fog preview after DOM attachment
    setTimeout(() => this.drawFogPreview(preview), 0);

    // Draw-to-reveal interaction
    this.setupFogDrawing(preview, mapW, mapH, x0, y0);

    // Revealed regions list
    if (this.fogRevealed.length > 0) {
      const listEl = section.createDiv("dm-fog-list");
      listEl.createEl("h4", { text: `Revealed Regions (${this.fogRevealed.length})` });

      for (let i = 0; i < this.fogRevealed.length; i++) {
        const r = this.fogRevealed[i];
        const row = listEl.createDiv("dm-fog-region-row");
        row.createSpan({
          text: `Region ${i + 1}: (${Math.round(r.x)}, ${Math.round(r.y)}) ${Math.round(r.w)}x${Math.round(r.h)}`,
          cls: "dm-fog-region-text",
        });
        const removeBtn = row.createEl("button", { text: "x", cls: "dm-remove-btn" });
        removeBtn.addEventListener("click", () => {
          this.fogRevealed.splice(i, 1);
          this.plugin.broadcastFogUpdate(this.fogMapName!, this.fogRevealed);
          this.render();
        });
      }
    }

    // Buttons
    const btnRow = section.createDiv("dm-fog-btn-row");

    const undoBtn = btnRow.createEl("button", { text: "Undo Last Reveal" });
    undoBtn.addEventListener("click", () => {
      if (this.fogRevealed.length > 0) {
        this.fogRevealed.pop();
        this.plugin.broadcastFogUpdate(this.fogMapName!, this.fogRevealed);
        this.render();
      }
    });

    const revealAllBtn = btnRow.createEl("button", { text: "Reveal All" });
    revealAllBtn.addEventListener("click", () => {
      this.fogRevealed = [{ x: x0, y: y0, w: mapW, h: mapH }];
      this.plugin.broadcastFogUpdate(this.fogMapName!, this.fogRevealed);
      this.render();
    });

    const resetBtn = btnRow.createEl("button", { text: "Reset Fog", cls: "dm-fog-reset-btn" });
    resetBtn.addEventListener("click", () => {
      this.fogRevealed = [];
      this.plugin.broadcastFogUpdate(this.fogMapName!, this.fogRevealed);
      this.render();
    });

    const closeFogBtn = btnRow.createEl("button", { text: "Close Fog Panel" });
    closeFogBtn.addEventListener("click", () => {
      this.fogMapName = null;
      this.render();
    });
  }

  private drawFogPreview(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const [y0, x0, y1, x1] = this.fogBounds;
    const mapW = x1 - x0;
    const mapH = y1 - y0;
    const cw = canvas.width;
    const ch = canvas.height;

    // Draw fog (dark background)
    ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
    ctx.fillRect(0, 0, cw, ch);

    // Cut out revealed regions
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgba(0, 0, 0, 1)";

    for (const r of this.fogRevealed) {
      const rx = ((r.x - x0) / mapW) * cw;
      const ry = ((r.y - y0) / mapH) * ch;
      const rw = (r.w / mapW) * cw;
      const rh = (r.h / mapH) * ch;
      ctx.fillRect(rx, ry, rw, rh);
    }

    ctx.globalCompositeOperation = "source-over";

    // Draw region outlines
    ctx.strokeStyle = "rgba(0, 255, 0, 0.5)";
    ctx.lineWidth = 1;
    for (const r of this.fogRevealed) {
      const rx = ((r.x - x0) / mapW) * cw;
      const ry = ((r.y - y0) / mapH) * ch;
      const rw = (r.w / mapW) * cw;
      const rh = (r.h / mapH) * ch;
      ctx.strokeRect(rx, ry, rw, rh);
    }
  }

  private setupFogDrawing(
    canvas: HTMLCanvasElement,
    mapW: number,
    mapH: number,
    x0: number,
    y0: number
  ) {
    let startX = 0;
    let startY = 0;
    let drawing = false;

    const onMouseDown = (e: MouseEvent) => {
      drawing = true;
      const rect = canvas.getBoundingClientRect();
      startX = e.clientX - rect.left;
      startY = e.clientY - rect.top;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!drawing) return;
      const rect = canvas.getBoundingClientRect();
      const curX = e.clientX - rect.left;
      const curY = e.clientY - rect.top;

      // Redraw preview with selection rectangle
      this.drawFogPreview(canvas);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.strokeStyle = "rgba(0, 255, 0, 0.9)";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(startX, startY, curX - startX, curY - startY);
        ctx.setLineDash([]);
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (!drawing) return;
      drawing = false;

      const rect = canvas.getBoundingClientRect();
      const endX = e.clientX - rect.left;
      const endY = e.clientY - rect.top;

      // Convert canvas pixels to map coordinates
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      const sx = Math.min(startX, endX) * scaleX;
      const sy = Math.min(startY, endY) * scaleY;
      const sw = Math.abs(endX - startX) * scaleX;
      const sh = Math.abs(endY - startY) * scaleY;

      // Skip tiny drags (accidental clicks)
      if (sw < 5 || sh < 5) return;

      const region: FogRegion = {
        x: x0 + (sx / canvas.width) * mapW,
        y: y0 + (sy / canvas.height) * mapH,
        w: (sw / canvas.width) * mapW,
        h: (sh / canvas.height) * mapH,
      };

      this.fogRevealed.push(region);
      this.plugin.broadcastFogUpdate(this.fogMapName!, this.fogRevealed);
      this.render();
    };

    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseup", onMouseUp);
  }

  // ─── Image Layers Section (merged into renderPlayerScreenSection) ──
  // Old renderImageLayersSection removed.

  private _removedImageLayersSection(container: HTMLElement) {
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
    // Load image to get natural dimensions, then size correctly
    const img = new Image();
    img.onload = () => {
      const tvW = this.plugin.settings.tvWidth || 1920;
      const tvH = this.plugin.settings.tvHeight || 1080;
      const isPortrait = noteType === "person" || noteType === "monster";

      let x = 0, y = 0, width: number, height: number;

      if (isPortrait) {
        width = 30;
        height = 60;
        x = 35;
        y = 20;
      } else {
        // Size based on image pixels relative to TV resolution
        // width/height are percentages of the screen
        width = (img.naturalWidth / tvW) * 100;
        height = (img.naturalHeight / tvH) * 100;

        // If the image fits within the screen, center it
        if (width <= 100 && height <= 100) {
          x = (100 - width) / 2;
          y = (100 - height) / 2;
        }
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
        fogEnabled: false,
        fogDataUrl: "",
      };

      this.imageLayers.push(layer);
      this.broadcastImageLayers();
      this.render();
    };
    img.src = dataUrl;
  }

  // ─── Per-Layer Fog of War ─────────────────────────────────────────

  private createFogToolBtn(
    container: HTMLElement,
    tool: typeof DmControlPanel.prototype.fogTool,
    svgHtml: string,
    layerId?: string
  ) {
    const isActive = this.fogTool === tool && this.fogEditLayerId === layerId;
    const btn = container.createEl("button", {
      cls: `dm-fog-tool-btn ${isActive ? "dm-fog-tool-active" : ""}`,
    });
    btn.innerHTML = svgHtml;
    btn.title = tool;
    btn.addEventListener("click", () => {
      this.fogTool = tool;
      if (layerId) this.fogEditLayerId = layerId;
      this.render();
    });
  }

  private initFogCanvas(layer: ImageLayer) {
    // Load image to get natural dimensions, then create matching fog canvas
    const img = new Image();
    img.onload = () => {
      const res = DmControlPanel.FOG_RESOLUTION;
      const aspect = img.naturalHeight / img.naturalWidth;
      const canvas = document.createElement("canvas");
      canvas.width = res;
      canvas.height = Math.round(res * aspect);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      this.fogCanvases.set(layer.id, canvas);
      layer.fogDataUrl = canvas.toDataURL("image/png");
      this.broadcastImageLayers();
    };
    img.src = layer.dataUrl;
  }

  private getFogCanvas(layer: ImageLayer): HTMLCanvasElement {
    let canvas = this.fogCanvases.get(layer.id);
    if (!canvas) {
      canvas = document.createElement("canvas");
      const res = DmControlPanel.FOG_RESOLUTION;
      canvas.width = res;
      canvas.height = res; // temporary, will be corrected

      // Restore from existing fogDataUrl if present
      if (layer.fogDataUrl) {
        const img = new Image();
        img.onload = () => {
          canvas!.width = img.naturalWidth;
          canvas!.height = img.naturalHeight;
          const ctx = canvas!.getContext("2d")!;
          ctx.drawImage(img, 0, 0);
        };
        img.src = layer.fogDataUrl;
      } else {
        // Load source image to get aspect
        const srcImg = new Image();
        srcImg.onload = () => {
          const aspect = srcImg.naturalHeight / srcImg.naturalWidth;
          canvas!.height = Math.round(res * aspect);
          const ctx = canvas!.getContext("2d")!;
          ctx.fillStyle = "black";
          ctx.fillRect(0, 0, canvas!.width, canvas!.height);
        };
        srcImg.src = layer.dataUrl;
      }
      this.fogCanvases.set(layer.id, canvas);
    }
    return canvas;
  }

  private syncFogToLayer(layer: ImageLayer) {
    const canvas = this.fogCanvases.get(layer.id);
    if (canvas) {
      layer.fogDataUrl = canvas.toDataURL("image/png");
      this.broadcastImageLayers();
    }
  }

  private initInlineFogCanvas(canvas: HTMLCanvasElement, layer: ImageLayer, rect: HTMLElement) {
    // Size canvas to match the rect's rendered size
    const rectBounds = rect.getBoundingClientRect();
    if (rectBounds.width < 1 || rectBounds.height < 1) return;
    canvas.width = rectBounds.width;
    canvas.height = rectBounds.height;

    // Draw semi-transparent fog preview
    const fogCanvas = this.getFogCanvas(layer);
    const ctx = canvas.getContext("2d")!;
    ctx.globalAlpha = 0.6;
    ctx.drawImage(fogCanvas, 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1.0;

    // Set up drawing interaction
    this.setupInlineFogDrawing(canvas, layer, rect);
  }

  private setupInlineFogDrawing(canvas: HTMLCanvasElement, layer: ImageLayer, rect: HTMLElement) {
    let drawing = false;
    let startX = 0;
    let startY = 0;
    const fogCanvas = this.getFogCanvas(layer);
    const fogCtx = fogCanvas.getContext("2d")!;

    const toFogCoord = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * fogCanvas.width;
      const y = ((e.clientY - r.top) / r.height) * fogCanvas.height;
      return { x, y };
    };

    const isReveal = () => this.fogTool.startsWith("reveal");
    const isFreehand = () => this.fogTool === "reveal-eraser" || this.fogTool === "fog-pen";
    const brushSize = fogCanvas.width * 0.05;

    const applyFreehand = (cx: number, cy: number) => {
      fogCtx.globalCompositeOperation = isReveal() ? "destination-out" : "source-over";
      fogCtx.fillStyle = isReveal() ? "rgba(0,0,0,1)" : "black";
      fogCtx.beginPath();
      fogCtx.arc(cx, cy, brushSize, 0, Math.PI * 2);
      fogCtx.fill();
      fogCtx.globalCompositeOperation = "source-over";
    };

    const applyShape = (x1: number, y1: number, x2: number, y2: number) => {
      fogCtx.globalCompositeOperation = isReveal() ? "destination-out" : "source-over";
      fogCtx.fillStyle = isReveal() ? "rgba(0,0,0,1)" : "black";
      const isCircle = this.fogTool === "reveal-circle" || this.fogTool === "fog-circle";
      if (isCircle) {
        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2;
        const rx = Math.abs(x2 - x1) / 2;
        const ry = Math.abs(y2 - y1) / 2;
        fogCtx.beginPath();
        fogCtx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        fogCtx.fill();
      } else {
        fogCtx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      }
      fogCtx.globalCompositeOperation = "source-over";
    };

    const refreshOverlay = () => {
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 0.6;
      ctx.drawImage(fogCanvas, 0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1.0;
    };

    canvas.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      drawing = true;
      const { x, y } = toFogCoord(e);
      startX = x;
      startY = y;
      if (isFreehand()) {
        applyFreehand(x, y);
        refreshOverlay();
      }
    });

    canvas.addEventListener("mousemove", (e) => {
      if (!drawing) return;
      e.stopPropagation();
      const { x, y } = toFogCoord(e);
      if (isFreehand()) {
        applyFreehand(x, y);
        refreshOverlay();
      } else {
        refreshOverlay();
        const ctx = canvas.getContext("2d")!;
        const cw = canvas.width;
        const ch = canvas.height;
        const sx1 = (startX / fogCanvas.width) * cw;
        const sy1 = (startY / fogCanvas.height) * ch;
        const sx2 = (x / fogCanvas.width) * cw;
        const sy2 = (y / fogCanvas.height) * ch;
        ctx.strokeStyle = isReveal() ? "rgba(0, 255, 0, 0.8)" : "rgba(255, 0, 0, 0.8)";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        const isCircleTool = this.fogTool === "reveal-circle" || this.fogTool === "fog-circle";
        if (isCircleTool) {
          const cx = (sx1 + sx2) / 2;
          const cy = (sy1 + sy2) / 2;
          const rx = Math.abs(sx2 - sx1) / 2;
          const ry = Math.abs(sy2 - sy1) / 2;
          ctx.beginPath();
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.strokeRect(sx1, sy1, sx2 - sx1, sy2 - sy1);
        }
        ctx.setLineDash([]);
      }
    });

    const finishDraw = (e: MouseEvent) => {
      if (!drawing) return;
      drawing = false;
      if (!isFreehand()) {
        const { x, y } = toFogCoord(e);
        if (Math.abs(x - startX) > 3 || Math.abs(y - startY) > 3) {
          applyShape(startX, startY, x, y);
        }
      }
      this.syncFogToLayer(layer);

      // Update fog overlay in preview
      const fogOverlay = rect.querySelector(".dm-layer-fog-overlay") as HTMLElement;
      if (fogOverlay) {
        fogOverlay.style.backgroundImage = `url(${layer.fogDataUrl})`;
      }

      // Shift held = stay in edit mode, otherwise exit
      if (!e.shiftKey) {
        this.fogEditLayerId = null;
        this.render();
      } else {
        refreshOverlay();
      }
    };

    canvas.addEventListener("mouseup", finishDraw);
    canvas.addEventListener("mouseleave", (e) => {
      if (drawing && isFreehand()) finishDraw(e);
    });
  }

  private setupPreviewPanZoom(previewArea: HTMLElement, previewInner: HTMLElement) {
    // Scroll wheel = DM zoom only (not broadcast to players)
    previewArea.addEventListener("wheel", (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      this.dmZoom = Math.max(0.1, Math.min(10, this.dmZoom + delta));
      previewInner.style.transform = `translate(${this.dmPanX}%, ${this.dmPanY}%) scale(${this.dmZoom})`;
    });

    // Middle-click drag = DM pan only (not broadcast to players)
    let panning = false;
    let panStartX = 0;
    let panStartY = 0;
    let panStartPanX = 0;
    let panStartPanY = 0;

    previewArea.addEventListener("mousedown", (e) => {
      if (e.button === 1) {
        e.preventDefault();
        panning = true;
        panStartX = e.clientX;
        panStartY = e.clientY;
        panStartPanX = this.dmPanX;
        panStartPanY = this.dmPanY;
      }
    });

    document.addEventListener("mousemove", (e) => {
      if (!panning) return;
      const bounds = previewArea.getBoundingClientRect();
      const dx = ((e.clientX - panStartX) / bounds.width) * 100;
      const dy = ((e.clientY - panStartY) / bounds.height) * 100;
      this.dmPanX = panStartPanX + dx;
      this.dmPanY = panStartPanY + dy;
      previewInner.style.transform = `translate(${this.dmPanX}%, ${this.dmPanY}%) scale(${this.dmZoom})`;
    });

    document.addEventListener("mouseup", (e) => {
      if (panning && e.button === 1) {
        panning = false;
      }
    });
  }

  private resetDmView() {
    this.dmZoom = 1;
    this.dmPanX = this.playerPanX;
    this.dmPanY = this.playerPanY;
    this.render();
  }

  private broadcastPlayerViewport() {
    if (!this.plugin.server) return;
    const tvW = this.plugin.settings.tvWidth || 1920;
    const tvH = this.plugin.settings.tvHeight || 1080;
    this.plugin.server.broadcast({
      type: "viewport-update",
      payload: {
        panX: (this.playerPanX / 100) * tvW,
        panY: (this.playerPanY / 100) * tvH,
        zoom: this.playerZoom,
      },
    });
  }

  private initFogDrawCanvas(drawCanvas: HTMLCanvasElement, layer: ImageLayer) {
    // Load source image to get aspect ratio for the draw canvas
    const img = new Image();
    img.onload = () => {
      const wrapper = drawCanvas.parentElement!;
      const wrapperWidth = wrapper.clientWidth || 300;
      const aspect = img.naturalHeight / img.naturalWidth;
      const canvasW = wrapperWidth;
      const canvasH = Math.round(canvasW * aspect);
      drawCanvas.width = canvasW;
      drawCanvas.height = canvasH;
      drawCanvas.style.width = `${canvasW}px`;
      drawCanvas.style.height = `${canvasH}px`;

      this.drawFogPreviewOnCanvas(drawCanvas, layer);
      this.setupFogDrawInteraction(drawCanvas, layer);
    };
    img.src = layer.dataUrl;
  }

  private drawFogPreviewOnCanvas(drawCanvas: HTMLCanvasElement, layer: ImageLayer) {
    const ctx = drawCanvas.getContext("2d")!;
    const cw = drawCanvas.width;
    const ch = drawCanvas.height;

    // Draw the image first (as background reference)
    ctx.clearRect(0, 0, cw, ch);
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, cw, ch);
      // Draw fog overlay on top
      const fogCanvas = this.getFogCanvas(layer);
      ctx.globalAlpha = 0.7;
      ctx.drawImage(fogCanvas, 0, 0, cw, ch);
      ctx.globalAlpha = 1.0;
    };
    img.src = layer.dataUrl;
  }

  private setupFogDrawInteraction(drawCanvas: HTMLCanvasElement, layer: ImageLayer) {
    let drawing = false;
    let startX = 0;
    let startY = 0;
    const fogCanvas = this.getFogCanvas(layer);
    const fogCtx = fogCanvas.getContext("2d")!;

    const toFogCoord = (canvasX: number, canvasY: number) => {
      const rect = drawCanvas.getBoundingClientRect();
      const x = ((canvasX - rect.left) / rect.width) * fogCanvas.width;
      const y = ((canvasY - rect.top) / rect.height) * fogCanvas.height;
      return { x, y };
    };

    const isReveal = () => this.fogTool.startsWith("reveal");
    const isFreehand = () => this.fogTool === "reveal-eraser" || this.fogTool === "fog-pen";
    const brushSize = fogCanvas.width * 0.05; // 5% of fog width

    const applyFreehand = (cx: number, cy: number) => {
      fogCtx.globalCompositeOperation = isReveal() ? "destination-out" : "source-over";
      fogCtx.fillStyle = isReveal() ? "rgba(0,0,0,1)" : "black";
      fogCtx.beginPath();
      fogCtx.arc(cx, cy, brushSize, 0, Math.PI * 2);
      fogCtx.fill();
      fogCtx.globalCompositeOperation = "source-over";
    };

    const applyShape = (x1: number, y1: number, x2: number, y2: number) => {
      fogCtx.globalCompositeOperation = isReveal() ? "destination-out" : "source-over";
      fogCtx.fillStyle = isReveal() ? "rgba(0,0,0,1)" : "black";

      const isCircle = this.fogTool === "reveal-circle" || this.fogTool === "fog-circle";
      if (isCircle) {
        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2;
        const rx = Math.abs(x2 - x1) / 2;
        const ry = Math.abs(y2 - y1) / 2;
        fogCtx.beginPath();
        fogCtx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        fogCtx.fill();
      } else {
        const sx = Math.min(x1, x2);
        const sy = Math.min(y1, y2);
        const sw = Math.abs(x2 - x1);
        const sh = Math.abs(y2 - y1);
        fogCtx.fillRect(sx, sy, sw, sh);
      }
      fogCtx.globalCompositeOperation = "source-over";
    };

    const refreshPreview = () => {
      this.drawFogPreviewOnCanvas(drawCanvas, layer);
    };

    const onMouseDown = (e: MouseEvent) => {
      drawing = true;
      const { x, y } = toFogCoord(e.clientX, e.clientY);
      startX = x;
      startY = y;
      if (isFreehand()) {
        applyFreehand(x, y);
        refreshPreview();
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!drawing) return;
      const { x, y } = toFogCoord(e.clientX, e.clientY);
      if (isFreehand()) {
        applyFreehand(x, y);
        refreshPreview();
      } else {
        // Show preview of shape being drawn
        refreshPreview();
        const ctx = drawCanvas.getContext("2d")!;
        const cw = drawCanvas.width;
        const ch = drawCanvas.height;
        const sx1 = (startX / fogCanvas.width) * cw;
        const sy1 = (startY / fogCanvas.height) * ch;
        const sx2 = (x / fogCanvas.width) * cw;
        const sy2 = (y / fogCanvas.height) * ch;

        ctx.strokeStyle = isReveal() ? "rgba(0, 255, 0, 0.8)" : "rgba(255, 0, 0, 0.8)";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);

        const isCircle = this.fogTool === "reveal-circle" || this.fogTool === "fog-circle";
        if (isCircle) {
          const cx = (sx1 + sx2) / 2;
          const cy = (sy1 + sy2) / 2;
          const rx = Math.abs(sx2 - sx1) / 2;
          const ry = Math.abs(sy2 - sy1) / 2;
          ctx.beginPath();
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.strokeRect(sx1, sy1, sx2 - sx1, sy2 - sy1);
        }
        ctx.setLineDash([]);
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (!drawing) return;
      drawing = false;
      if (!isFreehand()) {
        const { x, y } = toFogCoord(e.clientX, e.clientY);
        // Skip tiny drags
        if (Math.abs(x - startX) > 3 || Math.abs(y - startY) > 3) {
          applyShape(startX, startY, x, y);
        }
      }
      this.syncFogToLayer(layer);
      refreshPreview();
    };

    drawCanvas.addEventListener("mousedown", onMouseDown);
    drawCanvas.addEventListener("mousemove", onMouseMove);
    drawCanvas.addEventListener("mouseup", onMouseUp);
    drawCanvas.addEventListener("mouseleave", () => {
      if (drawing && isFreehand()) {
        drawing = false;
        this.syncFogToLayer(layer);
        refreshPreview();
      }
    });
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

    const noteType = fm?.["type"] as string | undefined;

    // If only one image, add it directly without showing the menu
    if (images.length === 1) {
      const img = images[0];
      this.plugin.imageToDataUrl(img.path).then(dataUrl => {
        if (dataUrl) {
          this.addImageLayer(`${activeFile.basename} (${img.source})`, dataUrl, noteType, false);
          new Notice(`Added: ${img.label} (hidden)`);
        }
      });
      return;
    }

    const { Menu } = require("obsidian");
    const menu = new Menu();

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
    this.saveState();
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
