import { Menu, Notice } from "obsidian";
import type DmScreenPlugin from "../main";
import type { DmControlPanel } from "./DmControlPanel";
import { encodeForVaultUrl } from "./HydrusExplorerModal";
import { ensureLocalCopy, type ResolvedHydrusRef } from "../hydrus/noteRefs";
import { vaultPathFromUrl, type ClientInfo } from "../server";
import {
  clampPan,
  cssPixelsPerInch,
  defaultMapState,
  profileKey,
  rotatePoint,
} from "../map/transform";
import type { AoePreset, AoeShape, MapAoe, MapRotation, StoredMapState } from "../map/types";
import { renderAoe } from "../map/aoe";
import { SpellAoeModal } from "./SpellAoeModal";
import { MapCalibrationModal } from "./MapCalibrationModal";
import { debug } from "../debug";

export interface ActiveMap {
  url: string;
  mediaType: "image" | "video";
  naturalWidth: number;
  naturalHeight: number;
}

const VIEW_BROADCAST_THROTTLE_MS = 80;

const AOE_SHAPES: AoeShape[] = ["circle", "square", "cone", "line"];

const SHAPE_PRESETS: AoePreset[] = [
  { name: "Circle", shape: "circle", sizeFt: 20, widthFt: 5, color: "#ff4400", opacity: 0.3 },
  { name: "Square", shape: "square", sizeFt: 15, widthFt: 5, color: "#44aaff", opacity: 0.3 },
  { name: "Cone", shape: "cone", sizeFt: 15, widthFt: 5, color: "#ff9900", opacity: 0.3 },
  { name: "Line", shape: "line", sizeFt: 30, widthFt: 5, color: "#f5d90a", opacity: 0.3 },
];

let nextAoeId = 1;

export class MapScreenPanel {
  activeMap: ActiveMap | null = null;
  state: StoredMapState = defaultMapState(0, 0);
  mapClients: ClientInfo[] = [];
  aoes: MapAoe[] = [];
  private viewBroadcastTimer: ReturnType<typeof setTimeout> | null = null;
  private aoeBroadcastTimer: ReturnType<typeof setTimeout> | null = null;
  private redrawPreviewAoes: (() => void) | null = null;
  private previewZoom = 1;
  private previewPanX = 0;
  private previewPanY = 0;
  private previewLocked = false;

  constructor(private plugin: DmScreenPlugin, private host: DmControlPanel) {}

  restoreFromCache(cache: Record<string, string>) {
    const show = cache["map-show"];
    if (!show) return;
    try {
      const payload = JSON.parse(show).payload as Partial<ActiveMap> | undefined;
      if (!payload?.url) return;
      this.activeMap = {
        url: payload.url,
        mediaType: payload.mediaType === "video" ? "video" : "image",
        naturalWidth: payload.naturalWidth ?? 0,
        naturalHeight: payload.naturalHeight ?? 0,
      };
    } catch {
      return;
    }
    this.state =
      this.plugin.settings.mapConfigs[this.activeMap.url] ??
      defaultMapState(
        this.activeMap.naturalWidth,
        this.activeMap.naturalHeight,
        this.plugin.settings.mapDefaultPxPerSquare
      );
    for (const type of ["map-view", "map-config"]) {
      const cached = cache[type];
      if (!cached) continue;
      try {
        Object.assign(this.state, JSON.parse(cached).payload);
      } catch { /* ignore */ }
    }
    const aoeCache = cache["map-aoe-sync"];
    if (aoeCache) {
      try {
        this.aoes = ((JSON.parse(aoeCache).payload as { aoes?: MapAoe[] })?.aoes ?? []);
      } catch { /* ignore */ }
    }
    this.clampStateToViewport();
    debug("MapScreenPanel: restoreFromCache —", this.activeMap.url, this.state.mode, `${this.aoes.length} AoEs`);
  }

  republish() {
    if (!this.plugin.server) return;
    this.plugin.broadcastMapCalibration();
    if (!this.activeMap) return;
    debug("MapScreenPanel: republish —", this.activeMap.url);
    this.broadcastShow();
    this.broadcastConfig();
    this.broadcastView(true);
    if (this.aoes.length > 0) this.broadcastAoes(true);
  }

  private broadcastShow() {
    if (!this.activeMap) return;
    this.plugin.server?.broadcast({
      type: "map-show",
      payload: {
        ...this.activeMap,
        loop: this.plugin.settings.hydrusDefaultLoop,
        muted: this.plugin.settings.hydrusDefaultMuted,
      },
    });
  }

  private broadcastConfig() {
    const { pxPerSquare, gridOffsetX, gridOffsetY, showGrid, gridColor, gridOpacity } = this.state;
    this.plugin.server?.broadcast({
      type: "map-config",
      payload: { pxPerSquare, gridOffsetX, gridOffsetY, showGrid, gridColor, gridOpacity },
    });
  }

  private broadcastView(immediate = false) {
    const send = () => {
      const { mode, panX, panY, rotation } = this.state;
      this.plugin.server?.broadcast({ type: "map-view", payload: { mode, panX, panY, rotation: rotation ?? 0 } });
    };
    if (immediate) {
      if (this.viewBroadcastTimer) {
        clearTimeout(this.viewBroadcastTimer);
        this.viewBroadcastTimer = null;
      }
      send();
      return;
    }
    if (this.viewBroadcastTimer) return;
    this.viewBroadcastTimer = setTimeout(() => {
      this.viewBroadcastTimer = null;
      send();
    }, VIEW_BROADCAST_THROTTLE_MS);
  }

  private broadcastAoes(immediate = false) {
    const send = () => {
      this.plugin.server?.broadcast({ type: "map-aoe-sync", payload: { aoes: this.aoes } });
    };
    if (immediate) {
      if (this.aoeBroadcastTimer) {
        clearTimeout(this.aoeBroadcastTimer);
        this.aoeBroadcastTimer = null;
      }
      send();
      return;
    }
    if (this.aoeBroadcastTimer) return;
    this.aoeBroadcastTimer = setTimeout(() => {
      this.aoeBroadcastTimer = null;
      send();
    }, VIEW_BROADCAST_THROTTLE_MS);
  }

  private clampStateToViewport() {
    if (!this.activeMap || this.state.mode !== "physical") return;
    const client = this.effectiveMapClient();
    const { ppi } = this.clientPpi(client);
    const clamped = clampPan(
      this.state.panX,
      this.state.panY,
      this.activeMap.naturalWidth,
      this.activeMap.naturalHeight,
      client.width,
      client.height,
      ppi / this.state.pxPerSquare,
      this.state.rotation ?? 0
    );
    this.state.panX = clamped.panX;
    this.state.panY = clamped.panY;
  }

  private persistState() {
    if (!this.activeMap) return;
    this.plugin.settings.mapConfigs[this.activeMap.url] = { ...this.state };
    void this.plugin.saveSettings();
  }

  async setVaultMap(vaultPath: string, mediaType: "image" | "video") {
    const adapter = this.plugin.app.vault.adapter as { getResourcePath?: (p: string) => string };
    const resourceUrl = adapter.getResourcePath?.(vaultPath);
    const dims = resourceUrl ? await measureMedia(resourceUrl, mediaType) : null;
    if (!dims) {
      new Notice("Could not read the map's dimensions.");
      return;
    }
    const url = `/vault/${encodeForVaultUrl(vaultPath)}`;
    const stored = this.plugin.settings.mapConfigs[url];
    this.state = stored
      ? { ...stored }
      : defaultMapState(dims.w, dims.h, this.plugin.settings.mapDefaultPxPerSquare);
    this.activeMap = { url, mediaType, naturalWidth: dims.w, naturalHeight: dims.h };
    this.aoes = [];
    this.previewZoom = 1;
    this.previewPanX = 0;
    this.previewPanY = 0;
    this.clampStateToViewport();
    debug("MapScreenPanel: setVaultMap", vaultPath, mediaType, `${dims.w}×${dims.h}`, stored ? "(remembered config)" : "(defaults)");
    this.broadcastShow();
    this.broadcastConfig();
    this.broadcastView(true);
    this.broadcastAoes(true);
    this.persistState();
    this.host.render();
  }

  stopMap() {
    debug("MapScreenPanel: stopMap");
    this.activeMap = null;
    this.aoes = [];
    this.plugin.server?.broadcast({ type: "map-clear", payload: {} });
    this.host.render();
  }

  private async applyHydrusRefAsMap(ref: ResolvedHydrusRef) {
    try {
      const entry = await ensureLocalCopy(ref, this.plugin.hydrusCache!, this.plugin.buildHydrusClient());
      await this.setVaultMap(entry.vaultPath, ref.mediaType === "video" ? "video" : "image");
      await this.plugin.hydrusCache!.markUsed(ref.hash);
    } catch (err) {
      new Notice(`Hydrus: ${(err as Error).message}`, 6000);
    }
  }

  async showMapPicker(evt: MouseEvent) {
    const activeFile = this.plugin.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice("No active note");
      return;
    }
    const images = this.host.getImagesFromNote(activeFile);
    const refs = await this.host.collectHydrusRefEntries(activeFile);
    const hydrus = refs.filter((r) => !r.available || r.mediaType === "image" || r.mediaType === "video");
    const hydrusActionable = hydrus.filter((r) => r.available);
    const disabled = hydrus.filter((r) => !r.available);

    if (images.length === 0 && hydrusActionable.length === 0 && disabled.length === 0) {
      new Notice("No images found in note");
      return;
    }

    if (images.length + hydrusActionable.length === 1 && disabled.length === 0) {
      if (images.length === 1) {
        void this.setVaultMap(images[0].path, "image");
      } else {
        void this.applyHydrusRefAsMap(hydrusActionable[0]);
      }
      return;
    }

    const menu = new Menu();
    for (const img of images) {
      menu.addItem((item: any) => {
        item.setTitle(img.label);
        item.onClick(() => void this.setVaultMap(img.path, "image"));
      });
    }
    for (const ref of hydrus) {
      menu.addItem((item: any) => {
        item.setTitle(`Hydrus: ${ref.label}${ref.available ? "" : " (offline, not cached)"}`).setIcon("link");
        if (!ref.available) {
          item.setDisabled(true);
          return;
        }
        item.onClick(() => void this.applyHydrusRefAsMap(ref));
      });
    }
    menu.showAtMouseEvent(evt);
  }

  private effectiveMapClient(): { width: number; height: number; devicePixelRatio: number } {
    if (this.mapClients.length > 0) return this.mapClients[0];
    return {
      width: this.plugin.settings.tvWidth || 1920,
      height: this.plugin.settings.tvHeight || 1080,
      devicePixelRatio: 1,
    };
  }

  private clientPpi(client: { width: number; height: number; devicePixelRatio: number }): {
    ppi: number;
    calibrated: boolean;
  } {
    const profile =
      this.plugin.settings.mapScreenProfiles[profileKey(client.width, client.height, client.devicePixelRatio)];
    return { ppi: cssPixelsPerInch(client.width, client.height, profile), calibrated: !!profile };
  }

  renderSection(container: HTMLElement) {
    const section = container.createDiv("dm-section");
    const title = section.createEl("h3", { text: "Map Screen" });
    this.host.makeCollapsible(section, title, "map-screen");

    const isRunning = !!this.plugin.server;
    if (isRunning) {
      const port = this.plugin.settings.serverPort;
      const lanIp = this.host.getLanIp();
      const mapUrl = `http://${lanIp ?? "localhost"}:${port}/map`;
      const urlRow = section.createDiv("dm-server-url");
      const link = urlRow.createEl("a", { text: `Map: ${mapUrl}`, href: mapUrl, cls: "dm-server-url-link" });
      link.setAttr("target", "_blank");
      const copyBtn = urlRow.createEl("button", { text: "Copy", cls: "dm-copy-url-btn" });
      copyBtn.addEventListener("click", () => {
        void navigator.clipboard.writeText(mapUrl);
        copyBtn.textContent = "Copied!";
        setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
      });
    }

    if (this.mapClients.length > 0) {
      const clientInfo = section.createDiv("dm-client-info");
      clientInfo.createSpan({
        text: `${this.mapClients.length} map screen${this.mapClients.length > 1 ? "s" : ""} connected`,
        cls: "dm-status-detail",
      });
      const seen = new Set<string>();
      for (const c of this.mapClients) {
        const key = profileKey(c.width, c.height, c.devicePixelRatio);
        if (seen.has(key)) continue;
        seen.add(key);
        const { calibrated } = this.clientPpi(c);
        const badge = clientInfo.createSpan({
          text: `${c.width}×${c.height}${calibrated ? " ✓" : " — calibrate"}`,
          cls: "dm-client-resolution",
        });
        badge.title = calibrated
          ? "Calibrated — click to adjust"
          : "Click to calibrate this screen's physical size";
        badge.addEventListener("click", () => {
          new MapCalibrationModal(this.plugin.app, this.plugin, c, () => this.host.render()).open();
        });
      }
    } else if (isRunning) {
      section.createDiv({
        cls: "dm-status-detail",
        text: "Open the map URL on the table screen to connect it.",
      });
    }

    const btnRow = section.createDiv("dm-layer-btn-row");
    const mapBtn = btnRow.createEl("button", {
      text: this.activeMap ? "Stop Map" : "Add Map",
      cls: this.activeMap ? "" : "mod-cta",
    });
    mapBtn.addEventListener("click", (evt: MouseEvent) => {
      if (this.activeMap) {
        this.stopMap();
      } else {
        void this.showMapPicker(evt);
      }
    });

    if (!this.activeMap) return;
    const map = this.activeMap;

    const modeBtn = btnRow.createEl("button", {
      text: this.state.mode === "physical" ? "Scale: physical 1″" : "Scale: fit screen",
    });
    modeBtn.addEventListener("click", () => {
      this.state.mode = this.state.mode === "physical" ? "fit" : "physical";
      this.clampStateToViewport();
      this.broadcastView(true);
      this.persistState();
      this.host.render();
    });

    const gridBtn = btnRow.createEl("button", {
      text: this.state.showGrid ? "Grid: on" : "Grid: off",
    });
    gridBtn.addEventListener("click", () => {
      this.state.showGrid = !this.state.showGrid;
      this.broadcastConfig();
      this.persistState();
      this.host.render();
    });

    const rotateBtn = btnRow.createEl("button", { text: `Rotate: ${this.state.rotation ?? 0}°` });
    rotateBtn.title = "Rotate the map on the screen in 90° steps";
    rotateBtn.addEventListener("click", () => {
      this.state.rotation = ((((this.state.rotation ?? 0) + 90) % 360) as 0 | 90 | 180 | 270);
      this.clampStateToViewport();
      this.broadcastView(true);
      this.persistState();
      this.host.render();
    });

    this.renderGridControls(section);
    this.renderPanPreview(section, map);
    this.renderAoeControls(section, map);
  }

  private renderGridControls(section: HTMLElement) {
    const row = section.createDiv("dm-map-grid-controls");

    const numberInput = (
      label: string,
      value: number,
      min: number,
      onChange: (v: number) => void
    ) => {
      row.createSpan({ text: label, cls: "dm-status-detail" });
      const input = row.createEl("input", { type: "number" });
      input.value = String(value);
      input.min = String(min);
      input.addEventListener("change", () => {
        const v = parseFloat(input.value);
        if (!Number.isFinite(v) || v < min) return;
        onChange(v);
        this.broadcastConfig();
        this.persistState();
      });
    };

    numberInput("px/square", this.state.pxPerSquare, 5, (v) => { this.state.pxPerSquare = v; });
    numberInput("offset X", this.state.gridOffsetX, -10000, (v) => { this.state.gridOffsetX = v; });
    numberInput("offset Y", this.state.gridOffsetY, -10000, (v) => { this.state.gridOffsetY = v; });

    const color = row.createEl("input", { type: "color" });
    color.value = this.state.gridColor;
    color.title = "Grid line color";
    color.addEventListener("change", () => {
      this.state.gridColor = color.value;
      this.broadcastConfig();
      this.persistState();
    });

    const opacity = row.createEl("input", { type: "range" });
    opacity.min = "0.05";
    opacity.max = "1";
    opacity.step = "0.05";
    opacity.value = String(this.state.gridOpacity);
    opacity.title = "Grid line opacity";
    opacity.addEventListener("change", () => {
      this.state.gridOpacity = parseFloat(opacity.value);
      this.broadcastConfig();
      this.persistState();
    });
  }

  private renderPanPreview(section: HTMLElement, map: ActiveMap) {
    const nw = map.naturalWidth;
    const nh = map.naturalHeight;
    if (!(nw > 0) || !(nh > 0)) return;

    const rotation = this.state.rotation ?? 0;
    const invRotation = ((360 - rotation) % 360) as MapRotation;
    const preview = section.createDiv("dm-map-preview");
    // The stage is sized to the map's exact rendered box; the rectangle and
    // the drag math reference it, so panel letterboxing can't skew them.
    // It renders rotated to the TV's orientation and zoomed by the local
    // preview zoom; screen↔map conversions divide by the effective scale and
    // un-rotate through invRotation.
    const stage = preview.createDiv("dm-map-preview-stage");
    const aoeCanvas = stage.createEl("canvas", { cls: "dm-map-aoe-canvas" });

    const effectiveScale = () => (stage.offsetWidth / nw) * this.previewZoom;
    const screenToMap = (clientX: number, clientY: number) => {
      const b = stage.getBoundingClientRect();
      const r = rotatePoint(clientX - (b.left + b.width / 2), clientY - (b.top + b.height / 2), invRotation);
      const s = effectiveScale();
      return { x: nw / 2 + r.x / s, y: nh / 2 + r.y / s };
    };
    const deltaToMap = (dx: number, dy: number) => {
      const r = rotatePoint(dx, dy, invRotation);
      const s = effectiveScale();
      return { x: r.x / s, y: r.y / s };
    };

    const applyTransform = () => {
      stage.style.transform =
        `translate(-50%, -50%) translate(${this.previewPanX}px, ${this.previewPanY}px) ` +
        `rotate(${rotation}deg) scale(${this.previewZoom})`;
      stage.style.setProperty("--dm-map-zoom", String(this.previewZoom));
    };

    const redrawAoes = () => {
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      if (!w || !h) return;
      const z = this.previewZoom;
      aoeCanvas.width = Math.round(w * z);
      aoeCanvas.height = Math.round(h * z);
      const ctx = aoeCanvas.getContext("2d")!;
      ctx.clearRect(0, 0, aoeCanvas.width, aoeCanvas.height);
      const s = (w * z) / nw;
      for (const aoe of this.aoes) {
        renderAoe(ctx, aoe, s, 0, 0, this.state.pxPerSquare, 0);
      }
    };

    const sideways = rotation % 180 !== 0;
    const client = this.effectiveMapClient();
    const { ppi, calibrated } = this.clientPpi(client);
    const scale = ppi / this.state.pxPerSquare;
    // The rect lives in map coordinates; under a 90°/270° rotation the
    // screen's long side runs along the map's Y axis, so the window swaps.
    const visW = (sideways ? client.height : client.width) / scale;
    const visH = (sideways ? client.width : client.height) / scale;
    // Zoom bounds: 1× shows the whole map, the max zoom fills the preview
    // with exactly the player's visible window.
    const zoomMax =
      this.state.mode === "physical" ? Math.max(1, Math.min(nw / visW, nh / visH)) : 6;
    if (this.previewZoom > zoomMax) this.previewZoom = zoomMax;

    const layoutStage = () => {
      const availW = preview.clientWidth;
      if (!availW) return;
      const rotW = sideways ? nh : nw;
      const rotH = sideways ? nw : nh;
      const s = Math.min(availW / rotW, 340 / rotH);
      stage.style.width = `${nw * s}px`;
      stage.style.height = `${nh * s}px`;
      preview.style.height = `${rotH * s}px`;
      applyTransform();
      redrawAoes();
    };
    this.redrawPreviewAoes = redrawAoes;
    layoutStage();
    requestAnimationFrame(layoutStage);

    const zoomControls = preview.createDiv("dm-map-zoom-controls");
    // Clicks on the overlay controls must never fall through to the preview's
    // click-to-center pan handler.
    zoomControls.addEventListener("mousedown", (e: MouseEvent) => e.stopPropagation());

    const lockBtn = zoomControls.createEl("button", { text: this.previewLocked ? "🔒" : "🔓" });
    lockBtn.title = "Lock the map view — pan can't be moved from the preview";
    lockBtn.addEventListener("click", () => {
      this.previewLocked = !this.previewLocked;
      lockBtn.textContent = this.previewLocked ? "🔒" : "🔓";
      preview.classList.toggle("dm-map-view-locked", this.previewLocked);
    });
    preview.classList.toggle("dm-map-view-locked", this.previewLocked);

    const zoomSlider = zoomControls.createEl("input", { type: "range" });
    zoomSlider.min = "1";
    zoomSlider.max = String(zoomMax);
    zoomSlider.step = "0.01";
    zoomSlider.value = String(this.previewZoom);
    zoomSlider.title = "Preview zoom — min: whole map, max: the player's view";
    zoomSlider.disabled = zoomMax <= 1;

    const zoomAt = (factor: number, clientX: number, clientY: number) => {
      const zOld = this.previewZoom;
      const zNew = Math.min(zoomMax, Math.max(1, zOld * factor));
      if (zNew === zOld) return;
      const pb = preview.getBoundingClientRect();
      const cx = clientX - (pb.left + pb.width / 2);
      const cy = clientY - (pb.top + pb.height / 2);
      const k = zNew / zOld;
      this.previewPanX = cx * (1 - k) + k * this.previewPanX;
      this.previewPanY = cy * (1 - k) + k * this.previewPanY;
      this.previewZoom = zNew;
      if (zNew === 1) {
        this.previewPanX = 0;
        this.previewPanY = 0;
      }
      zoomSlider.value = String(zNew);
      applyTransform();
      redrawAoes();
    };

    zoomSlider.addEventListener("input", () => {
      const pb = preview.getBoundingClientRect();
      zoomAt(parseFloat(zoomSlider.value) / this.previewZoom, pb.left + pb.width / 2, pb.top + pb.height / 2);
    });

    preview.addEventListener(
      "wheel",
      (e: WheelEvent) => {
        e.preventDefault();
        zoomAt(e.deltaY < 0 ? 1.25 : 0.8, e.clientX, e.clientY);
      },
      { passive: false }
    );

    preview.addEventListener("mousedown", (e: MouseEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const startPanX = this.previewPanX;
      const startPanY = this.previewPanY;
      const onMove = (ev: MouseEvent) => {
        this.previewPanX = startPanX + (ev.clientX - startX);
        this.previewPanY = startPanY + (ev.clientY - startY);
        applyTransform();
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    const vaultPath = vaultPathFromUrl(map.url);
    const adapter = this.plugin.app.vault.adapter as { getResourcePath?: (p: string) => string };
    const resourceUrl = vaultPath ? adapter.getResourcePath?.(vaultPath) : null;
    if (resourceUrl) {
      if (map.mediaType === "video") {
        const v = stage.createEl("video");
        v.src = resourceUrl;
        v.muted = true;
        v.loop = true;
        v.autoplay = true;
        v.playsInline = true;
        v.play().catch(() => {});
      } else {
        const img = stage.createEl("img");
        img.src = resourceUrl;
        img.alt = "";
      }
    }

    for (const aoe of this.aoes) {
      const dot = stage.createDiv("dm-map-aoe-dot");
      dot.style.background = aoe.color;
      dot.title = `${aoe.label ?? aoe.shape} ${aoe.sizeFt}ft — drag to move`;
      const handle = aoe.shape === "circle" ? null : stage.createDiv("dm-map-aoe-rot-handle");
      if (handle) {
        handle.style.background = aoe.color;
        handle.title = "Drag to rotate";
      }
      const ftToPx = this.state.pxPerSquare / 5;
      // The handle sits where the shape "points": tip of cone/line, mid-edge
      // of a square.
      const handleDistPx = () => (aoe.shape === "square" ? aoe.sizeFt / 2 : aoe.sizeFt) * ftToPx;
      const positionMarkers = () => {
        dot.style.left = `${(aoe.x / nw) * 100}%`;
        dot.style.top = `${(aoe.y / nh) * 100}%`;
        if (handle) {
          const rad = (aoe.rotation * Math.PI) / 180;
          const hx = aoe.x + Math.cos(rad) * handleDistPx();
          const hy = aoe.y + Math.sin(rad) * handleDistPx();
          handle.style.left = `${(hx / nw) * 100}%`;
          handle.style.top = `${(hy / nh) * 100}%`;
        }
      };
      positionMarkers();

      dot.addEventListener("mousedown", (ev: MouseEvent) => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        ev.stopPropagation();
        if (!stage.offsetWidth) return;
        const startX = ev.clientX;
        const startY = ev.clientY;
        const startAoeX = aoe.x;
        const startAoeY = aoe.y;
        const onMove = (me: MouseEvent) => {
          const d = deltaToMap(me.clientX - startX, me.clientY - startY);
          aoe.x = Math.max(0, Math.min(nw, startAoeX + d.x));
          aoe.y = Math.max(0, Math.min(nh, startAoeY + d.y));
          positionMarkers();
          redrawAoes();
          this.broadcastAoes();
        };
        const onUp = () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          this.broadcastAoes(true);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });

      handle?.addEventListener("mousedown", (ev: MouseEvent) => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        ev.stopPropagation();
        const onMove = (me: MouseEvent) => {
          const b = stage.getBoundingClientRect();
          if (!b.width) return;
          const s = effectiveScale();
          const r = rotatePoint(aoe.x - nw / 2, aoe.y - nh / 2, rotation);
          const centerX = b.left + b.width / 2 + r.x * s;
          const centerY = b.top + b.height / 2 + r.y * s;
          const deg = (Math.atan2(me.clientY - centerY, me.clientX - centerX) * 180) / Math.PI - rotation;
          aoe.rotation = ((Math.round(deg / 5) * 5) % 360 + 360) % 360;
          positionMarkers();
          redrawAoes();
          this.broadcastAoes();
        };
        const onUp = () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          this.broadcastAoes(true);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });
    }

    if (this.state.mode !== "physical") return;

    if (!calibrated) {
      section.createDiv({
        cls: "dm-map-uncalibrated",
        text: "Screen not calibrated — physical scale assumes 96 px/inch. Click its resolution badge to calibrate.",
      });
    }

    const rect = stage.createDiv("dm-map-viewport-rect");
    const positionRect = () => {
      rect.style.width = `${Math.min((visW / nw) * 100, 100)}%`;
      rect.style.height = `${Math.min((visH / nh) * 100, 100)}%`;
      rect.style.left = `${((this.state.panX - visW / 2) / nw) * 100}%`;
      rect.style.top = `${((this.state.panY - visH / 2) / nh) * 100}%`;
    };
    positionRect();

    const applyPan = (panX: number, panY: number) => {
      const clamped = clampPan(panX, panY, nw, nh, client.width, client.height, scale, this.state.rotation ?? 0);
      this.state.panX = clamped.panX;
      this.state.panY = clamped.panY;
      positionRect();
      this.broadcastView();
    };

    preview.addEventListener("mousedown", (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (this.previewLocked) return;
      e.preventDefault();
      if (!stage.offsetWidth) return;
      const startPanX = this.state.panX;
      const startPanY = this.state.panY;
      const startX = e.clientX;
      const startY = e.clientY;
      const fromRect = e.target === rect;
      if (!fromRect) {
        const m = screenToMap(e.clientX, e.clientY);
        applyPan(m.x, m.y);
      }
      const onMove = (ev: MouseEvent) => {
        if (fromRect) {
          const d = deltaToMap(ev.clientX - startX, ev.clientY - startY);
          applyPan(startPanX + d.x, startPanY + d.y);
        } else {
          const m = screenToMap(ev.clientX, ev.clientY);
          applyPan(m.x, m.y);
        }
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        this.broadcastView(true);
        this.persistState();
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  private renderAoeControls(section: HTMLElement, map: ActiveMap) {
    const wrap = section.createDiv("dm-map-aoe-section");
    const header = wrap.createDiv("dm-layer-btn-row");
    header.createSpan({ text: "AoE Overlays", cls: "dm-status-detail" });

    const addBtn = header.createEl("button", { text: "Add AoE" });
    addBtn.addEventListener("click", (evt: MouseEvent) => {
      const menu = new Menu();
      for (const preset of SHAPE_PRESETS) {
        menu.addItem((item) => item.setTitle(preset.name).onClick(() => this.addAoe(preset, map)));
      }
      menu.addSeparator();
      menu.addItem((item) =>
        item.setTitle("Spells…").onClick(() => {
          new SpellAoeModal(this.plugin.app, (spell) =>
            this.addAoe(
              { name: spell.name, shape: spell.shape, sizeFt: spell.sizeFt, widthFt: spell.widthFt, color: spell.color, opacity: 0.3 },
              map,
              spell.name
            )
          ).open();
        })
      );
      menu.showAtMouseEvent(evt);
    });

    if (this.aoes.length === 0) return;

    const clearBtn = header.createEl("button", { text: "Clear All" });
    clearBtn.addEventListener("click", () => {
      this.aoes = [];
      this.broadcastAoes(true);
      this.host.render();
    });

    for (const aoe of this.aoes) {
      this.renderAoeRow(wrap, aoe);
    }
  }

  private renderAoeRow(container: HTMLElement, aoe: MapAoe) {
    const row = container.createDiv("dm-map-aoe-row");
    if (aoe.label) {
      row.createSpan({ text: aoe.label, cls: "dm-map-aoe-label" });
    }

    const shapeSelect = row.createEl("select");
    for (const shape of AOE_SHAPES) {
      shapeSelect.createEl("option", { text: shape, value: shape });
    }
    shapeSelect.value = aoe.shape;
    shapeSelect.addEventListener("change", () => {
      aoe.shape = shapeSelect.value as AoeShape;
      this.broadcastAoes(true);
      this.host.render();
    });

    const sizeInput = row.createEl("input", { type: "number" });
    sizeInput.value = String(aoe.sizeFt);
    sizeInput.min = "5";
    sizeInput.step = "5";
    sizeInput.title = aoe.shape === "circle" ? "Radius (ft)" : aoe.shape === "line" ? "Length (ft)" : "Size (ft)";
    sizeInput.addEventListener("change", () => {
      const v = parseFloat(sizeInput.value);
      if (!Number.isFinite(v) || v <= 0) return;
      aoe.sizeFt = v;
      this.broadcastAoes(true);
      this.redrawPreviewAoes?.();
    });
    row.createSpan({ text: "ft", cls: "dm-status-detail" });

    if (aoe.shape === "line") {
      const widthInput = row.createEl("input", { type: "number" });
      widthInput.value = String(aoe.widthFt);
      widthInput.min = "5";
      widthInput.step = "5";
      widthInput.title = "Width (ft)";
      widthInput.addEventListener("change", () => {
        const v = parseFloat(widthInput.value);
        if (!Number.isFinite(v) || v <= 0) return;
        aoe.widthFt = v;
        this.broadcastAoes(true);
        this.redrawPreviewAoes?.();
      });
      row.createSpan({ text: "wide", cls: "dm-status-detail" });
    }

    const colorSwatch = row.createEl("input", { type: "color" });
    colorSwatch.value = aoe.color;
    colorSwatch.addEventListener("change", () => {
      aoe.color = colorSwatch.value;
      this.broadcastAoes(true);
      this.host.render();
    });

    const opacityInput = row.createEl("input", { type: "range" });
    opacityInput.min = "0.05";
    opacityInput.max = "0.8";
    opacityInput.step = "0.05";
    opacityInput.value = String(aoe.opacity);
    opacityInput.title = "Opacity";
    opacityInput.addEventListener("input", () => {
      aoe.opacity = parseFloat(opacityInput.value);
      this.broadcastAoes();
      this.redrawPreviewAoes?.();
    });
    opacityInput.addEventListener("change", () => {
      aoe.opacity = parseFloat(opacityInput.value);
      this.broadcastAoes(true);
      this.redrawPreviewAoes?.();
    });

    const rotInput = row.createEl("input", { type: "number" });
    rotInput.value = String(aoe.rotation);
    rotInput.min = "0";
    rotInput.max = "359";
    rotInput.step = "15";
    rotInput.title = "Rotation (°)";
    rotInput.addEventListener("change", () => {
      aoe.rotation = parseInt(rotInput.value, 10) || 0;
      this.broadcastAoes(true);
      this.host.render();
    });

    const removeBtn = row.createEl("button", { text: "✕" });
    removeBtn.addEventListener("click", () => {
      this.aoes = this.aoes.filter((a) => a.id !== aoe.id);
      this.broadcastAoes(true);
      this.host.render();
    });
  }

  private addAoe(preset: AoePreset, map: ActiveMap, label?: string) {
    this.aoes.push({
      id: `aoe-${nextAoeId++}`,
      shape: preset.shape,
      sizeFt: preset.sizeFt,
      widthFt: preset.widthFt,
      color: preset.color,
      opacity: preset.opacity,
      rotation: 0,
      x: map.naturalWidth / 2,
      y: map.naturalHeight / 2,
      ...(label ? { label } : {}),
    });
    this.broadcastAoes(true);
    this.host.render();
  }
}

function measureMedia(resourceUrl: string, mediaType: "image" | "video"): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    if (mediaType === "video") {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () =>
        resolve(video.videoWidth > 0 ? { w: video.videoWidth, h: video.videoHeight } : null);
      video.onerror = () => resolve(null);
      video.src = resourceUrl;
    } else {
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth > 0 ? { w: img.naturalWidth, h: img.naturalHeight } : null);
      img.onerror = () => resolve(null);
      img.src = resourceUrl;
    }
  });
}
