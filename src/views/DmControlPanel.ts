import { ItemView, Menu, WorkspaceLeaf, Notice, TFile } from "obsidian";
import type DmScreenPlugin from "../main";
import type { TrackerCombatant, ImageLayer } from "../types";
import { renderStatblock } from "./StatblockPanel";
import { DnDBeyondPanel } from "./DnDBeyondPanel";
import { debug, debugWarn, debugError } from "../debug";
import { CONDITIONS, decodeStatus, encodeExhaustion } from "../conditions";

export const DM_CONTROL_VIEW_TYPE = "dm-control-panel";

interface ManualCombatant {
  name: string;
  hp: number;
  maxHp: number;
  initiative: number;
  active: boolean;
  statuses: string[];
}

export class DmControlPanel extends ItemView {
  plugin: DmScreenPlugin;

  // Manual initiative state
  manualCombatants: ManualCombatant[] = [];
  currentTurn = 0;
  manualRound = 1;

  // Plugin-synced initiative state
  trackerSource: "manual" | "plugin" = "manual";
  pluginCombatants: TrackerCombatant[] = [];
  pluginRound = 0;
  encounterName = "";

  // Image layers state
  imageLayers: ImageLayer[] = [];
  private nextZIndex = 1;
  private nextLayerSeq = 1;
  private activeVideoPath: string | null = null;
  activeBackgroundUrl: string | null = null;
  private static LAYER_COLORS = [
    "#e74c3c", "#3498db", "#2ecc71", "#f39c12",
    "#9b59b6", "#1abc9c", "#e67e22", "#34495e",
  ];

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

  // Connected player screens info
  connectedClients: Array<{ width: number; height: number; devicePixelRatio: number }> = [];
  playerConnected = false;
  private selectedResolution: { width: number; height: number } | null = null;

  get playerScreenWidth(): number {
    return this.connectedClients.length > 0 ? this.connectedClients[0].width : 0;
  }

  get playerScreenHeight(): number {
    return this.connectedClients.length > 0 ? this.connectedClients[0].height : 0;
  }

  private getEffectiveResolution(): { width: number; height: number } {
    if (this.selectedResolution) {
      const hasMatch = this.connectedClients.some(
        c => c.width === this.selectedResolution!.width && c.height === this.selectedResolution!.height
      );
      if (hasMatch) return this.selectedResolution;
      this.selectedResolution = null;
    }
    if (this.connectedClients.length > 0) {
      return { width: this.connectedClients[0].width, height: this.connectedClients[0].height };
    }
    return { width: this.plugin.settings.tvWidth || 1920, height: this.plugin.settings.tvHeight || 1080 };
  }

  // D&D Beyond integration
  private combatTab: "initiative" | "dndbeyond" = "initiative";
  private ddbPanel: DnDBeyondPanel | null = null;

  // UI state
  expandedCreature: string | null = null;
  private renderDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private saveStateTimer: ReturnType<typeof setTimeout> | null = null;
  private panZoomAbort: AbortController | null = null;

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
    debug("DmControlPanel: onOpen");
    document.addEventListener("keydown", this.escHandler);
    this.restoreState();
    this.render();
  }

  async onClose() {
    debug("DmControlPanel: onClose");
    document.removeEventListener("keydown", this.escHandler);
    this.panZoomAbort?.abort();
    this.panZoomAbort = null;
    if (this.ddbPanel) {
      this.ddbPanel.destroy();
      this.ddbPanel = null;
    }
    this.saveState();
  }

  private getPlayerViewport(): { vpW: number; vpH: number; vpX: number; vpY: number } | null {
    const eff = this.getEffectiveResolution();
    if (eff.width <= 0 || eff.height <= 0) return null;
    const tvW = eff.width;
    const tvH = eff.height;
    const browserW = this.playerScreenWidth || tvW;
    const browserH = this.playerScreenHeight || tvH;
    const browserAspect = browserW / browserH;
    const previewAspect = tvW / tvH;
    let vpW: number, vpH: number;
    if (browserAspect > previewAspect) {
      vpW = 100 / this.playerZoom;
      vpH = (100 / this.playerZoom) * (previewAspect / browserAspect);
    } else {
      vpW = (100 / this.playerZoom) * (browserAspect / previewAspect);
      vpH = 100 / this.playerZoom;
    }
    const vpX = -this.playerPanX + (100 - vpW) / 2;
    const vpY = -this.playerPanY + (100 - vpH) / 2;
    return { vpW, vpH, vpX, vpY };
  }

  private restoreState() {
    const s = this.plugin.settings;
    if (s.lastPlayerScreenWidth > 0) {
      this.connectedClients = [{ width: s.lastPlayerScreenWidth, height: s.lastPlayerScreenHeight, devicePixelRatio: 1 }];
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
    const bgCache = s.lastBroadcastCache?.["show-background-media"];
    if (bgCache) {
      try {
        const msg = JSON.parse(bgCache);
        this.activeBackgroundUrl = msg.payload?.url ?? null;
      } catch { /* ignore */ }
    }

    debug(
      "DmControlPanel: restoreState — layers:", this.imageLayers.length,
      "cache entries:", Object.keys(s.lastBroadcastCache ?? {}).length,
      "bg:", this.activeBackgroundUrl ?? "(none)"
    );
    if (this.plugin.server && this.imageLayers.length > 0) {
      this.broadcastImageLayers();
    }
  }

  republishToServer() {
    if (!this.plugin.server) return;
    if (this.imageLayers.length > 0) {
      debug("DmControlPanel: republishToServer — layers:", this.imageLayers.length);
      this.broadcastImageLayers();
    }
    if (this.activeBackgroundUrl) {
      debug("DmControlPanel: republishToServer — background:", this.activeBackgroundUrl);
      const mediaType = isVideoBackgroundUrl(this.activeBackgroundUrl) ? "video" : "image";
      this.plugin.server.broadcast({
        type: "show-background-media",
        payload: { url: this.activeBackgroundUrl, mediaType },
      });
    }
  }

  saveState() {
    if (this.saveStateTimer) {
      clearTimeout(this.saveStateTimer);
      this.saveStateTimer = null;
    }
    const s = this.plugin.settings;
    s.lastPlayerScreenWidth = this.connectedClients[0]?.width ?? 0;
    s.lastPlayerScreenHeight = this.connectedClients[0]?.height ?? 0;
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

  // Coalesces bursty broadcasts (drag, fog draw, scale slider…) into a
  // single write. Without this, each broadcastImageLayers fires saveState
  // synchronously, JSON-stringifying ~1 MB of layer data and writing it to
  // disk every frame.
  scheduleSaveState() {
    if (this.saveStateTimer) return;
    this.saveStateTimer = setTimeout(() => {
      this.saveStateTimer = null;
      this.saveState();
    }, 1000);
  }

  // Called from main.ts when a player screen browser connects or resizes
  onPlayerConnected(clients: Array<{ width: number; height: number; devicePixelRatio: number }>) {
    const wasConnected = this.playerConnected;
    this.connectedClients = clients;
    this.playerConnected = clients.length > 0;
    debug("DmControlPanel: onPlayerConnected — clients:", clients.length, "was:", wasConnected);
    if (!wasConnected && this.playerConnected) {
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

  // Called from main.ts when Initiative Tracker fires save-state
  syncFromInitiativeTracker(combatants: TrackerCombatant[], round: number, encounterName: string) {
    this.trackerSource = "plugin";
    this.pluginCombatants = combatants;
    this.pluginRound = round;
    this.encounterName = encounterName;

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
    this.renderInitiativeSection(container);

    this.broadcastInitialScale();
  }

  private hasBroadcastInitialScale = false;

  private broadcastInitialScale() {
    if (this.hasBroadcastInitialScale) return;
    if (!this.plugin.server) return;
    this.plugin.server.broadcast({
      type: "combat-scale",
      payload: { scale: this.plugin.settings.combatTrackerScale },
    });
    this.hasBroadcastInitialScale = true;
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

      const port = this.plugin.settings.serverPort;
      const lanIp = this.getLanIp();
      const lanUrl = lanIp ? `http://${lanIp}:${port}` : null;

      // LAN URL — localhost row removed (it doesn't help any LAN client and
      // ate vertical space on narrow panels).
      if (lanUrl) {
        const lanRow = section.createDiv("dm-server-url");
        const lanLink = lanRow.createEl("a", {
          text: `LAN: ${lanUrl}`,
          href: lanUrl,
          cls: "dm-server-url-link",
        });
        lanLink.setAttr("target", "_blank");

        const lanCopyBtn = lanRow.createEl("button", {
          text: "Copy",
          cls: "dm-copy-url-btn",
        });
        lanCopyBtn.addEventListener("click", () => {
          navigator.clipboard.writeText(lanUrl);
          lanCopyBtn.textContent = "Copied!";
          setTimeout(() => { lanCopyBtn.textContent = "Copy"; }, 1500);
        });
      }

      if (this.connectedClients.length > 0) {
        const clientInfo = section.createDiv("dm-client-info");
        clientInfo.createSpan({
          text: `${this.connectedClients.length} screen${this.connectedClients.length > 1 ? "s" : ""} connected`,
          cls: "dm-status-detail",
        });

        const resMap = new Map<string, { width: number; height: number; count: number }>();
        for (const c of this.connectedClients) {
          const key = `${c.width}×${c.height}`;
          const existing = resMap.get(key);
          if (existing) existing.count++;
          else resMap.set(key, { width: c.width, height: c.height, count: 1 });
        }

        const eff = this.getEffectiveResolution();
        for (const [key, info] of resMap) {
          const label = info.count > 1 ? `${key} ×${info.count}` : key;
          const badge = clientInfo.createSpan({ text: label, cls: "dm-client-resolution" });
          if (info.width === eff.width && info.height === eff.height) {
            badge.addClass("dm-client-resolution-active");
          }
          badge.addEventListener("click", () => {
            this.selectedResolution = { width: info.width, height: info.height };
            this.render();
          });
        }
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

  private getLanIp(): string | null {
    try {
      const os = require("os");
      const interfaces = os.networkInterfaces();
      for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
          if (iface.family === "IPv4" && !iface.internal) {
            return iface.address;
          }
        }
      }
    } catch { /* ignore */ }
    return null;
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

    const addBgBtnLabel = this.activeBackgroundUrl ? "Stop BG" : "Add BG";
    const addBgBtn = btnRow.createEl("button", {
      text: addBgBtnLabel,
      cls: this.activeBackgroundUrl ? "" : "mod-cta",
    });
    addBgBtn.addEventListener("click", (evt: MouseEvent) => {
      if (this.activeBackgroundUrl) {
        this.activeBackgroundUrl = null;
        this.activeVideoPath = null;
        if (this.plugin.server) {
          this.plugin.server.broadcast({ type: "hide-background-media", payload: {} });
        }
        this.render();
      } else {
        this.showBackgroundPicker(evt);
      }
    });

    if (this.plugin.settings.hydrusEnabled && this.plugin.settings.hydrusApiUrl) {
      const hydrusBtn = btnRow.createEl("button", { text: "Image from Hydrus" });
      hydrusBtn.addEventListener("click", async () => {
        try {
          const { HydrusExplorerModal } = await import("./HydrusExplorerModal");
          new HydrusExplorerModal(this.plugin.app, this.plugin).open();
        } catch (err) {
          debugError("Hydrus modal failed:", err);
        }
      });
    }



    // Preview area with pan/zoom — always use configured TV size for stable layout
    const { width: tvW, height: tvH } = this.getEffectiveResolution();
    const previewArea = section.createDiv("dm-layer-preview");
    previewArea.style.aspectRatio = `${tvW} / ${tvH}`;

    // Inner container for pan/zoom transform (DM local view)
    const previewInner = previewArea.createDiv("dm-layer-preview-inner");
    previewInner.style.transform = `translate(${this.dmPanX}%, ${this.dmPanY}%) scale(${this.dmZoom})`;

    // Background media preview — same geometry as the green viewport rect,
    // only rendered when a connected client matches the effective resolution.
    const effForBg = this.getEffectiveResolution();
    const activeClient = this.connectedClients.find(
      c => c.width === effForBg.width && c.height === effForBg.height
    );
    if (this.activeBackgroundUrl && activeClient && activeClient.width > 0 && activeClient.height > 0) {
      const bgUrl = resolveBackgroundPreviewUrl(
        this.activeBackgroundUrl,
        this.plugin.app.vault.adapter as { getResourcePath?: (path: string) => string }
      );
      if (bgUrl) {
        const browserAspect = activeClient.width / activeClient.height;
        const previewAspect = tvW / tvH;
        let bgW: number, bgH: number;
        if (browserAspect > previewAspect) {
          bgW = 100 / this.playerZoom;
          bgH = (100 / this.playerZoom) * (previewAspect / browserAspect);
        } else {
          bgW = (100 / this.playerZoom) * (browserAspect / previewAspect);
          bgH = 100 / this.playerZoom;
        }
        const bgX = -this.playerPanX + (100 - bgW) / 2;
        const bgY = -this.playerPanY + (100 - bgH) / 2;
        const bgWrap = previewInner.createDiv("dm-preview-bg");
        bgWrap.style.left = `${bgX}%`;
        bgWrap.style.top = `${bgY}%`;
        bgWrap.style.width = `${bgW}%`;
        bgWrap.style.height = `${bgH}%`;
        if (isVideoBackgroundUrl(bgUrl)) {
          const v = bgWrap.createEl("video");
          v.src = bgUrl;
          v.muted = true;
          v.loop = true;
          v.autoplay = true;
          v.playsInline = true;
          v.play().catch(() => {});
        } else {
          const img = bgWrap.createEl("img");
          img.src = bgUrl;
          img.alt = "";
        }
      }
    }

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
      rect.style.zIndex = String(layer.zIndex);
      if (layer.rotation) {
        rect.style.transform = `rotate(${layer.rotation}deg)`;
      }
      rect.title = layer.label;
      if (!layer.visible) rect.style.opacity = "0.25";

      // Frame: holds the colored border, image, fog overlay, and fog-edit
      // canvas. Sized at image-load time to the visible image rect inside
      // the broadcast wrapper (mirrors the player-side .image-layer-frame)
      // so the border hugs the visible content instead of the wrapper.
      const frame = rect.createDiv("dm-layer-rect-frame");
      frame.style.backgroundImage = `url(${layer.dataUrl})`;
      frame.style.backgroundSize = "100% 100%";
      frame.style.backgroundPosition = "center";
      frame.style.backgroundRepeat = "no-repeat";
      frame.style.borderColor = color;
      if (!layer.visible) frame.style.borderStyle = "dashed";

      const sizeFrame = () => {
        const bounds = rect.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;
        if (!frameImg.naturalWidth || !frameImg.naturalHeight) return;
        const imgAspect = frameImg.naturalWidth / frameImg.naturalHeight;
        const rectAspect = bounds.width / bounds.height;
        if (imgAspect >= rectAspect) {
          frame.style.width = "100%";
          frame.style.height = `${(rectAspect / imgAspect) * 100}%`;
        } else {
          frame.style.height = "100%";
          frame.style.width = `${(imgAspect / rectAspect) * 100}%`;
        }
      };
      const frameImg = new Image();
      frameImg.onload = () => requestAnimationFrame(sizeFrame);
      frameImg.src = layer.dataUrl;
      requestAnimationFrame(sizeFrame);

      // Fog overlay (inside frame so it aligns with the image)
      if (layer.fogEnabled && layer.fogDataUrl) {
        const fogOverlay = frame.createDiv("dm-layer-fog-overlay");
        fogOverlay.style.backgroundImage = `url(${layer.fogDataUrl})`;
      }

      // Fog drawing canvas (inside frame, sized to the visible image)
      if (this.fogEditLayerId === layer.id) {
        rect.addClass("dm-fog-editing");
        const fogDrawCanvas = frame.createEl("canvas", { cls: "dm-fog-draw-canvas-inline" });
        setTimeout(() => this.initInlineFogCanvas(fogDrawCanvas, layer, frame), 0);
      }

      rect.createSpan({ cls: "dm-layer-rect-label", text: layer.label });

      if (this.fogEditLayerId !== layer.id) {
        this.makeDraggable(rect, layer, previewInner);
      }
    }

    // Player viewport indicator (green rectangle): only shown when exactly one
    // client is connected — multi-client viewports are ambiguous.
    const singleClient = this.connectedClients.length === 1 ? this.connectedClients[0] : null;
    const vp = singleClient && singleClient.width > 0 && singleClient.height > 0
      ? this.getPlayerViewport()
      : null;
    if (vp) {
      const vpRect = previewInner.createDiv("dm-player-viewport-rect");
      vpRect.style.left = `${vp.vpX}%`;
      vpRect.style.top = `${vp.vpY}%`;
      vpRect.style.width = `${vp.vpW}%`;
      vpRect.style.height = `${vp.vpH}%`;

      // Scale visibility with zoom — more prominent when zoomed out further.
      // Divide by dmZoom to compensate for the CSS transform scale on previewInner.
      const zoomFactor = Math.max(0, Math.min(1, 1 - this.dmZoom));
      const baseBorder = 2 + zoomFactor * 4;
      const borderWidth = baseBorder / this.dmZoom;
      const fillOpacity = 0.02 + zoomFactor * 0.2;
      vpRect.style.borderWidth = `${borderWidth}px`;
      vpRect.style.backgroundColor = `rgba(0, 255, 0, ${fillOpacity})`;
    }

    // Pan/zoom via scroll wheel on preview
    this.setupPreviewPanZoom(previewArea, previewInner);

    // DM view controls (always visible)
    const viewControls = section.createDiv("dm-preview-view-controls");
    const zoomLabel = viewControls.createSpan({ text: `${Math.round(this.dmZoom * 100)}%`, cls: "dm-zoom-label" });
    const zoomSlider = viewControls.createEl("input", { cls: "dm-zoom-slider" });
    zoomSlider.type = "range";
    zoomSlider.min = "10";
    zoomSlider.max = "500";
    zoomSlider.value = String(Math.round(this.dmZoom * 100));
    zoomSlider.addEventListener("input", () => {
      this.dmZoom = parseInt(zoomSlider.value, 10) / 100;
      zoomLabel.textContent = `${zoomSlider.value}%`;
      previewInner.style.transform = `translate(${this.dmPanX}%, ${this.dmPanY}%) scale(${this.dmZoom})`;
    });
    const resetBtn = viewControls.createEl("button", { text: "Reset View", cls: "dm-layer-btn" });
    resetBtn.addEventListener("click", () => this.resetDmView());

    // ── Layer list ──
    if (this.imageLayers.length > 0) {
      const list = section.createDiv("dm-layer-list");

      const byZ = [...this.imageLayers].sort((a, b) => b.zIndex - a.zIndex);
      for (const layer of byZ) {
        const colorIdx = this.imageLayers.indexOf(layer) % DmControlPanel.LAYER_COLORS.length;
        const color = DmControlPanel.LAYER_COLORS[colorIdx];
        const row = list.createDiv("dm-layer-row");
        if (!layer.visible) row.addClass("dm-layer-hidden");

        // Left column: eye on top (full width), fog + border side-by-side below
        const leftCol = row.createDiv("dm-layer-left-col");

        const visBtn = leftCol.createEl("button", {
          text: layer.visible ? "\u{1F441}" : "\u{1F441}\u200D\u{1F5E8}",
          cls: `dm-layer-btn dm-layer-vis-toggle ${layer.visible ? "dm-layer-vis-on" : "dm-layer-vis-off"}`,
        });
        visBtn.addEventListener("click", () => {
          layer.visible = !layer.visible;
          this.broadcastAndRender();
        });

        const bottomRow = leftCol.createDiv("dm-layer-left-bottom");

        const fogBtn = bottomRow.createEl("button", {
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
          this.broadcastAndRender();
        });

        const bordered = layer.bordered !== false;
        const borderBtn = bottomRow.createEl("button", {
          cls: `dm-layer-btn dm-border-toggle ${bordered ? "dm-border-active" : ""}`,
        });
        borderBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${bordered ? "2.5" : "1.5"}"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>`;
        borderBtn.title = bordered ? "Border ON" : "Border OFF";
        borderBtn.addEventListener("click", () => {
          layer.bordered = !bordered;
          this.broadcastAndRender();
        });

        // Middle column: name row + slider row
        const midCol = row.createDiv("dm-layer-mid-col");

        const nameRow = midCol.createDiv("dm-layer-name-row");
        const swatch = nameRow.createDiv("dm-layer-swatch");
        swatch.style.backgroundColor = color;
        nameRow.createSpan({ text: layer.label, cls: "dm-layer-label" });

        const sliderRow = midCol.createDiv("dm-layer-slider-row");
        const scaleLabel = sliderRow.createSpan({ text: `${Math.round(layer.width)}%`, cls: "dm-layer-scale-label" });
        const scaleSlider = sliderRow.createEl("input", {
          type: "range",
          cls: "dm-layer-scale-slider",
        });
        scaleSlider.min = "10";
        scaleSlider.max = "500";
        scaleSlider.value = String(Math.round(layer.width));
        scaleSlider.addEventListener("keydown", (e: KeyboardEvent) => {
          if (e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
            e.preventDefault();
            const current = parseInt(scaleSlider.value, 10);
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
          const scale = parseInt(scaleSlider.value, 10);
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

        // Right column: two button rows
        const rightCol = row.createDiv("dm-layer-right-col");

        const controls = rightCol.createDiv("dm-layer-controls");

        const rotLeftBtn = controls.createEl("button", { text: "\u21BA", cls: "dm-layer-btn" });
        rotLeftBtn.addEventListener("click", () => {
          layer.rotation = (layer.rotation - 15) % 360;
          this.broadcastAndRender();
        });

        const rotRightBtn = controls.createEl("button", { text: "\u21BB", cls: "dm-layer-btn" });
        rotRightBtn.addEventListener("click", () => {
          layer.rotation = (layer.rotation + 15) % 360;
          this.broadcastAndRender();
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
          this.broadcastAndRender();
        });

        const posRow = rightCol.createDiv("dm-layer-position-row");

        const fitWBtn = posRow.createEl("button", { text: "W", cls: "dm-layer-btn" });
        fitWBtn.title = "Fit to player width";
        fitWBtn.addEventListener("click", () => {
          const vp = this.getPlayerViewport();
          if (!vp) { new Notice("No player connected"); return; }
          const aspectRatio = layer.height / layer.width;
          layer.width = vp.vpW;
          layer.height = vp.vpW * aspectRatio;
          layer.x = vp.vpX;
          layer.y = vp.vpY + (vp.vpH - layer.height) / 2;
          this.broadcastAndRender();
        });

        const fitHBtn = posRow.createEl("button", { text: "H", cls: "dm-layer-btn" });
        fitHBtn.title = "Fit to player height";
        fitHBtn.addEventListener("click", () => {
          const vp = this.getPlayerViewport();
          if (!vp) { new Notice("No player connected"); return; }
          const aspectRatio = layer.width / layer.height;
          layer.height = vp.vpH;
          layer.width = vp.vpH * aspectRatio;
          layer.y = vp.vpY;
          layer.x = vp.vpX + (vp.vpW - layer.width) / 2;
          this.broadcastAndRender();
        });

        const alignLeftBtn = posRow.createEl("button", { text: "\u25c0", cls: "dm-layer-btn" });
        alignLeftBtn.title = "Align to left edge, centre vertically";
        alignLeftBtn.addEventListener("click", () => {
          const vp = this.getPlayerViewport();
          if (!vp) { new Notice("No player connected"); return; }
          layer.x = vp.vpX;
          layer.y = vp.vpY + (vp.vpH - layer.height) / 2;
          this.broadcastAndRender();
        });

        const centerBtn = posRow.createEl("button", { text: "\u25c6", cls: "dm-layer-btn" });
        centerBtn.title = "Centre in viewport";
        centerBtn.addEventListener("click", () => {
          const vp = this.getPlayerViewport();
          if (!vp) { new Notice("No player connected"); return; }
          layer.x = vp.vpX + (vp.vpW - layer.width) / 2;
          layer.y = vp.vpY + (vp.vpH - layer.height) / 2;
          this.broadcastAndRender();
        });

        const alignRightBtn = posRow.createEl("button", { text: "\u25b6", cls: "dm-layer-btn" });
        alignRightBtn.title = "Align to right edge, centre vertically";
        alignRightBtn.addEventListener("click", () => {
          const vp = this.getPlayerViewport();
          if (!vp) { new Notice("No player connected"); return; }
          layer.x = vp.vpX + vp.vpW - layer.width;
          layer.y = vp.vpY + (vp.vpH - layer.height) / 2;
          this.broadcastAndRender();
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
        this.broadcastAndRender();
      });
      const clearAllBtn = clearRow.createEl("button", { text: "Clear Player Screen" });
      clearAllBtn.addEventListener("click", () => {
        if (this.plugin.server) {
          this.plugin.server.broadcast({ type: "clear", payload: {} });
          this.imageLayers = [];
          this.nextZIndex = 1;
          this.activeBackgroundUrl = null;
          this.activeVideoPath = null;
          new Notice("Player screen cleared");
          this.render();
        }
      });
    }
  }

  // ─── Initiative Section ────────────────────────────────────────────

  private renderInitiativeSection(container: HTMLElement) {
    const section = container.createDiv("dm-section");

    // Header: COMBAT title + emit toggle
    const header = section.createDiv("dm-section-header");
    header.createEl("h3", { text: "COMBAT" });

    const broadcasting = this.isCombatBroadcasting();
    const emitToggle = header.createEl("button", {
      cls: broadcasting ? "dm-emit-toggle dm-emit-active" : "dm-emit-toggle",
      attr: {
        "aria-label": broadcasting ? "Stop broadcasting combat" : "No combat being broadcast",
        title: broadcasting ? "Stop broadcasting combat" : "No combat being broadcast",
      },
    });
    emitToggle.createSpan({ cls: "dm-emit-dot", text: "●" });
    emitToggle.createSpan({ cls: "dm-emit-label", text: "Live" });
    if (!broadcasting) {
      (emitToggle as HTMLButtonElement).disabled = true;
    }
    emitToggle.addEventListener("click", () => this.stopAllCombatBroadcast());

    // Tabs: Local Track + (optionally) D&D Beyond, full-width
    const ddbActive = this.plugin.settings.ddbEnabled && this.plugin.settings.ddbCobaltSession;
    const tabBar = section.createDiv("dm-combat-tabs");

    const initTab = tabBar.createEl("button", {
      text: "Local Track",
      cls: !ddbActive || this.combatTab === "initiative" ? "dm-tab-active" : "dm-tab",
    });
    initTab.addEventListener("click", () => {
      this.combatTab = "initiative";
      this.render();
    });

    if (ddbActive) {
      const ddbTab = tabBar.createEl("button", {
        text: "D&D Beyond",
        cls: this.combatTab === "dndbeyond" ? "dm-tab-active" : "dm-tab",
      });
      ddbTab.addEventListener("click", () => {
        this.combatTab = "dndbeyond";
        this.render();
      });
    }

    // Active combat name + scale controls row
    const nameRow = section.createDiv("dm-combat-name-row");
    const combatLabel = this.getActiveCombatLabel();
    if (combatLabel.ddbId) {
      const url = `https://www.dndbeyond.com/encounters/${combatLabel.ddbId}`;
      const link = nameRow.createEl("a", {
        cls: "dm-combat-name dm-combat-name-link",
        text: combatLabel.text,
        attr: { href: url, target: "_blank", rel: "noopener" },
      });
      link.addEventListener("click", (evt) => {
        evt.preventDefault();
        try {
          require("electron").shell.openExternal(url);
        } catch {
          window.open(url, "_blank");
        }
      });
    } else {
      nameRow.createDiv({ cls: "dm-combat-name", text: combatLabel.text });
    }
    const scaleButtons = nameRow.createDiv("dm-tracker-scale-buttons");
    const decBtn = scaleButtons.createEl("button", { text: "−", attr: { title: "Smaller tracker" } });
    decBtn.addEventListener("click", () => this.adjustCombatTrackerScale(-0.1));
    const resetBtn = scaleButtons.createEl("button", { text: "1×", attr: { title: "Reset tracker scale" } });
    resetBtn.addEventListener("click", () => this.setCombatTrackerScale(1));
    const incBtn = scaleButtons.createEl("button", { text: "+", attr: { title: "Larger tracker" } });
    incBtn.addEventListener("click", () => this.adjustCombatTrackerScale(0.1));

    if (ddbActive && this.combatTab === "dndbeyond") {
      const ddbContainer = section.createDiv("dm-ddb-panel");
      if (!this.ddbPanel) {
        this.ddbPanel = new DnDBeyondPanel(this.plugin, ddbContainer);
        this.ddbPanel.onTrackingChange = () => this.debouncedRender();
        this.ddbPanel.initialize();
      } else {
        this.ddbPanel.setContainer(ddbContainer);
      }
    } else {
      if (this.trackerSource === "plugin") {
        this.renderPluginTracker(section);
      } else {
        this.renderManualTracker(section);
      }
    }
  }

  // ─── Combat Broadcasting Helpers ───────────────────────────────────

  isCombatBroadcasting(): boolean {
    if (this.trackerSource === "plugin" && this.pluginCombatants.length > 0) return true;
    if (this.manualCombatants.length > 0) return true;
    if (this.ddbPanel && this.ddbPanel.isTracking()) return true;
    return false;
  }

  stopAllCombatBroadcast(): void {
    debug("DmControlPanel: stopAllCombatBroadcast");
    if (this.ddbPanel) this.ddbPanel.stopTracking();
    this.manualCombatants = [];
    this.currentTurn = 0;
    this.manualRound = 1;
    this.trackerSource = "manual";
    this.pluginCombatants = [];
    this.pluginRound = 0;
    this.encounterName = "";
    this.plugin.sendInitiativeUpdate([], 0);
    this.render();
  }

  private async adjustCombatTrackerScale(delta: number) {
    const current = this.plugin.settings.combatTrackerScale ?? 1;
    const next = Math.round((current + delta) * 10) / 10;
    await this.setCombatTrackerScale(next);
  }

  private async setCombatTrackerScale(value: number) {
    const clamped = Math.max(0.5, Math.min(2, Math.round(value * 10) / 10));
    if (clamped === (this.plugin.settings.combatTrackerScale ?? 1)) return;
    this.plugin.settings.combatTrackerScale = clamped;
    await this.plugin.saveSettings();
    if (this.plugin.server) {
      this.plugin.server.broadcast({
        type: "combat-scale",
        payload: { scale: clamped },
      });
    }
  }

  private getActiveCombatLabel(): { text: string; ddbId: string | null } {
    if (this.combatTab === "dndbeyond" && this.ddbPanel) {
      const status = this.ddbPanel.getActiveEncounterStatus();
      if (status) return { text: `${status.name} — Round ${status.roundNum}`, ddbId: status.id };
    }
    if (this.trackerSource === "plugin" && this.encounterName) {
      return { text: `${this.encounterName} — Round ${this.pluginRound}`, ddbId: null };
    }
    return { text: "", ddbId: null };
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

    this.appendStatusIcons(row, c.statuses);

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
      const initiative = parseInt(initInput.value, 10) || 0;
      const hp = parseInt(hpInput.value, 10) || 0;
      if (name) {
        this.manualCombatants.push({ name, initiative, hp, maxHp: hp, active: false, statuses: [] });
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
      const nameEl = row.createSpan({ text: c.name, cls: "dm-combatant-name" });
      nameEl.style.cursor = "pointer";
      nameEl.addEventListener("click", (evt) => this.openManualConditionMenu(c, evt));
      this.appendStatusIcons(row, c.statuses);

      const hpEl = row.createEl("input", { type: "number", cls: "dm-hp-input" });
      hpEl.value = String(c.hp);
      hpEl.style.width = "60px";
      hpEl.addEventListener("change", () => {
        c.hp = parseInt(hpEl.value, 10) || 0;
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
        this.manualRound = 1;
        this.manualCombatants.forEach(c => (c.active = false));
        if (this.manualCombatants.length > 0) this.manualCombatants[0].active = true;
        this.broadcastManualInitiative();
        this.render();
      });

      const clearAllBtn = turnRow.createEl("button", { text: "Clear All" });
      clearAllBtn.addEventListener("click", () => {
        this.manualCombatants = [];
        this.currentTurn = 0;
        this.manualRound = 1;
        this.broadcastManualInitiative();
        this.render();
      });
    }
  }

  addImageLayer(label: string, dataUrl: string, noteType?: string, visible = true) {
    const exists = this.imageLayers.some(
      (l) => l.label.toLowerCase() === label.toLowerCase()
    );
    if (exists) return;

    // Load image to get natural dimensions, then size correctly
    const img = new Image();
    img.onload = () => {
      const { width: tvW, height: tvH } = this.getEffectiveResolution();
      const isPortrait = noteType === "person" || noteType === "monster";

      let x = 0, y = 0, width: number, height: number;

      if (isPortrait) {
        width = 30;
        height = 60;
        x = 35;
        y = 20;
      } else {
        width = (img.naturalWidth / tvW) * 100;
        height = (img.naturalHeight / tvH) * 100;

        if (width > 100 || height > 100) {
          const scale = Math.max(width, height) / 100;
          width /= scale;
          height /= scale;
        }

        x = (100 - width) / 2;
        y = (100 - height) / 2;
      }

      const layer: ImageLayer = {
        id: `layer-${Date.now()}-${this.nextLayerSeq++}`,
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
        bordered: true,
      };

      this.imageLayers.push(layer);
      debug(
        "DmControlPanel: addImageLayer pushed", layer.id,
        "label:", layer.label,
        "noteType:", noteType ?? "(none)",
        "visible:", visible,
        "total:", this.imageLayers.length
      );
      this.broadcastAndRender();
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
    // Size canvas to match the host element's rendered size. `rect` here is
    // actually the .dm-layer-rect-frame (renamed `frame` upstream so the fog
    // overlay aligns with the visible image, not the broadcast wrapper).
    const rectBounds = rect.getBoundingClientRect();
    if (rectBounds.width < 1 || rectBounds.height < 1) {
      debugWarn(
        "initInlineFogCanvas: host element has zero-size bounds",
        "(width=", rectBounds.width.toFixed(2),
        "height=", rectBounds.height.toFixed(2),
        ") — fog canvas init skipped"
      );
      return;
    }
    canvas.width = rectBounds.width;
    canvas.height = rectBounds.height;
    debug(
      "initInlineFogCanvas: layer", layer.id,
      "canvas=", canvas.width.toFixed(0), "x", canvas.height.toFixed(0),
      "tool=", this.fogTool
    );

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
      debug(
        "fog: mousedown layer", layer.id,
        "tool=", this.fogTool,
        "start=", x.toFixed(0), ",", y.toFixed(0)
      );
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
      let endX = startX;
      let endY = startY;
      if (!isFreehand()) {
        const { x, y } = toFogCoord(e);
        endX = x;
        endY = y;
        if (Math.abs(x - startX) > 3 || Math.abs(y - startY) > 3) {
          applyShape(startX, startY, x, y);
        }
      }
      debug(
        "fog: mouseup layer", layer.id,
        "tool=", this.fogTool,
        "end=", endX.toFixed(0), ",", endY.toFixed(0),
        "shiftHeld=", e.shiftKey,
        "type=", e.type
      );
      this.syncFogToLayer(layer);

      // Update fog overlay in preview
      const fogOverlay = rect.querySelector(".dm-layer-fog-overlay") as HTMLElement;
      if (fogOverlay) {
        fogOverlay.style.backgroundImage = `url(${layer.fogDataUrl})`;
      }

      // Shift held = stay in edit mode, otherwise exit
      if (!e.shiftKey) {
        debug("fog: exiting edit mode for layer", layer.id);
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
    // render() runs frequently and re-binds these listeners. Without an abort
    // signal, the document-level mousemove/mouseup handlers accumulate every
    // render and leak. The previewArea-bound listeners are GC'd with the old
    // DOM, but we route them through the same controller for symmetry.
    this.panZoomAbort?.abort();
    this.panZoomAbort = new AbortController();
    const { signal } = this.panZoomAbort;

    // Wheel-to-zoom is intentionally NOT bound: it would swallow page scroll
    // whenever the cursor was over the preview. Zoom is driven exclusively
    // by the `.dm-zoom-slider` + reset button rendered above the preview.

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
    }, { signal });

    document.addEventListener("mousemove", (e) => {
      if (!panning) return;
      const bounds = previewArea.getBoundingClientRect();
      const dx = ((e.clientX - panStartX) / bounds.width) * 100;
      const dy = ((e.clientY - panStartY) / bounds.height) * 100;
      this.dmPanX = panStartPanX + dx;
      this.dmPanY = panStartPanY + dy;
      previewInner.style.transform = `translate(${this.dmPanX}%, ${this.dmPanY}%) scale(${this.dmZoom})`;
    }, { signal });

    document.addEventListener("mouseup", (e) => {
      if (panning && e.button === 1) {
        panning = false;
      }
    }, { signal });
  }

  private resetDmView() {
    this.dmZoom = 1;
    this.dmPanX = 0;
    this.dmPanY = 0;
    this.render();
  }

  private broadcastPlayerViewport() {
    if (!this.plugin.server) return;
    const { width: tvW, height: tvH } = this.getEffectiveResolution();
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
      if (fm["image"]) {
        const resolved = this.plugin.app.metadataCache.getFirstLinkpathDest(fm["image"], activeFile.path);
        if (resolved) {
          images.push({ label: `image: ${resolved.name}`, path: resolved.path, source: "image" });
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
          const dataUrls = await Promise.all(
            images.map((img) => this.plugin.imageToDataUrl(img.path))
          );
          let added = 0;
          dataUrls.forEach((dataUrl, i) => {
            if (dataUrl) {
              const img = images[i];
              this.addImageLayer(`${activeFile.basename} (${img.source})`, dataUrl, noteType, false);
              added++;
            }
          });
          new Notice(`Added ${added} image${added > 1 ? "s" : ""} (hidden)`);
        });
      });
    }

    menu.showAtMouseEvent(evt);
  }

  private showBackgroundPicker(evt: MouseEvent): void {
    const activeFile = this.plugin.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice("No active note");
      return;
    }

    const images = this.getImagesFromNote(activeFile);
    if (images.length === 0) {
      new Notice("No images found in note");
      return;
    }

    if (images.length === 1) {
      this.setImageAsBackground(images[0]);
      return;
    }

    const { Menu } = require("obsidian");
    const menu = new Menu();
    for (const img of images) {
      menu.addItem((item: any) => {
        item.setTitle(img.label);
        item.onClick(() => this.setImageAsBackground(img));
      });
    }
    menu.showAtMouseEvent(evt);
  }

  private setImageAsBackground(img: { path: string; label: string }): void {
    const url = `/vault/${encodeURIComponent(img.path)}`;
    debug("DmControlPanel: setImageAsBackground", img.path);
    this.activeBackgroundUrl = url;
    this.activeVideoPath = null;
    if (this.plugin.server) {
      this.plugin.server.broadcast({
        type: "show-background-media",
        payload: { url, mediaType: "image" },
      });
    }
    this.render();
  }

  private getImagesFromNote(file: TFile): Array<{ path: string; label: string }> {
    const imageExts = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
    const results: Array<{ path: string; label: string }> = [];

    const cache = this.plugin.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;

    if (fm) {
      if (fm["image"]) {
        const resolved = this.plugin.app.metadataCache.getFirstLinkpathDest(fm["image"], file.path);
        if (resolved && imageExts.some(ext => resolved.path.toLowerCase().endsWith(ext))) {
          results.push({ path: resolved.path, label: `image: ${resolved.name}` });
        }
      }
      if (fm["portrait"]) {
        const portraitStr = String(fm["portrait"]).replace(/^\[\[/, "").replace(/\]\]$/, "");
        const resolved = this.plugin.app.metadataCache.getFirstLinkpathDest(portraitStr, file.path);
        if (resolved && imageExts.some(ext => resolved.path.toLowerCase().endsWith(ext))) {
          results.push({ path: resolved.path, label: `portrait: ${resolved.name}` });
        }
      }
    }

    if (cache?.embeds) {
      for (const embed of cache.embeds) {
        if (/\.(png|jpg|jpeg|webp|gif)$/i.test(embed.link)) {
          const resolved = this.plugin.app.metadataCache.getFirstLinkpathDest(embed.link, file.path);
          if (resolved && !results.some(r => r.path === resolved.path)) {
            results.push({ path: resolved.path, label: resolved.name });
          }
        }
      }
    }

    return results;
  }

  private makeDraggable(rect: HTMLElement, layer: ImageLayer, preview: HTMLElement) {
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    // Cached at mousedown so a mid-drag re-render that detaches `preview`
    // can't poison the math: a detached element returns width/height = 0,
    // which would otherwise produce Infinity for dx/dy and corrupt layer.x/y.
    let startBounds: DOMRect | null = null;

    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = layer.x;
      startTop = layer.y;
      startBounds = preview.getBoundingClientRect();
      debug(
        "makeDraggable: mousedown layer", layer.id,
        "startLeft=", startLeft.toFixed(2),
        "startTop=", startTop.toFixed(2),
        "bounds=", startBounds.width.toFixed(0), "x", startBounds.height.toFixed(0)
      );
      if (!Number.isFinite(startLeft) || !Number.isFinite(startTop)) {
        debugWarn("makeDraggable: layer has non-finite coords at mousedown — drag will be a no-op until reset");
      }
      if (startBounds.width === 0 || startBounds.height === 0) {
        debugWarn("makeDraggable: preview has zero-size bounds at mousedown — drag will be a no-op");
      }
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!startBounds || startBounds.width === 0 || startBounds.height === 0) return;
      const dx = ((e.clientX - startX) / startBounds.width) * 100;
      const dy = ((e.clientY - startY) / startBounds.height) * 100;
      layer.x = startLeft + dx;
      layer.y = startTop + dy;
      rect.style.left = `${layer.x}%`;
      rect.style.top = `${layer.y}%`;
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      debug(
        "makeDraggable: mouseup layer", layer.id,
        "x=", layer.x.toFixed(2),
        "y=", layer.y.toFixed(2),
        "finite=", Number.isFinite(layer.x) && Number.isFinite(layer.y)
      );
      startBounds = null;
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
      this.broadcastAndRender();
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
      this.broadcastAndRender();
    }
  }

  broadcastImageLayers() {
    if (!this.plugin.server) return;
    debug("DmControlPanel: broadcastImageLayers —", this.imageLayers.length, "layer(s)");
    this.plugin.server.broadcast({
      type: "image-layers-sync",
      payload: { layers: this.imageLayers },
    });
    this.scheduleSaveState();
  }

  private broadcastAndRender() {
    this.broadcastImageLayers();
    this.render();
  }

  // ─── Manual Tracker Helpers ────────────────────────────────────────

  private sortManualCombatants() {
    this.manualCombatants.sort((a, b) => b.initiative - a.initiative);
  }

  private advanceManualTurn() {
    if (this.manualCombatants.length === 0) return;
    this.manualCombatants.forEach(c => (c.active = false));
    const next = this.currentTurn + 1;
    if (next >= this.manualCombatants.length) {
      this.currentTurn = 0;
      this.manualRound += 1;
    } else {
      this.currentTurn = next;
    }
    this.manualCombatants[this.currentTurn].active = true;
    this.broadcastManualInitiative();
    this.render();
  }

  private openManualConditionMenu(c: ManualCombatant, evt: MouseEvent): void {
    debug("DmControlPanel: open manual condition menu for", c.name);
    const current = new Set(c.statuses);
    const menu = new Menu();

    for (const cond of Object.values(CONDITIONS)) {
      const active = current.has(cond.id);
      menu.addItem((item) => {
        item.setTitle(cond.name).setChecked(active).onClick(() => {
          if (active) c.statuses = c.statuses.filter((s) => s !== cond.id);
          else c.statuses = [...c.statuses, cond.id];
          this.broadcastManualInitiative();
          this.render();
        });
      });
    }

    menu.addSeparator();

    let currentExhaustion = 0;
    for (const s of current) {
      if (s.startsWith("exhaustion:")) {
        const n = parseInt(s.slice("exhaustion:".length), 10);
        if (Number.isFinite(n) && n >= 1 && n <= 6) currentExhaustion = n;
      }
    }
    menu.addItem((item) => {
      item.setTitle(currentExhaustion === 0 ? "Exhaustion — None" : `Exhaustion — Level ${currentExhaustion}`).setDisabled(true);
    });
    const setExhaustion = (level: number): void => {
      c.statuses = c.statuses.filter((s) => !s.startsWith("exhaustion:"));
      const enc = encodeExhaustion(level);
      if (enc) c.statuses = [...c.statuses, enc];
      this.broadcastManualInitiative();
      this.render();
    };
    menu.addItem((item) => {
      item.setTitle("  Remove exhaustion").setChecked(currentExhaustion === 0).onClick(() => setExhaustion(0));
    });
    for (let n = 1; n <= 6; n++) {
      menu.addItem((item) => {
        item.setTitle(`  Exhaustion ${n}`).setChecked(currentExhaustion === n).onClick(() => setExhaustion(n));
      });
    }

    menu.showAtMouseEvent(evt);
  }

  private appendStatusIcons(parent: HTMLElement, statuses: string[]) {
    if (!statuses || statuses.length === 0) return;
    const wrap = parent.createSpan({ cls: "dm-statuses" });
    for (const status of statuses) {
      const d = decodeStatus(status);
      if (d.kind === "condition") {
        const icon = wrap.createSpan({ cls: "dm-status-icon" });
        icon.title = d.def.name;
        icon.innerHTML = d.def.iconSvg;
      } else if (d.kind === "exhaustion") {
        const icon = wrap.createSpan({ cls: "dm-status-icon dm-status-exhaustion" });
        icon.title = `Exhaustion (Level ${d.level})`;
        icon.innerHTML = d.iconSvg;
        const level = icon.createSpan({ cls: "dm-status-level" });
        level.textContent = String(d.level);
      } else {
        wrap.createSpan({ cls: "dm-status-badge", text: d.text });
      }
    }
  }

  private broadcastManualInitiative() {
    const isRoundOne = this.manualRound === 1;
    const activeIdx = this.manualCombatants.findIndex(c => c.active);
    const out = this.manualCombatants.map((c, i) => ({
      ...c,
      hidden: isRoundOne && activeIdx >= 0 && i > activeIdx,
    }));
    this.plugin.sendInitiativeUpdate(out, this.manualRound);
  }
}

export function resolveBackgroundPreviewUrl(
  activeUrl: string | null,
  adapter: { getResourcePath?: (path: string) => string }
): string | null {
  if (!activeUrl) return null;
  if (!activeUrl.startsWith("/vault/")) return activeUrl;
  if (typeof adapter.getResourcePath !== "function") return null;
  const vaultPath = decodeURIComponent(activeUrl.slice("/vault/".length));
  return adapter.getResourcePath(vaultPath);
}

export function isVideoBackgroundUrl(url: string): boolean {
  return /\.(mp4|webm|mov|ogv)(\?|$)/i.test(url);
}
