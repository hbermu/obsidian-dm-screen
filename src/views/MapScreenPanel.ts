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
} from "../map/transform";
import type { StoredMapState } from "../map/types";
import { MapCalibrationModal } from "./MapCalibrationModal";
import { debug } from "../debug";

export interface ActiveMap {
  url: string;
  mediaType: "image" | "video";
  naturalWidth: number;
  naturalHeight: number;
}

const VIEW_BROADCAST_THROTTLE_MS = 80;

export class MapScreenPanel {
  activeMap: ActiveMap | null = null;
  state: StoredMapState = defaultMapState(0, 0);
  mapClients: ClientInfo[] = [];
  private viewBroadcastTimer: ReturnType<typeof setTimeout> | null = null;

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
    debug("MapScreenPanel: restoreFromCache —", this.activeMap.url, this.state.mode);
  }

  republish() {
    if (!this.plugin.server) return;
    this.plugin.broadcastMapCalibration();
    if (!this.activeMap) return;
    debug("MapScreenPanel: republish —", this.activeMap.url);
    this.broadcastShow();
    this.broadcastConfig();
    this.broadcastView(true);
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
    debug("MapScreenPanel: setVaultMap", vaultPath, mediaType, `${dims.w}×${dims.h}`, stored ? "(remembered config)" : "(defaults)");
    this.broadcastShow();
    this.broadcastConfig();
    this.broadcastView(true);
    this.persistState();
    this.host.render();
  }

  stopMap() {
    debug("MapScreenPanel: stopMap");
    this.activeMap = null;
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
    section.createEl("h3", { text: "Map Screen" });

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
      this.broadcastView(true);
      this.persistState();
      this.host.render();
    });

    this.renderGridControls(section);
    this.renderPanPreview(section, map);
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

    const preview = section.createDiv("dm-map-preview");
    // The stage is sized to the map's exact rendered box; the rectangle and
    // the drag math reference it, so panel letterboxing can't skew them.
    const stage = preview.createDiv("dm-map-preview-stage");
    const layoutStage = () => {
      const availW = preview.clientWidth;
      if (!availW) return;
      const s = Math.min(availW / nw, 340 / nh);
      stage.style.width = `${nw * s}px`;
      stage.style.height = `${nh * s}px`;
      preview.style.height = `${nh * s}px`;
    };
    layoutStage();
    requestAnimationFrame(layoutStage);

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

    if (this.state.mode !== "physical") return;

    const client = this.effectiveMapClient();
    const { ppi, calibrated } = this.clientPpi(client);
    if (!calibrated) {
      section.createDiv({
        cls: "dm-map-uncalibrated",
        text: "Screen not calibrated — physical scale assumes 96 px/inch. Click its resolution badge to calibrate.",
      });
    }
    const scale = ppi / this.state.pxPerSquare;
    // The preview stays in map orientation; under a 90°/270° rotation the
    // screen's long side runs along the map's Y axis, so the window swaps.
    const sideways = ((this.state.rotation ?? 0) % 180) !== 0;
    const visW = (sideways ? client.height : client.width) / scale;
    const visH = (sideways ? client.width : client.height) / scale;

    const rect = stage.createDiv("dm-map-viewport-rect");
    const positionRect = () => {
      rect.style.width = `${Math.min((visW / nw) * 100, 100)}%`;
      rect.style.height = `${Math.min((visH / nh) * 100, 100)}%`;
      rect.style.left = `${((this.state.panX - visW / 2) / nw) * 100}%`;
      rect.style.top = `${((this.state.panY - visH / 2) / nh) * 100}%`;
    };
    positionRect();

    const applyPan = (panX: number, panY: number) => {
      const clamped = clampPan(panX, panY, nw, nh);
      this.state.panX = clamped.panX;
      this.state.panY = clamped.panY;
      positionRect();
      this.broadcastView();
    };

    preview.addEventListener("mousedown", (e: MouseEvent) => {
      e.preventDefault();
      const bounds = stage.getBoundingClientRect();
      if (!bounds.width) return;
      const toMapPx = nw / bounds.width;
      const startPanX = this.state.panX;
      const startPanY = this.state.panY;
      const startX = e.clientX;
      const startY = e.clientY;
      const fromRect = e.target === rect;
      if (!fromRect) {
        applyPan(
          (e.clientX - bounds.left) * toMapPx,
          (e.clientY - bounds.top) * toMapPx
        );
      }
      const onMove = (ev: MouseEvent) => {
        if (fromRect) {
          applyPan(startPanX + (ev.clientX - startX) * toMapPx, startPanY + (ev.clientY - startY) * toMapPx);
        } else {
          applyPan((ev.clientX - bounds.left) * toMapPx, (ev.clientY - bounds.top) * toMapPx);
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
