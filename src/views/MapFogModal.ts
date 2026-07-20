import { App, Modal, Notice } from "obsidian";
import { unzipSync } from "fflate";
import type DmScreenPlugin from "../main";
import type { MapScreenPanel, ActiveMap } from "./MapScreenPanel";
import { fogCanvasSize, gridCellRectAt } from "../map/fog";
import { buildBlockedMask, floodRegion, regionToCanvas } from "../map/walls";
import { blocksSight } from "../map/los";
import { vaultPathFromUrl } from "../server";
import type { MapWall } from "../map/types";
import { parseUvttWalls } from "../map/uvtt";
import type { UvttParseResult } from "../map/uvtt";
import { parseFoundryModule } from "../map/foundry";
import type { FoundryImportResult } from "../map/foundry";
import { debug } from "../debug";

type FogTool = "brush" | "rect" | "cell" | "gridrect" | "room";
type FogMode = "reveal" | "cover";
type EditorMode = "fog" | "walls";
type WallsTool = "wall" | "door" | "erase" | "toggle" | "rect";

export class MapFogModal extends Modal {
  private tool: FogTool = "brush";
  private mode: FogMode = "reveal";
  private editorMode: EditorMode = "fog";
  private wallsTool: WallsTool = "wall";
  private wallsSnap = false;
  private brushPct = 5;
  private fogCanvas: HTMLCanvasElement;
  private redrawOverlay: (() => void) | null = null;
  private cleanupDrag: (() => void) | null = null;
  // local working copy; mutations call commitWalls
  private walls: MapWall[] = [];
  // chain anchor in natural map coords
  private chainAnchor: { x: number; y: number } | null = null;
  // cursor in natural map coords for preview segment
  private cursorNatural: { x: number; y: number } | null = null;
  // rect wall tool: natural-coord corner of in-progress drag
  private rectAnchor: { x: number; y: number } | null = null;

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

  private commit() {
    void this.panel.commitFog(this.fogCanvas.toDataURL("image/png"));
  }

  onOpen() {
    this.walls = [...this.panel.walls];
    this.modalEl.addClass("dm-fog-modal");
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Fog of War" });

    // Tab row
    const tabRow = contentEl.createDiv("dm-fog-tabs");
    const fogTabBtn = tabRow.createEl("button", { text: "Fog" });
    const wallsTabBtn = tabRow.createEl("button", { text: "Walls" });
    const syncTabActive = () => {
      fogTabBtn.classList.toggle("dm-fog-active", this.editorMode === "fog");
      wallsTabBtn.classList.toggle("dm-fog-active", this.editorMode === "walls");
    };
    syncTabActive();

    const bar = contentEl.createDiv("dm-fog-toolbar");

    const stage = contentEl.createDiv("dm-fog-stage");
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
      debug("MapFogModal: no resource path for", this.map.url);
    }

    const overlay = stage.createEl("canvas", { cls: "dm-fog-overlay" });
    overlay.width = this.fogCanvas.width;
    overlay.height = this.fogCanvas.height;
    const octx = overlay.getContext("2d")!;

    const fogScale = this.fogCanvas.width / this.map.naturalWidth;

    const redraw = () => {
      octx.clearRect(0, 0, overlay.width, overlay.height);
      octx.globalAlpha = this.editorMode === "fog" ? 0.55 : 0.25;
      octx.drawImage(this.fogCanvas, 0, 0);
      octx.globalAlpha = 1;

      // Draw walls
      for (const w of this.walls) {
        octx.save();
        octx.lineWidth = 3;
        if (w.door) {
          octx.strokeStyle = "#44aaff";
          if (w.open) octx.setLineDash([8, 6]);
        } else {
          octx.strokeStyle = "#f5d90a";
        }
        octx.beginPath();
        octx.moveTo(w.x1 * fogScale, w.y1 * fogScale);
        octx.lineTo(w.x2 * fogScale, w.y2 * fogScale);
        octx.stroke();
        octx.setLineDash([]);
        octx.restore();
      }

      // Draw chain preview segment in walls mode
      if (this.editorMode === "walls" && this.chainAnchor && this.cursorNatural) {
        octx.save();
        octx.strokeStyle = this.wallsTool === "door" ? "#44aaff" : "#f5d90a";
        octx.lineWidth = 2;
        octx.setLineDash([6, 4]);
        octx.beginPath();
        octx.moveTo(this.chainAnchor.x * fogScale, this.chainAnchor.y * fogScale);
        octx.lineTo(this.cursorNatural.x * fogScale, this.cursorNatural.y * fogScale);
        octx.stroke();
        octx.setLineDash([]);
        octx.restore();
      }
      // Draw rect wall tool preview
      if (this.editorMode === "walls" && this.wallsTool === "rect" && this.rectAnchor && this.cursorNatural) {
        octx.save();
        octx.strokeStyle = "#f5d90a";
        octx.lineWidth = 2;
        octx.setLineDash([6, 4]);
        const ax = this.rectAnchor.x * fogScale;
        const ay = this.rectAnchor.y * fogScale;
        const bx = this.cursorNatural.x * fogScale;
        const by = this.cursorNatural.y * fogScale;
        octx.strokeRect(ax, ay, bx - ax, by - ay);
        octx.setLineDash([]);
        octx.restore();
      }
    };
    this.redrawOverlay = redraw;
    redraw();

    const renderFogToolbar = (barEl: HTMLElement) => {
      const modeBtns: Record<FogMode, HTMLButtonElement> = {} as never;
      const toolBtns: Record<FogTool, HTMLButtonElement> = {} as never;
      const syncActive = () => {
        for (const [m, b] of Object.entries(modeBtns)) b.classList.toggle("dm-fog-active", this.mode === (m as FogMode));
        for (const [t, b] of Object.entries(toolBtns)) b.classList.toggle("dm-fog-active", this.tool === (t as FogTool));
      };
      for (const m of ["reveal", "cover"] as FogMode[]) {
        modeBtns[m] = barEl.createEl("button", { text: m === "reveal" ? "Reveal" : "Cover" });
        modeBtns[m].addEventListener("click", () => { this.mode = m; syncActive(); });
      }
      barEl.createSpan({ text: "·", cls: "dm-status-detail" });
      const toolLabels: Record<FogTool, string> = { brush: "Brush", rect: "Rectangle", cell: "Grid cell", gridrect: "Grid rect", room: "Room" };
      for (const t of ["brush", "rect", "cell", "gridrect", "room"] as FogTool[]) {
        toolBtns[t] = barEl.createEl("button", { text: toolLabels[t] });
        toolBtns[t].addEventListener("click", () => { this.tool = t; syncActive(); });
      }
      syncActive();

      barEl.createSpan({ text: "Brush", cls: "dm-status-detail" });
      const sizeSlider = barEl.createEl("input", { type: "range" });
      sizeSlider.min = "2";
      sizeSlider.max = "15";
      sizeSlider.step = "1";
      sizeSlider.value = String(this.brushPct);
      sizeSlider.title = "Brush size (% of map width)";
      sizeSlider.addEventListener("input", () => { this.brushPct = parseInt(sizeSlider.value, 10); });

      const revealAll = barEl.createEl("button", { text: "Reveal All" });
      revealAll.addEventListener("click", () => {
        this.ctx().clearRect(0, 0, this.fogCanvas.width, this.fogCanvas.height);
        redraw();
        this.commit();
      });
      const coverAll = barEl.createEl("button", { text: "Cover All", cls: "mod-warning" });
      coverAll.addEventListener("click", () => {
        const ctx = this.ctx();
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, this.fogCanvas.width, this.fogCanvas.height);
        redraw();
        this.commit();
      });

      this.setupFogDrawing(overlay, redraw, fogScale);
    };

    const renderWallsToolbar = (barEl: HTMLElement) => {
      const wallToolBtns: Record<WallsTool, HTMLButtonElement> = {} as never;
      const syncActive = () => {
        for (const [t, b] of Object.entries(wallToolBtns)) b.classList.toggle("dm-fog-active", this.wallsTool === (t as WallsTool));
      };
      for (const [t, label] of [["wall", "Wall"], ["door", "Door"], ["erase", "Erase"], ["toggle", "Toggle door"], ["rect", "Rect"]] as [WallsTool, string][]) {
        wallToolBtns[t] = barEl.createEl("button", { text: label });
        wallToolBtns[t].addEventListener("click", () => {
          this.wallsTool = t;
          // end any chain when switching tool
          this.chainAnchor = null;
          syncActive();
          redraw();
        });
      }
      syncActive();

      const snapLabel = barEl.createEl("label");
      snapLabel.createSpan({ text: "Snap" });
      const snapCb = snapLabel.createEl("input", { type: "checkbox" });
      snapCb.checked = this.wallsSnap;
      snapCb.addEventListener("change", () => { this.wallsSnap = snapCb.checked; });

      const importBtn = barEl.createEl("button", { text: "Import UVTT" });
      importBtn.addEventListener("click", () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".dd2vtt,.uvtt,.df2vtt,.json";
        input.addEventListener("change", () => {
          const file = input.files?.[0];
          if (!file) return;
          void file.text().then((text) => {
            let doc: unknown;
            try {
              doc = JSON.parse(text);
            } catch (err) {
              new Notice(`UVTT import failed: ${(err as Error).message}`, 6000);
              return;
            }
            this.importUvttDoc(doc);
          });
        });
        input.click();
      });

      const importFoundryBtn = barEl.createEl("button", { text: "Import Foundry" });
      importFoundryBtn.addEventListener("click", () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".zip";
        input.addEventListener("change", () => {
          const file = input.files?.[0];
          if (!file) return;
          void file.arrayBuffer().then((buf) => {
            this.importFoundryZip(new Uint8Array(buf));
          });
        });
        input.click();
      });

      this.setupWallsDrawing(overlay, redraw, fogScale);
    };

    const switchTab = (mode: EditorMode) => {
      this.editorMode = mode;
      // End any chain and rect drag on mode switch
      this.chainAnchor = null;
      this.cursorNatural = null;
      this.rectAnchor = null;
      // Remove existing drawing listeners by cloning the overlay
      const newOverlay = overlay.cloneNode(false) as HTMLCanvasElement;
      overlay.replaceWith(newOverlay);
      // Reassign overlay reference to the new node — we need to re-set octx too
      // Since we can't reassign const, rebuild bar content
      bar.empty();
      if (mode === "fog") {
        renderFogToolbar(bar);
      } else {
        renderWallsToolbar(bar);
      }
      syncTabActive();
      // redraw still works via closure referencing `octx` from the original overlay
      // but overlay is now replaced; we need to use the new node
      // Rebuild the redraw for the new overlay
      const newOctx = (newOverlay as HTMLCanvasElement).getContext("2d")!;
      const newRedraw = () => {
        newOctx.clearRect(0, 0, newOverlay.width, newOverlay.height);
        newOctx.globalAlpha = this.editorMode === "fog" ? 0.55 : 0.25;
        newOctx.drawImage(this.fogCanvas, 0, 0);
        newOctx.globalAlpha = 1;
        for (const w of this.walls) {
          newOctx.save();
          newOctx.lineWidth = 3;
          if (w.door) {
            newOctx.strokeStyle = "#44aaff";
            if (w.open) newOctx.setLineDash([8, 6]);
          } else {
            newOctx.strokeStyle = "#f5d90a";
          }
          newOctx.beginPath();
          newOctx.moveTo(w.x1 * fogScale, w.y1 * fogScale);
          newOctx.lineTo(w.x2 * fogScale, w.y2 * fogScale);
          newOctx.stroke();
          newOctx.setLineDash([]);
          newOctx.restore();
        }
        if (this.editorMode === "walls" && this.chainAnchor && this.cursorNatural) {
          newOctx.save();
          newOctx.strokeStyle = this.wallsTool === "door" ? "#44aaff" : "#f5d90a";
          newOctx.lineWidth = 2;
          newOctx.setLineDash([6, 4]);
          newOctx.beginPath();
          newOctx.moveTo(this.chainAnchor.x * fogScale, this.chainAnchor.y * fogScale);
          newOctx.lineTo(this.cursorNatural.x * fogScale, this.cursorNatural.y * fogScale);
          newOctx.stroke();
          newOctx.setLineDash([]);
          newOctx.restore();
        }
        if (this.editorMode === "walls" && this.wallsTool === "rect" && this.rectAnchor && this.cursorNatural) {
          newOctx.save();
          newOctx.strokeStyle = "#f5d90a";
          newOctx.lineWidth = 2;
          newOctx.setLineDash([6, 4]);
          const ax = this.rectAnchor.x * fogScale;
          const ay = this.rectAnchor.y * fogScale;
          const bx = this.cursorNatural.x * fogScale;
          const by = this.cursorNatural.y * fogScale;
          newOctx.strokeRect(ax, ay, bx - ax, by - ay);
          newOctx.setLineDash([]);
          newOctx.restore();
        }
      };
      this.redrawOverlay = newRedraw;
      newRedraw();
      if (mode === "fog") {
        this.setupFogDrawing(newOverlay, newRedraw, fogScale);
      } else {
        this.setupWallsDrawing(newOverlay, newRedraw, fogScale);
      }
    };

    fogTabBtn.addEventListener("click", () => switchTab("fog"));
    wallsTabBtn.addEventListener("click", () => switchTab("walls"));

    // Start in fog mode
    renderFogToolbar(bar);
  }

  private ctx(): CanvasRenderingContext2D {
    return this.fogCanvas.getContext("2d")!;
  }

  private toFog(overlay: HTMLCanvasElement, clientX: number, clientY: number): { x: number; y: number } {
    const b = overlay.getBoundingClientRect();
    return {
      x: ((clientX - b.left) / b.width) * this.fogCanvas.width,
      y: ((clientY - b.top) / b.height) * this.fogCanvas.height,
    };
  }

  private applyMode(ctx: CanvasRenderingContext2D) {
    if (this.mode === "reveal") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "black";
    }
  }

  private setupFogDrawing(overlay: HTMLCanvasElement, redraw: () => void, fogScale: number) {
    const stampBrush = (fx: number, fy: number) => {
      const ctx = this.ctx();
      this.applyMode(ctx);
      ctx.beginPath();
      ctx.arc(fx, fy, (this.fogCanvas.width * this.brushPct) / 100, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    };

    const paintCell = (fx: number, fy: number) => {
      const cell = gridCellRectAt(fx / fogScale, fy / fogScale, {
        pxPerSquare: this.panel.state.pxPerSquare,
        gridOffsetX: this.panel.state.gridOffsetX,
        gridOffsetY: this.panel.state.gridOffsetY,
      });
      const ctx = this.ctx();
      this.applyMode(ctx);
      ctx.fillRect(cell.x * fogScale, cell.y * fogScale, cell.w * fogScale, cell.h * fogScale);
      ctx.globalCompositeOperation = "source-over";
    };

    const handleRoomClick = (fx: number, fy: number) => {
      const fw = this.fogCanvas.width;
      const fh = this.fogCanvas.height;

      // Room boundaries are the sight-blocking walls only (open doors merge rooms
      // here, unlike Exploration where every door is a boundary).
      const blocked = buildBlockedMask(this.walls, fw, fh, fogScale, this.panel.state.pxPerSquare, blocksSight);
      const region = floodRegion(blocked, fw, fh, fx, fy);
      if (!region) {
        new Notice("That point is inside a wall");
        return;
      }

      const ctx = this.ctx();
      this.applyMode(ctx);
      ctx.drawImage(regionToCanvas(region, fw, fh), 0, 0);
      ctx.globalCompositeOperation = "source-over";

      redraw();
      this.commit();
    };

    overlay.addEventListener("mousedown", (e: MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const start = this.toFog(overlay, e.clientX, e.clientY);

      if (this.tool === "room") {
        handleRoomClick(start.x, start.y);
        return;
      }

      if (this.tool === "rect" || this.tool === "gridrect") {
        const snapToGrid = this.tool === "gridrect";
        const cfg = {
          pxPerSquare: this.panel.state.pxPerSquare,
          gridOffsetX: this.panel.state.gridOffsetX,
          gridOffsetY: this.panel.state.gridOffsetY,
        };
        const onMove = (me: MouseEvent) => {
          const cur = this.toFog(overlay, me.clientX, me.clientY);
          redraw();
          const octx = overlay.getContext("2d")!;
          octx.strokeStyle = this.mode === "reveal" ? "#7bd88f" : "#f97583";
          octx.setLineDash([6, 4]);
          octx.lineWidth = 2;
          octx.strokeRect(start.x, start.y, cur.x - start.x, cur.y - start.y);
          octx.setLineDash([]);
        };
        const onUp = (me: MouseEvent) => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          this.cleanupDrag = null;
          const end = this.toFog(overlay, me.clientX, me.clientY);
          const ctx = this.ctx();
          this.applyMode(ctx);
          if (snapToGrid) {
            const minX = Math.min(start.x, end.x);
            const minY = Math.min(start.y, end.y);
            const maxX = Math.max(start.x, end.x);
            const maxY = Math.max(start.y, end.y);
            const a = gridCellRectAt(minX / fogScale, minY / fogScale, cfg);
            const b = gridCellRectAt(maxX / fogScale, maxY / fogScale, cfg);
            ctx.fillRect(a.x * fogScale, a.y * fogScale, (b.x + b.w - a.x) * fogScale, (b.y + b.h - a.y) * fogScale);
          } else {
            ctx.fillRect(
              Math.min(start.x, end.x),
              Math.min(start.y, end.y),
              Math.abs(end.x - start.x),
              Math.abs(end.y - start.y)
            );
          }
          ctx.globalCompositeOperation = "source-over";
          redraw();
          this.commit();
        };
        this.cleanupDrag = () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        return;
      }

      const paint = this.tool === "brush" ? stampBrush : paintCell;
      paint(start.x, start.y);
      redraw();
      const onMove = (me: MouseEvent) => {
        const p = this.toFog(overlay, me.clientX, me.clientY);
        paint(p.x, p.y);
        redraw();
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        this.cleanupDrag = null;
        this.commit();
      };
      this.cleanupDrag = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  private snapPoint(x: number, y: number): { x: number; y: number } {
    const pps = this.panel.state.pxPerSquare;
    const ox = this.panel.state.gridOffsetX;
    const oy = this.panel.state.gridOffsetY;
    return {
      x: ox + Math.round((x - ox) / pps) * pps,
      y: oy + Math.round((y - oy) / pps) * pps,
    };
  }

  private toNatural(overlay: HTMLCanvasElement, clientX: number, clientY: number): { x: number; y: number } {
    const fog = this.toFog(overlay, clientX, clientY);
    const fogScale = this.fogCanvas.width / this.map.naturalWidth;
    return { x: fog.x / fogScale, y: fog.y / fogScale };
  }

  private setupWallsDrawing(overlay: HTMLCanvasElement, redraw: () => void, fogScale: number) {
    const distToSegment = (px: number, py: number, w: MapWall): number => {
      const dx = w.x2 - w.x1;
      const dy = w.y2 - w.y1;
      const lenSq = dx * dx + dy * dy;
      if (lenSq === 0) return Math.hypot(px - w.x1, py - w.y1);
      const t = Math.max(0, Math.min(1, ((px - w.x1) * dx + (py - w.y1) * dy) / lenSq));
      return Math.hypot(px - (w.x1 + t * dx), py - (w.y1 + t * dy));
    };

    overlay.addEventListener("mousemove", (e: MouseEvent) => {
      this.cursorNatural = this.toNatural(overlay, e.clientX, e.clientY);
      if (this.chainAnchor || this.rectAnchor) redraw();
    });

    overlay.addEventListener("mouseleave", () => {
      this.cursorNatural = null;
      if (this.chainAnchor || this.rectAnchor) redraw();
    });

    overlay.addEventListener("contextmenu", (e: MouseEvent) => {
      e.preventDefault();
      // Right-click ends the chain
      if (this.chainAnchor) {
        this.chainAnchor = null;
        redraw();
      }
    });

    overlay.addEventListener("mousedown", (e: MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();

      let nat = this.toNatural(overlay, e.clientX, e.clientY);
      if (this.wallsSnap) nat = this.snapPoint(nat.x, nat.y);

      if (this.wallsTool === "wall" || this.wallsTool === "door") {
        if (!this.chainAnchor) {
          this.chainAnchor = nat;
          redraw();
          return;
        }
        const anchor = this.chainAnchor;
        // Ignore zero-length segments
        if (Math.hypot(nat.x - anchor.x, nat.y - anchor.y) > 0.5) {
          const wall: MapWall = {
            x1: anchor.x,
            y1: anchor.y,
            x2: nat.x,
            y2: nat.y,
            ...(this.wallsTool === "door" ? { door: true, open: false } : {}),
          };
          this.walls = [...this.walls, wall];
          void this.panel.commitWalls([...this.walls]);
        }
        this.chainAnchor = nat;
        redraw();
        return;
      }

      const hitRadius = 12 / fogScale;

      if (this.wallsTool === "erase") {
        let nearest: MapWall | null = null;
        let nearestDist = Infinity;
        for (const w of this.walls) {
          const d = distToSegment(nat.x, nat.y, w);
          if (d < hitRadius && d < nearestDist) {
            nearestDist = d;
            nearest = w;
          }
        }
        if (nearest) {
          this.walls = this.walls.filter((w) => w !== nearest);
          void this.panel.commitWalls([...this.walls]);
          redraw();
        }
        return;
      }

      if (this.wallsTool === "toggle") {
        let nearest: MapWall | null = null;
        let nearestDist = Infinity;
        for (const w of this.walls) {
          if (!w.door) continue;
          const d = distToSegment(nat.x, nat.y, w);
          if (d < hitRadius && d < nearestDist) {
            nearestDist = d;
            nearest = w;
          }
        }
        if (nearest) {
          const toggled = nearest;
          this.walls = this.walls.map((w) => (w === toggled ? { ...w, open: !w.open } : w));
          void this.panel.commitWalls([...this.walls]);
          redraw();
        }
        return;
      }

      if (this.wallsTool === "rect") {
        this.rectAnchor = nat;
        const onMove = (me: MouseEvent) => {
          this.cursorNatural = this.toNatural(overlay, me.clientX, me.clientY);
          redraw();
        };
        const onUp = (me: MouseEvent) => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          this.cleanupDrag = null;
          const end = this.toNatural(overlay, me.clientX, me.clientY);
          const snapped = this.wallsSnap ? this.snapPoint(end.x, end.y) : end;
          const anchor = this.wallsSnap && this.rectAnchor
            ? this.snapPoint(this.rectAnchor.x, this.rectAnchor.y)
            : this.rectAnchor!;
          this.rectAnchor = null;
          const minX = Math.min(anchor.x, snapped.x);
          const minY = Math.min(anchor.y, snapped.y);
          const maxX = Math.max(anchor.x, snapped.x);
          const maxY = Math.max(anchor.y, snapped.y);
          if (maxX - minX < 0.5 || maxY - minY < 0.5) {
            redraw();
            return;
          }
          const newWalls: MapWall[] = [
            { x1: minX, y1: minY, x2: maxX, y2: minY },
            { x1: maxX, y1: minY, x2: maxX, y2: maxY },
            { x1: maxX, y1: maxY, x2: minX, y2: maxY },
            { x1: minX, y1: maxY, x2: minX, y2: minY },
          ];
          this.walls = [...this.walls, ...newWalls];
          void this.panel.commitWalls([...this.walls]);
          redraw();
        };
        this.cleanupDrag = () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          this.rectAnchor = null;
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        return;
      }
    });
  }

  private applyImportedWalls(result: UvttParseResult | FoundryImportResult, sourceLabel: string) {
    const scale = this.map.naturalWidth / (result.gridSquares.x * result.pixelsPerGrid);
    const scaledWalls: MapWall[] = result.walls.map((w) => ({
      x1: w.x1 * scale,
      y1: w.y1 * scale,
      x2: w.x2 * scale,
      y2: w.y2 * scale,
      ...(w.door ? { door: true } : {}),
      ...(w.open ? { open: true } : {}),
    }));

    this.walls = scaledWalls;
    void this.panel.commitWalls([...this.walls]);
    this.redrawOverlay?.();

    const rawPxPerSquare = this.map.naturalWidth / result.gridSquares.x;
    const pxPerSquare = Number.isInteger(rawPxPerSquare) ? rawPxPerSquare : parseFloat(rawPxPerSquare.toFixed(2));
    this.panel.applyGridConfig(pxPerSquare, 0, 0);

    const doors = scaledWalls.filter((w) => w.door).length;
    debug(`MapFogModal: ${sourceLabel} —`, scaledWalls.length, "walls,", doors, "doors, pxPerSquare", pxPerSquare);
    new Notice(`Imported ${scaledWalls.length} walls (${doors} doors) — grid set to ${pxPerSquare} px/square`);
  }

  importUvttDoc(doc: unknown) {
    let parsed;
    try {
      parsed = parseUvttWalls(doc);
    } catch (err) {
      new Notice(`UVTT import failed: ${(err as Error).message}`, 6000);
      return;
    }
    this.applyImportedWalls(parsed, "importUvttDoc");
  }

  importFoundryZip(zipBytes: Uint8Array) {
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(zipBytes, { filter: (f) => /\.(db|log|ldb)$/i.test(f.name) });
    } catch (err) {
      new Notice(`Foundry import failed: ${(err as Error).message}`, 6000);
      return;
    }
    let result: FoundryImportResult;
    try {
      result = parseFoundryModule(entries);
    } catch (err) {
      new Notice(`Foundry import failed: ${(err as Error).message}`, 6000);
      return;
    }
    this.applyImportedWalls(result, "importFoundryZip");
  }

  onClose() {
    // A drag can outlive the modal (Escape mid-stroke) — its listeners live on
    // document, not on the modal DOM.
    this.cleanupDrag?.();
    this.cleanupDrag = null;
    this.chainAnchor = null;
    this.cursorNatural = null;
    this.rectAnchor = null;
    this.redrawOverlay = null;
    this.contentEl.empty();
  }
}
