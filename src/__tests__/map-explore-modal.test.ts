import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installNapiCanvas } from "../../test/canvas/napi-canvas-shim";
import { MapExploreModal } from "../views/MapExploreModal";
import { fogCanvasSize } from "../map/fog";
import type { ActiveMap } from "../views/MapScreenPanel";
import type { MapAoe, MapVision, MapWall } from "../map/types";

// Map dimensions: 1000×750 natural pixels; fog canvas: 1024×768
const MAP_W = 1000;
const MAP_H = 750;
const { width: FOG_W, height: FOG_H } = fogCanvasSize(MAP_W, MAP_H);

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
  if (!HTMLElement.prototype.toggleClass) {
    (HTMLElement.prototype as unknown as Record<string, unknown>).toggleClass = function (cls: string, value: boolean) {
      this.classList.toggle(cls, value);
    };
  }
}

// ---- Stubs ----
const appStub = { vault: { adapter: { getResourcePath: () => null as null } } };

function makePanelStub(
  walls: MapWall[] = [],
  opts: { aoes?: MapAoe[]; visions?: MapVision[]; mode?: "physical" | "fit"; rotation?: 0 | 90 | 180 | 270 } = {}
) {
  const aoes = opts.aoes ?? [];
  const visions = opts.visions ?? [];
  const stub = {
    commitFog: vi.fn().mockResolvedValue(undefined),
    commitWalls: vi.fn().mockResolvedValue(undefined),
    broadcastAoes: vi.fn(),
    broadcastVisions: vi.fn(),
    openAddAoeMenu: vi.fn(),
    removeAoe: vi.fn((id: string) => {
      stub.aoes = stub.aoes.filter((a) => a.id !== id);
    }),
    refreshPanel: vi.fn(),
    playerViewportMapSize: vi.fn(() => (opts.mode === "physical" ? { w: 400, h: 300 } : null)),
    applyExplorePan: vi.fn((x: number, y: number) => {
      stub.state.panX = x;
      stub.state.panY = y;
      let changed = false;
      for (const v of stub.visions) {
        if (v.followsView) { v.x = x; v.y = y; changed = true; }
      }
      return changed;
    }),
    renderAoeSection: vi.fn(),
    renderVisionSection: vi.fn(),
    viewLocked: false,
    fogDataUrl: null as string | null,
    walls,
    aoes,
    visions,
    state: {
      pxPerSquare: 100,
      gridOffsetX: 0,
      gridOffsetY: 0,
      mode: opts.mode ?? "fit",
      panX: MAP_W / 2,
      panY: MAP_H / 2,
      rotation: opts.rotation ?? 0,
    },
  };
  return stub;
}

const mapStub: ActiveMap = {
  url: "/vault/test.png",
  mediaType: "image",
  naturalWidth: MAP_W,
  naturalHeight: MAP_H,
};

// ---- Helpers ----
function openModal(
  panelStub: ReturnType<typeof makePanelStub>,
  // Overlay AABB (client rect). Default is 1:1 with the fog canvas so an
  // unrotated view maps clientX/Y === fog coords.
  rect: { width: number; height: number } = { width: FOG_W, height: FOG_H }
): {
  modal: MapExploreModal;
  overlay: HTMLCanvasElement;
  markers: HTMLElement;
  contentEl: HTMLElement;
} {
  const modal = new MapExploreModal(
    appStub as never,
    { app: appStub, settings: { mapFogTvOpacity: 0.9 } } as never,
    panelStub as never,
    mapStub
  );
  modal.onOpen();

  const stage = modal.contentEl.querySelector(".dm-explore-stage") as HTMLElement;
  const overlay = stage.querySelector(".dm-explore-overlay") as HTMLCanvasElement;

  overlay.getBoundingClientRect = () => ({
    left: 0, top: 0,
    width: rect.width, height: rect.height,
    right: rect.width, bottom: rect.height,
    x: 0, y: 0,
    toJSON: () => ({}),
  });

  const markers = stage.querySelector(".dm-explore-markers") as HTMLElement;
  return { modal, overlay, markers, contentEl: modal.contentEl };
}

function fireDocMouse(type: "mousemove" | "mouseup", x: number, y: number) {
  document.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
}

function findBtn(contentEl: HTMLElement, text: string): HTMLButtonElement {
  const btn = Array.from(contentEl.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === text
  ) as HTMLButtonElement | undefined;
  if (!btn) throw new Error(`Button "${text}" not found`);
  return btn;
}

function coverAll(contentEl: HTMLElement) {
  findBtn(contentEl, "Cover All").dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function fireMousedown(overlay: HTMLElement, x: number, y: number, button = 0) {
  overlay.dispatchEvent(new MouseEvent("mousedown", { clientX: x, clientY: y, button, bubbles: true }));
}

function fireMousemove(overlay: HTMLElement, x: number, y: number) {
  overlay.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y, bubbles: true }));
}

async function decodeLastFog(commitFog: ReturnType<typeof vi.fn>) {
  const dataUrl = commitFog.mock.calls[commitFog.mock.calls.length - 1][0] as string;
  const { loadImage, createCanvas } = await import("@napi-rs/canvas");
  const img = await loadImage(Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
  const nc = createCanvas(FOG_W, FOG_H);
  const ctx = nc.getContext("2d");
  ctx.drawImage(img, 0, 0);
  return ctx;
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

describe("MapExploreModal — room fog auto-toggle", () => {
  // Two rooms split by a vertical wall at natural x=500 (fog x≈512).
  const twoRoomWalls = (): MapWall[] => [
    { x1: 500, y1: 0, x2: 500, y2: MAP_H },
  ];

  it("click a covered room reveals only that room; the room across the wall stays opaque", async () => {
    const panel = makePanelStub(twoRoomWalls());
    const { modal, overlay, contentEl } = openModal(panel);
    coverAll(contentEl);
    panel.commitFog.mockClear();

    // Click Room A center (fog x=256)
    fireMousedown(overlay, 256, 384);

    await vi.waitFor(() => expect(panel.commitFog).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/png;base64,/)));
    const ctx = await decodeLastFog(panel.commitFog);

    // Room A becomes transparent
    expect(ctx.getImageData(200, 384, 1, 1).data[3]).toBeLessThan(50);
    // Room B (across the wall) stays opaque
    expect(ctx.getImageData(800, 384, 1, 1).data[3]).toBeGreaterThan(200);

    modal.onClose();
  });

  it("clicking the same room twice covers it again (auto-toggle round-trip)", async () => {
    const panel = makePanelStub(twoRoomWalls());
    const { modal, overlay, contentEl } = openModal(panel);
    coverAll(contentEl);
    panel.commitFog.mockClear();

    // First click reveals Room A
    fireMousedown(overlay, 256, 384);
    await vi.waitFor(() => expect(panel.commitFog).toHaveBeenCalledTimes(1));
    let ctx = await decodeLastFog(panel.commitFog);
    expect(ctx.getImageData(200, 384, 1, 1).data[3]).toBeLessThan(50);

    // Second click on the now-revealed room covers it again
    fireMousedown(overlay, 256, 384);
    await vi.waitFor(() => expect(panel.commitFog).toHaveBeenCalledTimes(2));
    ctx = await decodeLastFog(panel.commitFog);
    expect(ctx.getImageData(200, 384, 1, 1).data[3]).toBeGreaterThan(200);

    modal.onClose();
  });

  it("clicking on a wall pixel does not commit fog", async () => {
    const panel = makePanelStub(twoRoomWalls());
    const { modal, overlay, contentEl } = openModal(panel);
    coverAll(contentEl);
    panel.commitFog.mockClear();

    // fog (512, 384) → natural (500, 375): on the wall
    fireMousedown(overlay, 512, 384);

    await new Promise((r) => setTimeout(r, 20));
    expect(panel.commitFog).not.toHaveBeenCalled();

    modal.onClose();
  });
});

describe("MapExploreModal — doors are always room boundaries", () => {
  it("two rooms joined only by an OPEN door: revealing one leaves the other covered", async () => {
    // Vertical divider with a door gap; the door is OPEN. In the Room edit tool an
    // open door would merge the rooms, but exploration always treats a door as a
    // boundary, so the flood stays inside Room A.
    const walls: MapWall[] = [
      { x1: 500, y1: 0, x2: 500, y2: 300 },
      { x1: 500, y1: 300, x2: 500, y2: 450, door: true, open: true },
      { x1: 500, y1: 450, x2: 500, y2: MAP_H },
    ];
    const panel = makePanelStub(walls);
    const { modal, overlay, contentEl } = openModal(panel);
    coverAll(contentEl);
    panel.commitFog.mockClear();

    fireMousedown(overlay, 256, 384);

    await vi.waitFor(() => expect(panel.commitFog).toHaveBeenCalled());
    const ctx = await decodeLastFog(panel.commitFog);

    // Room A revealed
    expect(ctx.getImageData(200, 384, 1, 1).data[3]).toBeLessThan(50);
    // Room B still covered despite the open door
    expect(ctx.getImageData(800, 384, 1, 1).data[3]).toBeGreaterThan(200);

    modal.onClose();
  });
});

describe("MapExploreModal — door marker toggle", () => {
  it("clicking a door marker flips its open flag without mutating the original wall", () => {
    const door: MapWall = { x1: 400, y1: 300, x2: 600, y2: 300, door: true, open: false };
    const panel = makePanelStub([door]);
    const { modal, overlay } = openModal(panel);

    // Door midpoint natural (500, 300) → fog (512, 307)
    fireMousedown(overlay, 512, 307);

    expect(panel.commitWalls).toHaveBeenCalledTimes(1);
    const walls = panel.commitWalls.mock.calls[0][0] as MapWall[];
    expect(walls[0].open).toBe(true);
    // Original object must not be mutated
    expect(door.open).toBe(false);
    // No fog commit for a door toggle
    expect(panel.commitFog).not.toHaveBeenCalled();

    modal.onClose();
  });
});

describe("MapExploreModal — listener cleanup", () => {
  it("Exit closes the modal and no commit fires after a post-close mousemove", async () => {
    const panel = makePanelStub([{ x1: 500, y1: 0, x2: 500, y2: MAP_H }]);
    const { modal, overlay, contentEl } = openModal(panel);
    coverAll(contentEl);
    panel.commitFog.mockClear();

    modal.onClose();

    // A synthetic mousemove on the overlay after close must be inert.
    fireMousemove(overlay, 256, 384);

    await new Promise((r) => setTimeout(r, 20));
    expect(panel.commitFog).not.toHaveBeenCalled();
    expect(panel.commitWalls).not.toHaveBeenCalled();
  });
});

describe("MapExploreModal — rotated view", () => {
  it("a click under a 90° view maps to the correct room via toFog", async () => {
    // Two rooms split by a vertical wall at natural x=500 (fog x≈512).
    const panel = makePanelStub([{ x1: 500, y1: 0, x2: 500, y2: MAP_H }], { rotation: 90 });
    // Rotated 90°, the unrotated 1024×768 overlay's AABB is 768×1024.
    const { modal, overlay, contentEl } = openModal(panel, { width: FOG_H, height: FOG_W });
    coverAll(contentEl);
    panel.commitFog.mockClear();

    // Client (384, 256) un-rotates (invRotation 270) to fog Room A centre (256, 384).
    fireMousedown(overlay, 384, 256);

    await vi.waitFor(() => expect(panel.commitFog).toHaveBeenCalled());
    const ctx = await decodeLastFog(panel.commitFog);
    // Room A revealed, Room B across the wall stays covered.
    expect(ctx.getImageData(200, 384, 1, 1).data[3]).toBeLessThan(50);
    expect(ctx.getImageData(800, 384, 1, 1).data[3]).toBeGreaterThan(200);

    modal.onClose();
  });
});

describe("MapExploreModal — players' viewport rectangle", () => {
  it("renders a draggable viewport rect only in physical mode", () => {
    const fit = openModal(makePanelStub([], { mode: "fit" }));
    expect(fit.markers.querySelector(".dm-map-viewport-rect")).toBeNull();
    fit.modal.onClose();

    const phys = openModal(makePanelStub([], { mode: "physical" }));
    expect(phys.markers.querySelector(".dm-map-viewport-rect")).not.toBeNull();
    phys.modal.onClose();
  });

  it("dragging the rect moves the players' view via applyExplorePan (throttled, then immediate on release)", () => {
    const panel = makePanelStub([], { mode: "physical" });
    const { modal, markers } = openModal(panel);
    const rect = markers.querySelector(".dm-map-viewport-rect") as HTMLElement;

    // Overlay rect is 1:1 with fog px (1024×768); deltaToMap divides by that and
    // scales to natural (1000×750). Drag +102.4 fog px → +100 natural px.
    rect.dispatchEvent(new MouseEvent("mousedown", { clientX: 500, clientY: 400, button: 0, bubbles: true }));
    fireDocMouse("mousemove", 500 + 102.4, 400);
    expect(panel.applyExplorePan).toHaveBeenLastCalledWith(MAP_W / 2 + 100, MAP_H / 2, false);

    fireDocMouse("mouseup", 500 + 102.4, 400);
    expect(panel.applyExplorePan).toHaveBeenLastCalledWith(MAP_W / 2 + 100, MAP_H / 2, true);

    modal.onClose();
  });
});

describe("MapExploreModal — AoE and vision markers", () => {
  const anAoe = (): MapAoe => ({
    id: "aoe-1", shape: "circle", sizeFt: 20, widthFt: 5, color: "#ff4400", opacity: 0.3, rotation: 0,
    x: MAP_W / 2, y: MAP_H / 2,
  });

  it("dragging an AoE dot moves it and broadcasts (throttled + immediate on release)", () => {
    const aoe = anAoe();
    const panel = makePanelStub([], { aoes: [aoe] });
    const { modal, markers } = openModal(panel);
    const dot = markers.querySelector(".dm-map-aoe-dot") as HTMLElement;

    dot.dispatchEvent(new MouseEvent("mousedown", { clientX: 0, clientY: 0, button: 0, bubbles: true }));
    fireDocMouse("mousemove", 102.4, 0); // +100 natural px in x
    expect(aoe.x).toBeCloseTo(MAP_W / 2 + 100, 1);
    expect(panel.broadcastAoes).toHaveBeenCalledWith();

    fireDocMouse("mouseup", 102.4, 0);
    expect(panel.broadcastAoes).toHaveBeenLastCalledWith(true);

    modal.onClose();
  });

  it("right-clicking an AoE dot removes it via panel.removeAoe", () => {
    const panel = makePanelStub([], { aoes: [anAoe()] });
    const { modal, markers } = openModal(panel);
    const dot = markers.querySelector(".dm-map-aoe-dot") as HTMLElement;

    dot.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(panel.removeAoe).toHaveBeenCalledWith("aoe-1");

    modal.onClose();
  });

  it("dragging a vision dot moves it and broadcasts", () => {
    const vision: MapVision = { id: "v-1", shape: "circle", x: MAP_W / 2, y: MAP_H / 2, sizeFt: 30, featherFt: 5 };
    const panel = makePanelStub([], { visions: [vision] });
    const { modal, markers } = openModal(panel);
    const dot = markers.querySelector(".dm-map-vision-dot") as HTMLElement;

    dot.dispatchEvent(new MouseEvent("mousedown", { clientX: 0, clientY: 0, button: 0, bubbles: true }));
    fireDocMouse("mousemove", 0, 102.4); // +100 natural px in y (768 fog h → 750 natural)
    expect(vision.y).toBeCloseTo(MAP_H / 2 + 100, 0);
    expect(panel.broadcastVisions).toHaveBeenCalledWith();

    fireDocMouse("mouseup", 0, 102.4);
    expect(panel.broadcastVisions).toHaveBeenLastCalledWith(true);

    modal.onClose();
  });

  it("renders the AoE + Vision control sidebar by reusing the panel sections", () => {
    const panel = makePanelStub();
    const { modal, contentEl } = openModal(panel);
    const sidebar = contentEl.querySelector(".dm-explore-sidebar") as HTMLElement;
    expect(sidebar).not.toBeNull();
    expect(panel.renderAoeSection).toHaveBeenCalledWith(sidebar, mapStub, expect.any(Function));
    expect(panel.renderVisionSection).toHaveBeenCalledWith(sidebar, mapStub, expect.any(Function));
    modal.onClose();
  });

  it("closing the modal refreshes the DM panel", () => {
    const panel = makePanelStub();
    const { modal } = openModal(panel);
    modal.onClose();
    expect(panel.refreshPanel).toHaveBeenCalled();
  });
});

describe("MapExploreModal — view lock", () => {
  it("the lock button toggles panel.viewLocked and disables the viewport rect", () => {
    const panel = makePanelStub([], { mode: "physical" });
    const { modal, markers, contentEl } = openModal(panel);
    const lockBtn = contentEl.querySelector(".dm-explore-lock-btn") as HTMLButtonElement;

    // Initially unlocked: rect is draggable (not the locked variant).
    expect(markers.querySelector(".dm-map-viewport-rect.dm-explore-rect-locked")).toBeNull();

    lockBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(panel.viewLocked).toBe(true);
    // Markers re-rendered: the rect is now the passive locked variant.
    expect(markers.querySelector(".dm-map-viewport-rect.dm-explore-rect-locked")).not.toBeNull();

    modal.onClose();
  });

  it("a locked view ignores viewport-rect drags", () => {
    const panel = makePanelStub([], { mode: "physical" });
    panel.viewLocked = true;
    const { modal, markers } = openModal(panel);
    const rect = markers.querySelector(".dm-map-viewport-rect") as HTMLElement;

    rect.dispatchEvent(new MouseEvent("mousedown", { clientX: 500, clientY: 400, button: 0, bubbles: true }));
    fireDocMouse("mousemove", 700, 400);
    expect(panel.applyExplorePan).not.toHaveBeenCalled();

    modal.onClose();
  });
});

describe("MapExploreModal — Shift focus (door/room without locking)", () => {
  function fireKey(type: "keydown" | "keyup", key: string) {
    document.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true }));
  }

  it("holding Shift makes the markers layer pointer-transparent; releasing restores it", () => {
    const panel = makePanelStub([], { mode: "physical" });
    const { modal, markers } = openModal(panel);
    expect(markers.classList.contains("dm-explore-focus")).toBe(false);

    fireKey("keydown", "Shift");
    expect(markers.classList.contains("dm-explore-focus")).toBe(true);

    fireKey("keyup", "Shift");
    expect(markers.classList.contains("dm-explore-focus")).toBe(false);

    modal.onClose();
  });

  it("window blur resets the focus (Shift held during alt-tab)", () => {
    const panel = makePanelStub([], { mode: "physical" });
    const { modal, markers } = openModal(panel);
    fireKey("keydown", "Shift");
    expect(markers.classList.contains("dm-explore-focus")).toBe(true);

    window.dispatchEvent(new Event("blur"));
    expect(markers.classList.contains("dm-explore-focus")).toBe(false);

    modal.onClose();
  });

  it("a non-Shift key does not trigger focus", () => {
    const panel = makePanelStub([]);
    const { modal, markers } = openModal(panel);
    fireKey("keydown", "a");
    expect(markers.classList.contains("dm-explore-focus")).toBe(false);
    modal.onClose();
  });

  it("after close, a Shift keydown is inert (listeners removed)", () => {
    const panel = makePanelStub([]);
    const { modal, markers } = openModal(panel);
    modal.onClose();
    fireKey("keydown", "Shift");
    expect(markers.classList.contains("dm-explore-focus")).toBe(false);
  });
});

describe("MapExploreModal — view-bound vision", () => {
  it("dragging the viewport rect drags a view-bound vision along with it", () => {
    const vision: MapVision = {
      id: "v-1", shape: "circle", x: MAP_W / 2, y: MAP_H / 2, sizeFt: 30, featherFt: 5, followsView: true,
    };
    const panel = makePanelStub([], { mode: "physical", visions: [vision] });
    const { modal, markers } = openModal(panel);
    const rect = markers.querySelector(".dm-map-viewport-rect") as HTMLElement;

    rect.dispatchEvent(new MouseEvent("mousedown", { clientX: 500, clientY: 400, button: 0, bubbles: true }));
    fireDocMouse("mousemove", 500 + 102.4, 400); // +100 natural px in x
    // applyExplorePan (stub) moved the bound vision onto the new view centre.
    expect(vision.x).toBeCloseTo(MAP_W / 2 + 100, 1);
    expect(vision.y).toBeCloseTo(MAP_H / 2, 1);

    fireDocMouse("mouseup", 500 + 102.4, 400);
    modal.onClose();
  });
});
