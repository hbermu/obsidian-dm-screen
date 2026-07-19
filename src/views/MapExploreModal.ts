import { App, Modal, Notice } from "obsidian";
import type DmScreenPlugin from "../main";
import type { MapScreenPanel, ActiveMap } from "./MapScreenPanel";
import { fogCanvasSize } from "../map/fog";
import { buildBlockedMask, floodRegion, regionToCanvas } from "../map/walls";
import { vaultPathFromUrl } from "../server";
import type { MapRotation, MapWall } from "../map/types";
import { renderAoe } from "../map/aoe";
import { rotatePoint } from "../map/transform";
import { debug } from "../debug";

// Table-play surface. Left-click alternates the two exploration gestures —
// toggle a door, reveal/cover a room — while the DM's view keeps the map's
// configured rotation. On top of that, the DM can drag the players' viewport
// rectangle (physical mode), and move the AoE and vision markers configured in
// the panel. Doors are ALWAYS room boundaries here (regardless of open/closed),
// so a room stays discrete even with an open door; open/closed only affects LoS
// on the player screen via the map-walls broadcast.
export class MapExploreModal extends Modal {
  private fogCanvas: HTMLCanvasElement;
  private redrawOverlay: (() => void) | null = null;
  private renderMarkers: (() => void) | null = null;
  private cleanupListeners: (() => void) | null = null;
  // Force-detaches an in-progress document drag if the modal closes mid-gesture.
  private activeDrag: (() => void) | null = null;
  private walls: MapWall[] = [];
  private hoverCell: { x: number; y: number } | null = null;
  private blockedCache: { walls: MapWall[]; fogScale: number; mask: Uint8Array } | null = null;
  private hoverRegion: { cellX: number; cellY: number; region: Uint8Array | null } | null = null;

  constructor(
    app: App,
    private plugin: DmScreenPlugin,
    private panel: MapScreenPanel,
    private map: ActiveMap
  ) {
    super(app);
    this.fogCanvas = this.buildFogCanvas();
  }

  private buildFogCanvas(): HTMLCanvasElement {
    const { width, height } = fogCanvasSize(this.map.naturalWidth, this.map.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const existing = this.panel.fogDataUrl;
    if (existing) {
      const img = new Image();
      img.onload = () => {
        canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
        this.redrawOverlay?.();
      };
      img.src = existing;
    }
    return canvas;
  }

  private ctx(): CanvasRenderingContext2D {
    return this.fogCanvas.getContext("2d")!;
  }

  private commitFog() {
    void this.panel.commitFog(this.fogCanvas.toDataURL("image/png"));
  }

  onOpen() {
    this.walls = [...this.panel.walls];
    this.modalEl.addClass("dm-explore-modal");
    const { contentEl } = this;
    contentEl.addClass("dm-explore-content");

    const nw = this.map.naturalWidth;
    const nh = this.map.naturalHeight;
    const rotation = (this.panel.state.rotation ?? 0) as MapRotation;
    const invRotation = ((360 - rotation) % 360) as MapRotation;
    const sideways = rotation % 180 !== 0;
    const fogScale = this.fogCanvas.width / nw;
    const doorRadius = Math.max(10, this.panel.state.pxPerSquare * fogScale * 0.35);

    const bar = contentEl.createDiv("dm-explore-bar");
    const revealAll = bar.createEl("button", { text: "Reveal All" });
    const coverAll = bar.createEl("button", { text: "Cover All", cls: "mod-warning" });
    const addAoeBtn = bar.createEl("button", { text: "Add AoE" });
    const exitBtn = bar.createEl("button", { text: "Exit" });

    const stage = contentEl.createDiv("dm-explore-stage");
    // The inner box carries the map's exact aspect and rotates to the TV
    // orientation; the overlay and markers are its children so they rotate
    // solidly with the map. Client↔fog/map conversions un-rotate through
    // invRotation and read the inner overlay's own rect (robust under rotation,
    // and layout-free in tests where the rect is stubbed).
    const inner = stage.createDiv("dm-explore-inner");

    const vaultPath = vaultPathFromUrl(this.map.url);
    const adapter = this.plugin.app.vault.adapter as { getResourcePath?: (p: string) => string };
    const resourceUrl = vaultPath ? adapter.getResourcePath?.(vaultPath) : null;
    if (resourceUrl) {
      if (this.map.mediaType === "video") {
        const v = inner.createEl("video");
        v.src = resourceUrl;
        v.muted = true;
        v.loop = true;
        v.autoplay = true;
        v.playsInline = true;
        v.play().catch(() => {});
      } else {
        const img = inner.createEl("img");
        img.src = resourceUrl;
        img.alt = "";
      }
    } else {
      debug("MapExploreModal: no resource path for", this.map.url);
    }

    const overlay = inner.createEl("canvas", { cls: "dm-explore-overlay" });
    overlay.width = this.fogCanvas.width;
    overlay.height = this.fogCanvas.height;
    const octx = overlay.getContext("2d")!;
    // Markers layer sits on top but passes clicks through to the overlay; only
    // the dots and the viewport rect (pointer-events: auto) capture drags.
    const markers = inner.createDiv("dm-explore-markers");

    const layout = () => {
      const availW = stage.clientWidth;
      const availH = stage.clientHeight;
      if (!availW || !availH) return;
      const rotW = sideways ? nh : nw;
      const rotH = sideways ? nw : nh;
      const s = Math.min(availW / rotW, availH / rotH);
      inner.style.width = `${nw * s}px`;
      inner.style.height = `${nh * s}px`;
      inner.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
    };
    layout();
    requestAnimationFrame(layout);

    const redraw = () => {
      octx.clearRect(0, 0, overlay.width, overlay.height);

      octx.globalAlpha = 0.5;
      octx.drawImage(this.fogCanvas, 0, 0);
      octx.globalAlpha = 1;

      if (this.hoverCell) {
        const region = this.hoverRegionFor(this.hoverCell.x, this.hoverCell.y, fogScale);
        if (region) {
          const hc = regionToCanvas(region, this.fogCanvas.width, this.fogCanvas.height);
          const hctx = hc.getContext("2d")!;
          hctx.globalCompositeOperation = "source-in";
          hctx.fillStyle = "rgba(123,216,143,0.25)";
          hctx.fillRect(0, 0, hc.width, hc.height);
          octx.drawImage(hc, 0, 0);
        }
      }

      // AoE footprints at fog scale (mapRotation 0 — the inner box already
      // carries the view rotation via CSS transform).
      for (const aoe of this.panel.aoes) {
        renderAoe(octx, aoe, fogScale, 0, 0, this.panel.state.pxPerSquare, 0);
      }

      // Vision range outlines.
      octx.save();
      octx.setLineDash([6, 4]);
      octx.strokeStyle = "#ffd23f";
      octx.lineWidth = 2;
      const ftToPxScaled = (this.panel.state.pxPerSquare / 5) * fogScale;
      for (const v of this.panel.visions) {
        const radius = v.sizeFt * ftToPxScaled;
        octx.beginPath();
        if (v.shape === "circle") {
          octx.arc(v.x * fogScale, v.y * fogScale, radius, 0, Math.PI * 2);
        } else {
          octx.rect(v.x * fogScale - radius, v.y * fogScale - radius, radius * 2, radius * 2);
        }
        octx.stroke();
      }
      octx.restore();

      // Faint walls so room boundaries are legible.
      octx.save();
      octx.globalAlpha = 0.35;
      octx.lineWidth = 2;
      for (const w of this.walls) {
        octx.strokeStyle = w.door ? "#44aaff" : "#f5d90a";
        octx.beginPath();
        octx.moveTo(w.x1 * fogScale, w.y1 * fogScale);
        octx.lineTo(w.x2 * fogScale, w.y2 * fogScale);
        octx.stroke();
      }
      octx.restore();

      // Big, obvious door markers: green when open, grey when closed.
      for (const w of this.walls) {
        if (!w.door) continue;
        const mx = ((w.x1 + w.x2) / 2) * fogScale;
        const my = ((w.y1 + w.y2) / 2) * fogScale;
        octx.save();
        octx.fillStyle = w.open ? "#7bd88f" : "#888888";
        octx.strokeStyle = "rgba(0,0,0,0.6)";
        octx.lineWidth = 2;
        octx.beginPath();
        octx.arc(mx, my, doorRadius, 0, Math.PI * 2);
        octx.fill();
        octx.stroke();
        octx.restore();
      }
    };
    this.redrawOverlay = redraw;
    redraw();

    // Overlay geometry, read fresh so it survives layout/rotation changes. The
    // rotated overlay's AABB preserves its centre; its unrotated client size is
    // the AABB dims swapped back when the view is sideways.
    const overlayGeom = () => {
      const b = overlay.getBoundingClientRect();
      return {
        cx: b.left + b.width / 2,
        cy: b.top + b.height / 2,
        uw: sideways ? b.height : b.width,
        uh: sideways ? b.width : b.height,
      };
    };
    const toFog = (clientX: number, clientY: number) => {
      const { cx, cy, uw, uh } = overlayGeom();
      const r = rotatePoint(clientX - cx, clientY - cy, invRotation);
      return {
        x: (r.x / uw + 0.5) * this.fogCanvas.width,
        y: (r.y / uh + 0.5) * this.fogCanvas.height,
      };
    };
    const deltaToMap = (dx: number, dy: number) => {
      const { uw, uh } = overlayGeom();
      const r = rotatePoint(dx, dy, invRotation);
      return { x: (r.x / uw) * nw, y: (r.y / uh) * nh };
    };

    const renderMarkers = () => {
      markers.empty();
      this.buildAoeMarkers(markers, nw, nh, rotation, overlayGeom, deltaToMap, redraw);
      this.buildVisionMarkers(markers, nw, nh, deltaToMap, redraw);
      this.buildViewportRect(markers, nw, nh, deltaToMap);
    };
    this.renderMarkers = renderMarkers;
    renderMarkers();

    revealAll.addEventListener("click", () => {
      this.ctx().clearRect(0, 0, this.fogCanvas.width, this.fogCanvas.height);
      redraw();
      this.commitFog();
    });
    coverAll.addEventListener("click", () => {
      const ctx = this.ctx();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, this.fogCanvas.width, this.fogCanvas.height);
      redraw();
      this.commitFog();
    });
    addAoeBtn.addEventListener("click", (evt: MouseEvent) => {
      this.panel.openAddAoeMenu(evt, this.map, () => {
        renderMarkers();
        redraw();
      });
    });
    exitBtn.addEventListener("click", () => this.close());

    const nearestDoor = (fx: number, fy: number): MapWall | null => {
      const mx = fx / fogScale;
      const my = fy / fogScale;
      const hitRadius = (doorRadius + 6) / fogScale;
      let nearest: MapWall | null = null;
      let nearestDist = Infinity;
      for (const w of this.walls) {
        if (!w.door) continue;
        const cx = (w.x1 + w.x2) / 2;
        const cy = (w.y1 + w.y2) / 2;
        const d = Math.hypot(mx - cx, my - cy);
        if (d < hitRadius && d < nearestDist) {
          nearestDist = d;
          nearest = w;
        }
      }
      return nearest;
    };

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const { x: fx, y: fy } = toFog(e.clientX, e.clientY);

      const door = nearestDoor(fx, fy);
      if (door) {
        const toggled = door;
        this.walls = this.walls.map((w) => (w === toggled ? { ...w, open: !w.open } : w));
        this.hoverRegion = null;
        void this.panel.commitWalls([...this.walls]);
        redraw();
        return;
      }

      const region = this.hoverRegionFor(Math.floor(fx), Math.floor(fy), fogScale);
      if (!region) {
        new Notice("That point is inside a wall");
        return;
      }
      const revealed = this.ctx().getImageData(Math.floor(fx), Math.floor(fy), 1, 1).data[3] < 128;
      const rc = regionToCanvas(region, this.fogCanvas.width, this.fogCanvas.height);
      const ctx = this.ctx();
      ctx.globalCompositeOperation = revealed ? "source-over" : "destination-out";
      ctx.drawImage(rc, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      redraw();
      this.commitFog();
    };

    const onMove = (e: MouseEvent) => {
      const { x: fx, y: fy } = toFog(e.clientX, e.clientY);
      const cx = Math.floor(fx);
      const cy = Math.floor(fy);
      if (this.hoverCell && this.hoverCell.x === cx && this.hoverCell.y === cy) return;
      this.hoverCell = { x: cx, y: cy };
      redraw();
    };

    const onLeave = () => {
      if (!this.hoverCell) return;
      this.hoverCell = null;
      this.hoverRegion = null;
      redraw();
    };

    overlay.addEventListener("mousedown", onDown);
    overlay.addEventListener("mousemove", onMove);
    overlay.addEventListener("mouseleave", onLeave);
    this.cleanupListeners = () => {
      overlay.removeEventListener("mousedown", onDown);
      overlay.removeEventListener("mousemove", onMove);
      overlay.removeEventListener("mouseleave", onLeave);
    };
  }

  // Draggable AoE anchor dots (+ rotation handle for non-symmetric shapes);
  // right-click removes. Mirrors the panel pan-preview markers.
  private buildAoeMarkers(
    layer: HTMLElement,
    nw: number,
    nh: number,
    rotation: MapRotation,
    overlayGeom: () => { cx: number; cy: number; uw: number; uh: number },
    deltaToMap: (dx: number, dy: number) => { x: number; y: number },
    redraw: () => void
  ) {
    const ftToPx = this.panel.state.pxPerSquare / 5;
    for (const aoe of this.panel.aoes) {
      const dot = layer.createDiv("dm-map-aoe-dot");
      dot.style.background = aoe.color;
      dot.title = `${aoe.label ?? aoe.shape} ${aoe.sizeFt}ft — drag to move, right-click to remove`;
      const handle =
        aoe.shape === "circle" || aoe.shape === "ring" ? null : layer.createDiv("dm-map-aoe-rot-handle");
      if (handle) {
        handle.style.background = aoe.color;
        handle.title = "Drag to rotate";
      }
      const handleDistPx = () => (aoe.shape === "square" ? aoe.sizeFt / 2 : aoe.sizeFt) * ftToPx;
      const position = () => {
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
      position();

      dot.addEventListener("contextmenu", (ev: MouseEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.panel.removeAoe(aoe.id);
        this.renderMarkers?.();
        redraw();
      });

      dot.addEventListener("mousedown", (ev: MouseEvent) => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        ev.stopPropagation();
        const startX = ev.clientX;
        const startY = ev.clientY;
        const startAoeX = aoe.x;
        const startAoeY = aoe.y;
        this.beginDrag(
          (me) => {
            const d = deltaToMap(me.clientX - startX, me.clientY - startY);
            aoe.x = Math.max(0, Math.min(nw, startAoeX + d.x));
            aoe.y = Math.max(0, Math.min(nh, startAoeY + d.y));
            position();
            redraw();
            this.panel.broadcastAoes();
          },
          () => this.panel.broadcastAoes(true)
        );
      });

      handle?.addEventListener("mousedown", (ev: MouseEvent) => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        ev.stopPropagation();
        this.beginDrag(
          (me) => {
            const { cx, cy, uw } = overlayGeom();
            const s = uw / nw;
            const r = rotatePoint(aoe.x - nw / 2, aoe.y - nh / 2, rotation);
            const centerX = cx + r.x * s;
            const centerY = cy + r.y * s;
            const deg = (Math.atan2(me.clientY - centerY, me.clientX - centerX) * 180) / Math.PI - rotation;
            aoe.rotation = (((Math.round(deg / 5) * 5) % 360) + 360) % 360;
            position();
            redraw();
            this.panel.broadcastAoes();
          },
          () => this.panel.broadcastAoes(true)
        );
      });
    }
  }

  // Draggable dots for the visions configured in the panel (move-only).
  private buildVisionMarkers(
    layer: HTMLElement,
    nw: number,
    nh: number,
    deltaToMap: (dx: number, dy: number) => { x: number; y: number },
    redraw: () => void
  ) {
    for (const vision of this.panel.visions) {
      const dot = layer.createDiv("dm-map-vision-dot");
      dot.title = `${vision.shape} ${vision.sizeFt}ft vision — drag to move`;
      const position = () => {
        dot.style.left = `${(vision.x / nw) * 100}%`;
        dot.style.top = `${(vision.y / nh) * 100}%`;
      };
      position();
      dot.addEventListener("mousedown", (ev: MouseEvent) => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        ev.stopPropagation();
        const startX = ev.clientX;
        const startY = ev.clientY;
        const startVX = vision.x;
        const startVY = vision.y;
        this.beginDrag(
          (me) => {
            const d = deltaToMap(me.clientX - startX, me.clientY - startY);
            vision.x = Math.max(0, Math.min(nw, startVX + d.x));
            vision.y = Math.max(0, Math.min(nh, startVY + d.y));
            position();
            redraw();
            this.panel.broadcastVisions();
          },
          () => this.panel.broadcastVisions(true)
        );
      });
    }
  }

  // Draggable players'-viewport rectangle (physical mode only) — repositions
  // the visible window on the table TV without touching the DM's own rotated view.
  private buildViewportRect(
    layer: HTMLElement,
    nw: number,
    nh: number,
    deltaToMap: (dx: number, dy: number) => { x: number; y: number }
  ) {
    if (this.panel.state.mode !== "physical") return;
    const vis = this.panel.playerViewportMapSize();
    if (!vis) return;

    const rect = layer.createDiv("dm-map-viewport-rect");
    const position = () => {
      rect.style.width = `${Math.min((vis.w / nw) * 100, 100)}%`;
      rect.style.height = `${Math.min((vis.h / nh) * 100, 100)}%`;
      rect.style.left = `${((this.panel.state.panX - vis.w / 2) / nw) * 100}%`;
      rect.style.top = `${((this.panel.state.panY - vis.h / 2) / nh) * 100}%`;
    };
    position();

    rect.addEventListener("mousedown", (ev: MouseEvent) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      const startX = ev.clientX;
      const startY = ev.clientY;
      const startPanX = this.panel.state.panX;
      const startPanY = this.panel.state.panY;
      this.beginDrag(
        (me) => {
          const d = deltaToMap(me.clientX - startX, me.clientY - startY);
          this.panel.applyExplorePan(startPanX + d.x, startPanY + d.y);
          position();
        },
        (me) => {
          const d = deltaToMap(me.clientX - startX, me.clientY - startY);
          this.panel.applyExplorePan(startPanX + d.x, startPanY + d.y, true);
          position();
        }
      );
    });
  }

  private beginDrag(onMove: (e: MouseEvent) => void, onUp?: (e: MouseEvent) => void) {
    // Tear down any prior drag whose mouseup was missed (e.g. released off-window)
    // so its document listeners can't outlive this one or the modal.
    this.activeDrag?.();
    const move = (e: MouseEvent) => onMove(e);
    const up = (e: MouseEvent) => {
      cleanup();
      onUp?.(e);
    };
    const cleanup = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      this.activeDrag = null;
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
    this.activeDrag = cleanup;
  }

  private blockedMask(fogScale: number): Uint8Array {
    const cached = this.blockedCache;
    if (cached && cached.walls === this.walls && cached.fogScale === fogScale) return cached.mask;
    const mask = buildBlockedMask(
      this.walls,
      this.fogCanvas.width,
      this.fogCanvas.height,
      fogScale,
      this.panel.state.pxPerSquare,
      () => true
    );
    this.blockedCache = { walls: this.walls, fogScale, mask };
    return mask;
  }

  private computeRegion(fx: number, fy: number, fogScale: number): Uint8Array | null {
    return floodRegion(this.blockedMask(fogScale), this.fogCanvas.width, this.fogCanvas.height, fx, fy);
  }

  private hoverRegionFor(cellX: number, cellY: number, fogScale: number): Uint8Array | null {
    const cached = this.hoverRegion;
    if (cached && cached.cellX === cellX && cached.cellY === cellY) return cached.region;
    const region = this.computeRegion(cellX, cellY, fogScale);
    this.hoverRegion = { cellX, cellY, region };
    return region;
  }

  onClose() {
    this.activeDrag?.();
    this.activeDrag = null;
    this.cleanupListeners?.();
    this.cleanupListeners = null;
    this.renderMarkers = null;
    this.hoverCell = null;
    this.hoverRegion = null;
    this.blockedCache = null;
    this.redrawOverlay = null;
    this.panel.refreshPanel();
    this.contentEl.empty();
  }
}
