import { App, Modal } from "obsidian";
import type DmScreenPlugin from "../main";
import type { MapScreenPanel, ActiveMap } from "./MapScreenPanel";
import { fogCanvasSize, gridCellRectAt } from "../map/fog";
import { vaultPathFromUrl } from "../server";
import { debug } from "../debug";

type FogTool = "brush" | "rect" | "cell";
type FogMode = "reveal" | "cover";

export class MapFogModal extends Modal {
  private tool: FogTool = "brush";
  private mode: FogMode = "reveal";
  private brushPct = 5;
  private fogCanvas: HTMLCanvasElement;
  private redrawOverlay: (() => void) | null = null;
  private cleanupDrag: (() => void) | null = null;

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
    this.modalEl.addClass("dm-fog-modal");
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Fog of War" });

    const bar = contentEl.createDiv("dm-fog-toolbar");
    const modeBtns: Record<FogMode, HTMLButtonElement> = {} as never;
    const toolBtns: Record<FogTool, HTMLButtonElement> = {} as never;
    const syncActive = () => {
      for (const [m, b] of Object.entries(modeBtns)) b.classList.toggle("dm-fog-active", this.mode === m);
      for (const [t, b] of Object.entries(toolBtns)) b.classList.toggle("dm-fog-active", this.tool === t);
    };
    for (const m of ["reveal", "cover"] as FogMode[]) {
      modeBtns[m] = bar.createEl("button", { text: m === "reveal" ? "Reveal" : "Cover" });
      modeBtns[m].addEventListener("click", () => { this.mode = m; syncActive(); });
    }
    bar.createSpan({ text: "·", cls: "dm-status-detail" });
    const toolLabels: Record<FogTool, string> = { brush: "Brush", rect: "Rectangle", cell: "Grid cell" };
    for (const t of ["brush", "rect", "cell"] as FogTool[]) {
      toolBtns[t] = bar.createEl("button", { text: toolLabels[t] });
      toolBtns[t].addEventListener("click", () => { this.tool = t; syncActive(); });
    }
    syncActive();

    bar.createSpan({ text: "Brush", cls: "dm-status-detail" });
    const sizeSlider = bar.createEl("input", { type: "range" });
    sizeSlider.min = "2";
    sizeSlider.max = "15";
    sizeSlider.step = "1";
    sizeSlider.value = String(this.brushPct);
    sizeSlider.title = "Brush size (% of map width)";
    sizeSlider.addEventListener("input", () => { this.brushPct = parseInt(sizeSlider.value, 10); });

    const revealAll = bar.createEl("button", { text: "Reveal All" });
    revealAll.addEventListener("click", () => {
      this.ctx().clearRect(0, 0, this.fogCanvas.width, this.fogCanvas.height);
      this.redrawOverlay?.();
      this.commit();
    });
    const coverAll = bar.createEl("button", { text: "Cover All", cls: "mod-warning" });
    coverAll.addEventListener("click", () => {
      const ctx = this.ctx();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, this.fogCanvas.width, this.fogCanvas.height);
      this.redrawOverlay?.();
      this.commit();
    });

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
    const redraw = () => {
      octx.clearRect(0, 0, overlay.width, overlay.height);
      octx.globalAlpha = 0.55;
      octx.drawImage(this.fogCanvas, 0, 0);
      octx.globalAlpha = 1;
    };
    this.redrawOverlay = redraw;
    redraw();
    this.setupDrawing(overlay, redraw);
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

  private setupDrawing(overlay: HTMLCanvasElement, redraw: () => void) {
    const fogScale = this.fogCanvas.width / this.map.naturalWidth;

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

    overlay.addEventListener("mousedown", (e: MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const start = this.toFog(overlay, e.clientX, e.clientY);

      if (this.tool === "rect") {
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
          ctx.fillRect(
            Math.min(start.x, end.x),
            Math.min(start.y, end.y),
            Math.abs(end.x - start.x),
            Math.abs(end.y - start.y)
          );
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

  onClose() {
    // A drag can outlive the modal (Escape mid-stroke) — its listeners live on
    // document, not on the modal DOM.
    this.cleanupDrag?.();
    this.cleanupDrag = null;
    this.redrawOverlay = null;
    this.contentEl.empty();
  }
}
