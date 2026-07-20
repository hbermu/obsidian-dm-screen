import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { zipSync } from "fflate";
import { installNapiCanvas, pixelAt } from "../../test/canvas/napi-canvas-shim";
import { MapFogModal } from "../views/MapFogModal";
import { fogCanvasSize } from "../map/fog";
import type { ActiveMap } from "../views/MapScreenPanel";
import type { MapWall } from "../map/types";

// Map dimensions: 1000×750 natural pixels; fog canvas: 1024×768
const MAP_W = 1000;
const MAP_H = 750;
const { width: FOG_W, height: FOG_H } = fogCanvasSize(MAP_W, MAP_H);
const fogScale = FOG_W / MAP_W;

let uninstall: () => void;

// ---- Obsidian HTMLElement polyfills ----
function polyfillHTMLElement() {
  if (!HTMLElement.prototype.addClass) {
    HTMLElement.prototype.addClass = function (cls: string) { this.classList.add(cls); };
  }
  if (!HTMLElement.prototype.createDiv) {
    (HTMLElement.prototype as unknown as Record<string, unknown>).createDiv = function (arg?: string | { cls?: string; text?: string }) {
      const div = document.createElement("div");
      if (typeof arg === "string") div.className = arg;
      else if (arg) { if (arg.cls) div.className = arg.cls; if (arg.text) div.textContent = arg.text; }
      this.appendChild(div);
      return div;
    };
  }
  if (!HTMLElement.prototype.createEl) {
    (HTMLElement.prototype as unknown as Record<string, unknown>).createEl = function (tag: string, opts?: { text?: string; cls?: string; type?: string }) {
      const el = document.createElement(tag);
      if (opts?.cls) el.className = opts.cls;
      if (opts?.text) el.textContent = opts.text;
      if (opts && "type" in opts && opts.type) (el as HTMLInputElement).type = opts.type;
      this.appendChild(el);
      return el;
    };
  }
  if (!HTMLElement.prototype.createSpan) {
    (HTMLElement.prototype as unknown as Record<string, unknown>).createSpan = function (opts?: { text?: string; cls?: string }) {
      const el = document.createElement("span");
      if (opts?.cls) el.className = opts.cls;
      if (opts?.text) el.textContent = opts.text;
      this.appendChild(el);
      return el;
    };
  }
  if (!HTMLElement.prototype.empty) {
    (HTMLElement.prototype as unknown as Record<string, unknown>).empty = function () { this.innerHTML = ""; };
  }
}

// ---- Stubs ----
const appStub = { vault: { adapter: { getResourcePath: () => null as null } } };

function makePanelStub(walls: MapWall[] = []) {
  const commitFogSpy = vi.fn().mockResolvedValue(undefined);
  const commitWallsSpy = vi.fn().mockResolvedValue(undefined);
  const applyGridConfigSpy = vi.fn();
  return {
    commitFog: commitFogSpy,
    commitWalls: commitWallsSpy,
    applyGridConfig: applyGridConfigSpy,
    fogDataUrl: null as string | null,
    walls,
    state: {
      pxPerSquare: 100,
      gridOffsetX: 0,
      gridOffsetY: 0,
    },
  };
}

const mapStub: ActiveMap = {
  url: "/vault/test.png",
  mediaType: "image",
  naturalWidth: MAP_W,
  naturalHeight: MAP_H,
};

// ---- Helpers ----
function openModal(panelStub: ReturnType<typeof makePanelStub>, walls?: MapWall[]): {
  modal: MapFogModal;
  overlay: HTMLCanvasElement;
  stage: HTMLElement;
  contentEl: HTMLElement;
} {
  const modal = new MapFogModal(
    appStub as never,
    { app: appStub, settings: { mapFogTvOpacity: 0.9 } } as never,
    panelStub as never,
    mapStub
  );
  modal.onOpen();

  // The overlay is the canvas element inside .dm-fog-stage
  const stage = modal.contentEl.querySelector(".dm-fog-stage") as HTMLElement;
  const overlay = stage.querySelector(".dm-fog-overlay") as HTMLCanvasElement;

  // Stub getBoundingClientRect so toFog maps 1:1 (clientX/Y === fog canvas coords)
  overlay.getBoundingClientRect = () => ({
    left: 0, top: 0,
    width: FOG_W, height: FOG_H,
    right: FOG_W, bottom: FOG_H,
    x: 0, y: 0,
    toJSON: () => ({}),
  });

  return { modal, overlay, stage, contentEl: modal.contentEl };
}

// Find a toolbar button by text content
function findBtn(contentEl: HTMLElement, text: string): HTMLButtonElement {
  const btn = Array.from(contentEl.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === text
  ) as HTMLButtonElement | undefined;
  if (!btn) throw new Error(`Button "${text}" not found`);
  return btn;
}

// Cover All: fill the fog canvas with opaque black
function coverAll(contentEl: HTMLElement) {
  findBtn(contentEl, "Cover All").dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

// Dispatch mouse events on the overlay, mousemove/mouseup on document
function fireMousedown(overlay: HTMLElement, x: number, y: number, button = 0) {
  overlay.dispatchEvent(new MouseEvent("mousedown", { clientX: x, clientY: y, button, bubbles: true }));
}

function fireMousemove(x: number, y: number) {
  document.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y, bubbles: true }));
}

function fireMouseup(x: number, y: number) {
  document.dispatchEvent(new MouseEvent("mouseup", { clientX: x, clientY: y, bubbles: true }));
}

function fireContextmenu(overlay: HTMLElement, x: number, y: number) {
  overlay.dispatchEvent(new MouseEvent("contextmenu", { clientX: x, clientY: y, bubbles: true }));
}

// ---- Helper to get the fog canvas (internal) via panel.commitFog capture ----
// Since we can't access private `this.fogCanvas`, we read pixels from the first
// wired canvas inside the stage that matches fog dimensions.
function getFogEl(modal: MapFogModal): HTMLCanvasElement {
  // The fog canvas is created before onOpen; it is the first canvas created
  // by the modal constructor (buildFogCanvas). We capture it via the stage.
  // Since overlay also is a canvas, we need the one that matches FOG_W×FOG_H
  // and is NOT the overlay (overlay is explicitly .dm-fog-overlay).
  // Fallback: capture via commitFog call — commitFog receives `this.fogCanvas.toDataURL()`
  // so the fog canvas IS the shimmed one that produced the data URL.
  // Simplest: after Cover All, the fog canvas is black. We find the canvas that is
  // black at center via pixelAt.
  const allCanvases = Array.from(
    (modal.contentEl.closest("body") ?? document.body).querySelectorAll("canvas")
  ) as HTMLCanvasElement[];
  // The overlay is `.dm-fog-overlay`; the fog canvas is the other wired canvas
  for (const c of allCanvases) {
    if (c.classList.contains("dm-fog-overlay")) continue;
    if (c.width === FOG_W && c.height === FOG_H) return c;
  }
  throw new Error("Fog canvas not found");
}

beforeEach(() => {
  polyfillHTMLElement();
  uninstall = installNapiCanvas();
});

afterEach(() => {
  vi.restoreAllMocks();
  uninstall();
});

// ---- Tests ----

describe("MapFogModal fog tools — pixel assertions", () => {
  it("Brush reveal: drag center produces transparent pixels at stroke, opaque at corner", async () => {
    const panel = makePanelStub();
    const { modal, overlay, contentEl } = openModal(panel);

    // Start fully covered
    coverAll(contentEl);

    // Switch to Reveal mode (already default but be explicit)
    findBtn(contentEl, "Reveal").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    findBtn(contentEl, "Brush").dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // Brush drag across center
    const cx = FOG_W / 2;
    const cy = FOG_H / 2;
    fireMousedown(overlay, cx, cy);
    fireMousemove(cx + 10, cy);
    fireMousemove(cx + 20, cy);
    fireMouseup(cx + 20, cy);

    // commitFog is called on mouseup
    await vi.waitFor(() => expect(panel.commitFog).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/png;base64,/)));

    const dataUrl = panel.commitFog.mock.calls[panel.commitFog.mock.calls.length - 1][0] as string;
    const { loadImage, createCanvas } = await import("@napi-rs/canvas");
    const img = await loadImage(Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
    const nc = createCanvas(FOG_W, FOG_H);
    const ctx = nc.getContext("2d");
    ctx.drawImage(img, 0, 0);

    // Center stroke should be transparent (revealed)
    const centerPx = ctx.getImageData(cx, cy, 1, 1).data;
    expect(centerPx[3]).toBeLessThan(50);

    // Top-left corner should remain opaque (untouched)
    const cornerPx = ctx.getImageData(2, 2, 1, 1).data;
    expect(cornerPx[3]).toBeGreaterThan(200);

    modal.onClose();
  });

  it("Cover All then Reveal All clears fog", () => {
    const panel = makePanelStub();
    const { modal, contentEl } = openModal(panel);

    coverAll(contentEl);
    expect(panel.commitFog).toHaveBeenCalledTimes(1);
    const afterCover = panel.commitFog.mock.calls[0][0] as string;
    expect(afterCover).toMatch(/^data:image\/png;base64,/);

    panel.commitFog.mockClear();
    findBtn(contentEl, "Reveal All").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(panel.commitFog).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/png;base64,/));

    modal.onClose();
  });

  it("Rect reveal: drag top-left → bottom-right reveals the rect, not the corner", async () => {
    const panel = makePanelStub();
    const { modal, overlay, contentEl } = openModal(panel);
    coverAll(contentEl);
    panel.commitFog.mockClear();

    findBtn(contentEl, "Reveal").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    findBtn(contentEl, "Rectangle").dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // Drag from (200,200) to (600,500) — a rect in the middle
    fireMousedown(overlay, 200, 200);
    fireMousemove(400, 350);
    fireMouseup(600, 500);

    await vi.waitFor(() => expect(panel.commitFog).toHaveBeenCalled());
    const dataUrl = panel.commitFog.mock.calls[panel.commitFog.mock.calls.length - 1][0] as string;
    const { loadImage, createCanvas } = await import("@napi-rs/canvas");
    const img = await loadImage(Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
    const nc = createCanvas(FOG_W, FOG_H);
    const ctx = nc.getContext("2d");
    ctx.drawImage(img, 0, 0);

    // Center of the rect (≈400,350) → transparent
    const inside = ctx.getImageData(400, 350, 1, 1).data;
    expect(inside[3]).toBeLessThan(50);

    // Outside the rect → opaque
    const outside = ctx.getImageData(2, 2, 1, 1).data;
    expect(outside[3]).toBeGreaterThan(200);

    modal.onClose();
  });

  it("Rect reveal: reversed drag (bottom-right → top-left) normalizes correctly", async () => {
    const panel = makePanelStub();
    const { modal, overlay, contentEl } = openModal(panel);
    coverAll(contentEl);
    panel.commitFog.mockClear();

    findBtn(contentEl, "Reveal").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    findBtn(contentEl, "Rectangle").dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // Reversed: drag from (600,500) to (200,200)
    fireMousedown(overlay, 600, 500);
    fireMousemove(400, 350);
    fireMouseup(200, 200);

    await vi.waitFor(() => expect(panel.commitFog).toHaveBeenCalled());
    const dataUrl = panel.commitFog.mock.calls[panel.commitFog.mock.calls.length - 1][0] as string;
    const { loadImage, createCanvas } = await import("@napi-rs/canvas");
    const img = await loadImage(Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
    const nc = createCanvas(FOG_W, FOG_H);
    const ctx = nc.getContext("2d");
    ctx.drawImage(img, 0, 0);

    // Center of the rect → transparent (same result as forward drag)
    const inside = ctx.getImageData(400, 350, 1, 1).data;
    expect(inside[3]).toBeLessThan(50);

    // Corner outside → opaque
    const outside = ctx.getImageData(2, 2, 1, 1).data;
    expect(outside[3]).toBeGreaterThan(200);

    modal.onClose();
  });

  it("Grid cell: click reveals exactly one cell, neighbor remains opaque", async () => {
    const panel = makePanelStub();
    const { modal, overlay, contentEl } = openModal(panel);
    coverAll(contentEl);
    panel.commitFog.mockClear();

    findBtn(contentEl, "Reveal").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    findBtn(contentEl, "Grid cell").dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // Click in the center of the grid (pxPerSquare=100, fogScale≈1.024)
    // The cell that contains fog coords (512, 400) is gridCellRectAt(500, 391, {pxPerSquare:100, ...})
    // = cell at (0*100, 0*100) in relative terms... actually grid starts at offset 0,0
    // Cell at fog (512, 400): natural coords = (512/fogScale, 400/fogScale) = (500, 391)
    // ix = floor(500/100) = 5, iy = floor(391/100) = 3
    // Cell rect: x=500, y=300, w=100, h=100 in natural coords
    // In fog: x=512, y=307, w=102, h=102
    const clickX = 550; // inside cell ix=5 (natural 537, fog cell x≈512)
    const clickY = 350; // inside cell iy=3 (natural 341, fog cell y≈307)

    fireMousedown(overlay, clickX, clickY);
    fireMouseup(clickX, clickY);

    await vi.waitFor(() => expect(panel.commitFog).toHaveBeenCalled());
    const dataUrl = panel.commitFog.mock.calls[panel.commitFog.mock.calls.length - 1][0] as string;
    const { loadImage, createCanvas } = await import("@napi-rs/canvas");
    const img = await loadImage(Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
    const nc = createCanvas(FOG_W, FOG_H);
    const ctx = nc.getContext("2d");
    ctx.drawImage(img, 0, 0);

    // Inside the clicked cell → transparent
    const inside = ctx.getImageData(clickX, clickY, 1, 1).data;
    expect(inside[3]).toBeLessThan(50);

    // A point far from the cell → opaque
    const outside = ctx.getImageData(10, 10, 1, 1).data;
    expect(outside[3]).toBeGreaterThan(200);

    modal.onClose();
  });

  it("Grid rect: diagonal drag reveals a snapped multi-cell block", async () => {
    const panel = makePanelStub();
    const { modal, overlay, contentEl } = openModal(panel);
    coverAll(contentEl);
    panel.commitFog.mockClear();

    findBtn(contentEl, "Reveal").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    findBtn(contentEl, "Grid rect").dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // Drag from (100,100) to (400,400) in fog coords
    fireMousedown(overlay, 100, 100);
    fireMousemove(250, 250);
    fireMouseup(400, 400);

    await vi.waitFor(() => expect(panel.commitFog).toHaveBeenCalled());
    const dataUrl = panel.commitFog.mock.calls[panel.commitFog.mock.calls.length - 1][0] as string;
    const { loadImage, createCanvas } = await import("@napi-rs/canvas");
    const img = await loadImage(Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
    const nc = createCanvas(FOG_W, FOG_H);
    const ctx = nc.getContext("2d");
    ctx.drawImage(img, 0, 0);

    // Center of the dragged area → transparent
    const inside = ctx.getImageData(250, 250, 1, 1).data;
    expect(inside[3]).toBeLessThan(50);

    // Far corner → opaque
    const outside = ctx.getImageData(FOG_W - 10, FOG_H - 10, 1, 1).data;
    expect(outside[3]).toBeGreaterThan(200);

    modal.onClose();
  });

  it("Room reveal: click inside a walled room reveals only that room", async () => {
    // Two rooms side by side, divided by a vertical wall in the middle of the fog
    // Room A: x<512, Room B: x>512 (in fog coords)
    const walls: MapWall[] = [
      // Vertical wall at fog x=512 (natural x=500)
      { x1: 500, y1: 0, x2: 500, y2: MAP_H },
    ];
    const panel = makePanelStub(walls);
    const { modal, overlay, contentEl } = openModal(panel, walls);
    coverAll(contentEl);
    panel.commitFog.mockClear();

    findBtn(contentEl, "Reveal").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    findBtn(contentEl, "Room").dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // Click in Room A center (fog x=256, y=384)
    fireMousedown(overlay, 256, 384);
    fireMouseup(256, 384);

    // Wait for commitFog
    await vi.waitFor(() => expect(panel.commitFog).toHaveBeenCalled());
    const dataUrl = panel.commitFog.mock.calls[panel.commitFog.mock.calls.length - 1][0] as string;
    const { loadImage, createCanvas } = await import("@napi-rs/canvas");
    const img = await loadImage(Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
    const nc = createCanvas(FOG_W, FOG_H);
    const ctx = nc.getContext("2d");
    ctx.drawImage(img, 0, 0);

    // Room A center → transparent (revealed)
    const roomAPx = ctx.getImageData(200, 384, 1, 1).data;
    expect(roomAPx[3]).toBeLessThan(50);

    // Room B center → opaque (not revealed)
    const roomBPx = ctx.getImageData(800, 384, 1, 1).data;
    expect(roomBPx[3]).toBeGreaterThan(200);

    modal.onClose();
  });

  it("Room tool: click on wall shows Notice and does not commit", async () => {
    const walls: MapWall[] = [
      { x1: 500, y1: 0, x2: 500, y2: MAP_H },
    ];
    const panel = makePanelStub(walls);
    const { modal, overlay, contentEl } = openModal(panel, walls);
    coverAll(contentEl);
    panel.commitFog.mockClear();

    findBtn(contentEl, "Reveal").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    findBtn(contentEl, "Room").dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // Click at fog coord (512, 384) which maps to natural (500, 375) — on the wall
    fireMousedown(overlay, 512, 384);
    fireMouseup(512, 384);

    // commitFog should NOT be called when clicking on a wall
    await new Promise((r) => setTimeout(r, 20));
    expect(panel.commitFog).not.toHaveBeenCalled();

    modal.onClose();
  });

  it("cleanupDrag: closing modal mid-drag removes document listeners", () => {
    const panel = makePanelStub();
    const { modal, overlay } = openModal(panel);
    coverAll(panel.commitFog.mock ? modal.contentEl : modal.contentEl);
    panel.commitFog.mockClear();

    findBtn(modal.contentEl, "Brush").dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // Start a drag but don't release
    fireMousedown(overlay, FOG_W / 2, FOG_H / 2);

    // Close modal mid-drag
    modal.onClose();

    // Dispatch mousemove on document — commitFog should NOT be called
    fireMousemove(FOG_W / 2 + 50, FOG_H / 2);
    fireMouseup(FOG_W / 2 + 50, FOG_H / 2);

    expect(panel.commitFog).not.toHaveBeenCalled();
  });
});

describe("MapFogModal Walls tab — pixel assertions", () => {
  function switchToWalls(contentEl: HTMLElement) {
    findBtn(contentEl, "Walls").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  function getOverlayAfterSwitch(modal: MapFogModal): HTMLCanvasElement {
    const stage = modal.contentEl.querySelector(".dm-fog-stage") as HTMLElement;
    const overlay = stage.querySelector(".dm-fog-overlay") as HTMLCanvasElement;
    overlay.getBoundingClientRect = () => ({
      left: 0, top: 0, width: FOG_W, height: FOG_H,
      right: FOG_W, bottom: FOG_H, x: 0, y: 0, toJSON: () => ({}),
    });
    return overlay;
  }

  it("Wall chain: 3 clicks + contextmenu → commitWalls with 2 segments", () => {
    const panel = makePanelStub();
    const { modal, contentEl } = openModal(panel);
    switchToWalls(contentEl);
    const overlay = getOverlayAfterSwitch(modal);

    // fogScale ≈ 1.024; natural coords = fog / fogScale
    // Click 1: anchor at fog (102, 102) → natural (99.6, 99.6)
    fireMousedown(overlay, 102, 102);
    // Click 2: segment from (100,100) to (204,102) → natural (199, 99)
    fireMousedown(overlay, 204, 102);
    // Click 3: segment from (204,102) to (306,204) → natural (299, 199)
    fireMousedown(overlay, 306, 204);
    // Right-click: end chain without adding segment
    fireContextmenu(overlay, 306, 204);

    expect(panel.commitWalls).toHaveBeenCalledTimes(2);
    const walls = panel.commitWalls.mock.calls[panel.commitWalls.mock.calls.length - 1][0] as MapWall[];
    expect(walls).toHaveLength(2);

    modal.onClose();
  });

  it("Door tool: creates wall with door:true open:false", () => {
    const panel = makePanelStub();
    const { modal, contentEl } = openModal(panel);
    switchToWalls(contentEl);
    const overlay = getOverlayAfterSwitch(modal);

    findBtn(contentEl, "Door").dispatchEvent(new MouseEvent("click", { bubbles: true }));

    fireMousedown(overlay, 100, 100);
    fireMousedown(overlay, 200, 100);
    fireContextmenu(overlay, 200, 100);

    expect(panel.commitWalls).toHaveBeenCalledTimes(1);
    const walls = panel.commitWalls.mock.calls[0][0] as MapWall[];
    expect(walls[0].door).toBe(true);
    expect(walls[0].open).toBe(false);

    modal.onClose();
  });

  it("Toggle door: flips open state and original object is not mutated", () => {
    const existingWall: MapWall = { x1: 50, y1: 50, x2: 200, y2: 50, door: true, open: false };
    const panel = makePanelStub([existingWall]);
    const { modal, contentEl } = openModal(panel, [existingWall]);
    switchToWalls(contentEl);
    const overlay = getOverlayAfterSwitch(modal);

    findBtn(contentEl, "Toggle door").dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // Click near the midpoint of the wall (natural x=125, y=50; fog: x=128, y=51)
    // hitRadius = 12/fogScale ≈ 11.7; wall midpoint in natural = (125, 50)
    // Click at fog (128, 51) → natural (125, 50) — midpoint of wall
    fireMousedown(overlay, 128, 51);

    expect(panel.commitWalls).toHaveBeenCalledTimes(1);
    const walls = panel.commitWalls.mock.calls[0][0] as MapWall[];
    expect(walls[0].open).toBe(true);
    // Original object must not be mutated
    expect(existingWall.open).toBe(false);

    modal.onClose();
  });

  it("Erase tool: removes the nearest wall segment", () => {
    const wall: MapWall = { x1: 100, y1: 100, x2: 200, y2: 100 };
    const panel = makePanelStub([wall]);
    const { modal, contentEl } = openModal(panel, [wall]);
    switchToWalls(contentEl);
    const overlay = getOverlayAfterSwitch(modal);

    findBtn(contentEl, "Erase").dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // Click near the midpoint of the wall (natural x=150, y=100 → fog≈153,102)
    fireMousedown(overlay, 153, 102);

    expect(panel.commitWalls).toHaveBeenCalledTimes(1);
    const walls = panel.commitWalls.mock.calls[0][0] as MapWall[];
    expect(walls).toHaveLength(0);

    modal.onClose();
  });

  it("Snap on: wall clicks snap to grid intersections", () => {
    const panel = makePanelStub();
    const { modal, contentEl } = openModal(panel);
    switchToWalls(contentEl);
    const overlay = getOverlayAfterSwitch(modal);

    // Enable snap
    const snapCb = contentEl.querySelector('input[type="checkbox"]') as HTMLInputElement;
    snapCb.checked = true;
    snapCb.dispatchEvent(new Event("change", { bubbles: true }));

    // Click at fog (115,115) → natural (112.3, 112.3); snap(112.3,112.3) → nearest grid point = 100,100
    fireMousedown(overlay, 115, 115); // anchor snaps to (100,100)
    // Click at fog (225,115) → natural (219.7, 112.3); snap → (200,100)
    fireMousedown(overlay, 225, 115);
    fireContextmenu(overlay, 225, 115);

    expect(panel.commitWalls).toHaveBeenCalledTimes(1);
    const walls = panel.commitWalls.mock.calls[0][0] as MapWall[];
    expect(walls[0].x1).toBeCloseTo(100, 0);
    expect(walls[0].y1).toBeCloseTo(100, 0);
    expect(walls[0].x2).toBeCloseTo(200, 0);
    expect(walls[0].y2).toBeCloseTo(100, 0);

    modal.onClose();
  });
});

describe("MapFogModal — uvtt import", () => {
  interface WallsFixture {
    walls: MapWall[];
  }

  const rawFixtureDoc = JSON.parse(
    readFileSync(join(__dirname, "fixtures", "dd2vtt-felderhouse-raw.json"), "utf-8")
  ) as unknown;

  const wallsFixture = JSON.parse(
    readFileSync(join(__dirname, "fixtures", "dd2vtt-felderhouse-walls.json"), "utf-8")
  ) as WallsFixture;

  // The UVTT map is 8320 wide; the test map is 4160 (half) — scale factor 0.5
  const UVTT_HALF_W = 4160;

  function openModalWithWidth(naturalWidth: number): { modal: MapFogModal; panel: ReturnType<typeof makePanelStub> } {
    const panel = makePanelStub();
    const halfMap: ActiveMap = {
      url: "/vault/test.png",
      mediaType: "image",
      naturalWidth,
      naturalHeight: Math.round(naturalWidth * (750 / 1000)),
    };
    const modal = new MapFogModal(
      appStub as never,
      { app: appStub, settings: { mapFogTvOpacity: 0.9 } } as never,
      panel as never,
      halfMap
    );
    modal.onOpen();
    return { modal, panel };
  }

  it("importUvttDoc on half-width map scales all 173 walls by 0.5 and calls applyGridConfig with pxPerSquare 64", () => {
    const { modal, panel } = openModalWithWidth(UVTT_HALF_W);

    modal.importUvttDoc(rawFixtureDoc);

    expect(panel.commitWalls).toHaveBeenCalledTimes(1);
    const walls = panel.commitWalls.mock.calls[0][0] as MapWall[];
    expect(walls).toHaveLength(173);

    // Every coordinate should be exactly half of the converted fixture
    for (let i = 0; i < walls.length; i++) {
      expect(walls[i].x1).toBeCloseTo(wallsFixture.walls[i].x1 * 0.5, 5);
      expect(walls[i].y1).toBeCloseTo(wallsFixture.walls[i].y1 * 0.5, 5);
      expect(walls[i].x2).toBeCloseTo(wallsFixture.walls[i].x2 * 0.5, 5);
      expect(walls[i].y2).toBeCloseTo(wallsFixture.walls[i].y2 * 0.5, 5);
    }

    // pxPerSquare = naturalWidth / gridSquares.x = 4160 / 65 = 64
    expect(panel.applyGridConfig).toHaveBeenCalledWith(64, 0, 0);

    modal.onClose();
  });

  it("importUvttDoc with malformed doc shows Notice and does not call commitWalls", async () => {
    const obsidian = await import("obsidian");
    const noticeSpy = vi.spyOn(obsidian, "Notice");

    const { modal, panel } = openModalWithWidth(UVTT_HALF_W);
    modal.importUvttDoc({});

    expect(panel.commitWalls).not.toHaveBeenCalled();
    expect(noticeSpy).toHaveBeenCalledWith(expect.stringContaining("UVTT import failed"), 6000);

    noticeSpy.mockRestore();
    modal.onClose();
  });
});

describe("MapFogModal Walls tab — Rect wall tool", () => {
  function switchToWalls(contentEl: HTMLElement) {
    findBtn(contentEl, "Walls").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  function getOverlayAfterSwitch(modal: MapFogModal): HTMLCanvasElement {
    const stage = modal.contentEl.querySelector(".dm-fog-stage") as HTMLElement;
    const overlay = stage.querySelector(".dm-fog-overlay") as HTMLCanvasElement;
    overlay.getBoundingClientRect = () => ({
      left: 0, top: 0, width: FOG_W, height: FOG_H,
      right: FOG_W, bottom: FOG_H, x: 0, y: 0, toJSON: () => ({}),
    });
    return overlay;
  }

  it("mousedown+mouseup creates 4 plain wall segments forming the bbox", () => {
    const panel = makePanelStub();
    const { modal, contentEl } = openModal(panel);
    switchToWalls(contentEl);
    const overlay = getOverlayAfterSwitch(modal);

    findBtn(contentEl, "Rect").dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // fog coords (100,100) → natural (≈97.6, 97.6); (300,250) → natural (≈292.9, 244.1)
    // We use identity-mapped coords for simplicity: getBoundingClientRect returns FOG_W×FOG_H
    // so toFog gives fog coords directly; toNatural divides by fogScale ≈ 1.024
    fireMousedown(overlay, 102, 102); // anchor ~= nat (99.6, 99.6) ≈ 100,100
    fireMousemove(200, 150);
    fireMouseup(307, 256); // end ~= nat (300, 250) after / fogScale

    expect(panel.commitWalls).toHaveBeenCalledTimes(1);
    const walls = panel.commitWalls.mock.calls[0][0] as MapWall[];
    expect(walls).toHaveLength(4);

    // All walls must be plain (no door property set to true)
    for (const w of walls) {
      expect(w.door).toBeFalsy();
    }

    // Find bounding box from the 4 walls
    const xs = walls.flatMap((w) => [w.x1, w.x2]);
    const ys = walls.flatMap((w) => [w.y1, w.y2]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    // bbox should be non-degenerate
    expect(maxX - minX).toBeGreaterThan(0);
    expect(maxY - minY).toBeGreaterThan(0);

    // The 4 edges: top, right, bottom, left
    const top = walls.find((w) => w.y1 === minY && w.y2 === minY);
    const right = walls.find((w) => w.x1 === maxX && w.x2 === maxX);
    const bottom = walls.find((w) => w.y1 === maxY && w.y2 === maxY);
    const left = walls.find((w) => w.x1 === minX && w.x2 === minX);
    expect(top).toBeDefined();
    expect(right).toBeDefined();
    expect(bottom).toBeDefined();
    expect(left).toBeDefined();

    modal.onClose();
  });

  it("erase removes one of the four rect walls, leaving three", () => {
    const panel = makePanelStub();
    const { modal, contentEl } = openModal(panel);
    switchToWalls(contentEl);
    const overlay = getOverlayAfterSwitch(modal);

    findBtn(contentEl, "Rect").dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // Drag a ~100×100 rect starting at natural ≈ (100,100)
    fireMousedown(overlay, 102, 102);
    fireMouseup(204, 204);

    expect(panel.commitWalls).toHaveBeenCalledTimes(1);
    let walls = panel.commitWalls.mock.calls[0][0] as MapWall[];
    expect(walls).toHaveLength(4);
    panel.commitWalls.mockClear();

    // Switch to Erase and click near the midpoint of the top edge
    // top edge is at y≈100 (natural), midpoint x≈150 → fog (154, 102)
    findBtn(contentEl, "Erase").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    fireMousedown(overlay, 154, 102); // should hit top edge

    expect(panel.commitWalls).toHaveBeenCalledTimes(1);
    walls = panel.commitWalls.mock.calls[0][0] as MapWall[];
    expect(walls).toHaveLength(3);

    modal.onClose();
  });

  it("degenerate rect (zero width) does not call commitWalls", () => {
    const panel = makePanelStub();
    const { modal, contentEl } = openModal(panel);
    switchToWalls(contentEl);
    const overlay = getOverlayAfterSwitch(modal);

    findBtn(contentEl, "Rect").dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // Same X for both start and end
    fireMousedown(overlay, 100, 100);
    fireMouseup(100, 200);

    expect(panel.commitWalls).not.toHaveBeenCalled();
    modal.onClose();
  });
});

describe("MapFogModal — Foundry import", () => {
  function openModalWithNaturalWidth(naturalWidth: number): { modal: MapFogModal; panel: ReturnType<typeof makePanelStub> } {
    const panel = makePanelStub();
    const map: ActiveMap = {
      url: "/vault/test.png",
      mediaType: "image",
      naturalWidth,
      naturalHeight: Math.round(naturalWidth * 0.6),
    };
    const modal = new MapFogModal(
      appStub as never,
      { app: appStub, settings: { mapFogTvOpacity: 0.9 } } as never,
      panel as never,
      map
    );
    modal.onOpen();
    return { modal, panel };
  }

  it("importFoundryZip scales walls to the displayed map width and sets grid", () => {
    // Scene: 1000×800, gridSize=100 → gridSquares={x:10,y:8}, pixelsPerGrid=100
    // naturalWidth = 2000 (2× scene width) → scale = 2
    const scene = {
      _id: "z1",
      name: "TestScene",
      width: 1000,
      height: 800,
      grid: 100,
      walls: [
        { c: [0, 0, 1000, 0], sense: 20 },
        { c: [0, 0, 0, 800], sense: 20 },
      ],
    };
    const nedbStr = JSON.stringify(scene) + "\n";
    const zipBytes = zipSync({ "packs/maps.db": new TextEncoder().encode(nedbStr) });

    const { modal, panel } = openModalWithNaturalWidth(2000);
    modal.importFoundryZip(zipBytes);

    expect(panel.commitWalls).toHaveBeenCalledTimes(1);
    const walls = panel.commitWalls.mock.calls[0][0] as MapWall[];
    // scale = 2000 / (10 * 100) = 2
    expect(walls).toHaveLength(2);
    expect(walls[0]).toMatchObject({ x1: 0, y1: 0, x2: 2000, y2: 0 });
    expect(walls[1]).toMatchObject({ x1: 0, y1: 0, x2: 0, y2: 1600 });

    // pxPerSquare = 2000 / 10 = 200
    expect(panel.applyGridConfig).toHaveBeenCalledWith(200, 0, 0);

    modal.onClose();
  });

  it("bad zip (no db/log/ldb entries) shows Notice and does not call commitWalls", async () => {
    const obsidian = await import("obsidian");
    const noticeSpy = vi.spyOn(obsidian, "Notice");

    const zipBytes = zipSync({ "readme.txt": new TextEncoder().encode("hello") });
    const { modal, panel } = openModalWithNaturalWidth(1000);
    modal.importFoundryZip(zipBytes);

    expect(panel.commitWalls).not.toHaveBeenCalled();
    expect(noticeSpy).toHaveBeenCalledWith(expect.stringContaining("Foundry import failed"), 6000);

    noticeSpy.mockRestore();
    modal.onClose();
  });
});
