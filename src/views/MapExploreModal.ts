import { App, Modal, Notice } from "obsidian";
import type DmScreenPlugin from "../main";
import type { MapScreenPanel, ActiveMap } from "./MapScreenPanel";
import { fogCanvasSize } from "../map/fog";
import { buildBlockedMask, floodRegion, regionToCanvas } from "../map/walls";
import { vaultPathFromUrl } from "../server";
import type { MapWall } from "../map/types";
import { debug } from "../debug";

// Table-play surface: two gestures only — click a door to toggle it, click a
// room to reveal or cover its fog. Doors are ALWAYS room boundaries here
// (regardless of open/closed), so a room stays discrete even with an open door;
// open/closed only affects LoS on the player screen via the map-walls broadcast.
export class MapExploreModal extends Modal {
  private fogCanvas: HTMLCanvasElement;
  private redrawOverlay: (() => void) | null = null;
  private cleanupListeners: (() => void) | null = null;
  private walls: MapWall[] = [];
  // fog-cell coords of the room the pointer last hovered, for the highlight
  private hoverCell: { x: number; y: number } | null = null;
  // blocked mask (all walls) memoized against the walls list + fogScale it was
  // built from, so hover and click reuse one rasterization until walls change
  private blockedCache: { walls: MapWall[]; fogScale: number; mask: Uint8Array } | null = null;
  // the region computed for the current hoverCell, reused by the click that
  // lands in the same cell
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

    const bar = contentEl.createDiv("dm-explore-bar");
    const revealAll = bar.createEl("button", { text: "Reveal All" });
    const coverAll = bar.createEl("button", { text: "Cover All", cls: "mod-warning" });
    const exitBtn = bar.createEl("button", { text: "Exit" });

    const stage = contentEl.createDiv("dm-explore-stage");
    stage.style.aspectRatio = `${this.map.naturalWidth} / ${this.map.naturalHeight}`;

    const vaultPath = vaultPathFromUrl(this.map.url);
    const adapter = this.plugin.app.vault.adapter as { getResourcePath?: (p: string) => string };
    const resourceUrl = vaultPath ? adapter.getResourcePath?.(vaultPath) : null;
    if (resourceUrl) {
      if (this.map.mediaType === "video") {
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
    } else {
      debug("MapExploreModal: no resource path for", this.map.url);
    }

    const overlay = stage.createEl("canvas", { cls: "dm-explore-overlay" });
    overlay.width = this.fogCanvas.width;
    overlay.height = this.fogCanvas.height;
    const octx = overlay.getContext("2d")!;

    const fogScale = this.fogCanvas.width / this.map.naturalWidth;
    const doorRadius = Math.max(10, this.panel.state.pxPerSquare * fogScale * 0.35);

    const redraw = () => {
      octx.clearRect(0, 0, overlay.width, overlay.height);

      // Fog at a clear alpha so the DM sees the map underneath.
      octx.globalAlpha = 0.5;
      octx.drawImage(this.fogCanvas, 0, 0);
      octx.globalAlpha = 1;

      // Hover highlight of the room that will toggle: tint the region mask green.
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

      // Faint walls so the room boundaries are legible.
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
    exitBtn.addEventListener("click", () => this.close());

    // Hit-test against each door's marker (its midpoint), not the wall segment:
    // in exploration the drawn circle IS the click target, so midpoint distance
    // is deliberate — unlike MapFogModal's Toggle-door tool, which uses
    // point-to-segment distance because it acts on the whole wall.
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
      const { x: fx, y: fy } = this.toFog(overlay, e.clientX, e.clientY);

      // Gesture 1 — a door under the cursor toggles open/closed.
      const door = nearestDoor(fx, fy);
      if (door) {
        const toggled = door;
        this.walls = this.walls.map((w) => (w === toggled ? { ...w, open: !w.open } : w));
        // Walls list identity changed; drop the region memo (mask reuse is keyed
        // off the walls reference in blockedMask()).
        this.hoverRegion = null;
        void this.panel.commitWalls([...this.walls]);
        redraw();
        return;
      }

      // Gesture 2 — a room toggles its fog based on the sampled alpha. Reuse the
      // hovered region when the click lands in the same fog cell.
      const region = this.hoverRegionFor(Math.floor(fx), Math.floor(fy), fogScale);
      if (!region) {
        new Notice("That point is inside a wall");
        return;
      }
      const revealed = this.ctx().getImageData(Math.floor(fx), Math.floor(fy), 1, 1).data[3] < 128;
      const rc = regionToCanvas(region, this.fogCanvas.width, this.fogCanvas.height);
      const ctx = this.ctx();
      if (revealed) {
        // Currently revealed → cover the room (paint opaque black).
        ctx.globalCompositeOperation = "source-over";
      } else {
        // Currently hidden → reveal the room (erase to transparent).
        ctx.globalCompositeOperation = "destination-out";
      }
      ctx.drawImage(rc, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      redraw();
      this.commitFog();
    };

    const onMove = (e: MouseEvent) => {
      const { x: fx, y: fy } = this.toFog(overlay, e.clientX, e.clientY);
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

  private toFog(overlay: HTMLCanvasElement, clientX: number, clientY: number): { x: number; y: number } {
    const b = overlay.getBoundingClientRect();
    return {
      x: ((clientX - b.left) / b.width) * this.fogCanvas.width,
      y: ((clientY - b.top) / b.height) * this.fogCanvas.height,
    };
  }

  // All-walls blocked mask, rebuilt only when the walls list or fogScale change.
  // Exploration treats EVERY wall — doors included, regardless of open — as a
  // boundary, so the predicate admits all walls (unlike the Fog Room tool, which
  // rasterizes only blocksSight walls). Memoized so hover and click share it.
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

  // Flood the room containing (fx, fy) over the memoized all-walls blocked mask.
  private computeRegion(fx: number, fy: number, fogScale: number): Uint8Array | null {
    return floodRegion(this.blockedMask(fogScale), this.fogCanvas.width, this.fogCanvas.height, fx, fy);
  }

  // Region for the fog cell (cellX, cellY), memoized so a redraw and the click
  // that lands in the same cell reuse a single flood. Invalidated on cell change.
  private hoverRegionFor(cellX: number, cellY: number, fogScale: number): Uint8Array | null {
    const cached = this.hoverRegion;
    if (cached && cached.cellX === cellX && cached.cellY === cellY) return cached.region;
    const region = this.computeRegion(cellX, cellY, fogScale);
    this.hoverRegion = { cellX, cellY, region };
    return region;
  }

  onClose() {
    this.cleanupListeners?.();
    this.cleanupListeners = null;
    this.hoverCell = null;
    this.hoverRegion = null;
    this.blockedCache = null;
    this.redrawOverlay = null;
    this.contentEl.empty();
  }
}
