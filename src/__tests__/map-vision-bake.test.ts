import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installNapiCanvas, pixelAt } from "../../test/canvas/napi-canvas-shim";

let uninstall: () => void;

// Shared Obsidian polyfills
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

beforeEach(() => {
  polyfillHTMLElement();
  uninstall = installNapiCanvas();
});

afterEach(() => {
  uninstall();
  vi.restoreAllMocks();
});

function makePanel() {
  const broadcasts: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const adapter = {
    exists: () => Promise.resolve(false),
    readBinary: () => Promise.resolve(new ArrayBuffer(0)),
    writeBinary: () => Promise.resolve(),
    mkdir: () => Promise.resolve(),
    getResourcePath: () => null as null,
  };
  const plugin = {
    settings: {
      mapConfigs: {} as Record<string, unknown>,
      mapDefaultPxPerSquare: 100,
      mapScreenProfiles: {},
      tvWidth: 1920,
      tvHeight: 1080,
      hydrusDefaultLoop: true,
      hydrusDefaultMuted: true,
      mapFogTvOpacity: 0.9,
    },
    server: { broadcast: (msg: { type: string; payload: Record<string, unknown> }) => broadcasts.push(msg) },
    saveSettings: () => Promise.resolve(),
    broadcastMapCalibration: () => {},
    app: { vault: { adapter } },
  };
  const host = { render: vi.fn() };
  return { plugin, host, broadcasts };
}

// Build a fully-black 1024×1024 fog PNG data URL using a shimmed canvas element
// (goes through document.createElement so it's wired to napi).
function buildBlackFogDataUrl(): string {
  const el = document.createElement("canvas") as HTMLCanvasElement;
  el.width = 1024;
  el.height = 1024;
  const ctx = el.getContext("2d")!;
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, 1024, 1024);
  return el.toDataURL("image/png");
}

// Sample a pixel from a shimmed canvas element that has had a fog data URL
// drawn into it. We create a throwaway canvas, draw the data URL via FakeImage,
// then pixelAt reads from the napi backing store.
async function sampleFogPixel(fogDataUrl: string, x: number, y: number): Promise<[number, number, number, number]> {
  const { loadImage, createCanvas } = await import("@napi-rs/canvas");
  const b64 = fogDataUrl.slice(fogDataUrl.indexOf(",") + 1);
  const napiImg = await loadImage(Buffer.from(b64, "base64"));
  const nc = createCanvas(1024, 1024);
  const ctx = nc.getContext("2d");
  ctx.drawImage(napiImg, 0, 0);
  const d = ctx.getImageData(x, y, 1, 1).data;
  return [d[0], d[1], d[2], d[3]] as [number, number, number, number];
}

describe("bakeVisions — real canvas pixel assertions", () => {
  it("erases a circular vision hole in fully-covered fog", async () => {
    const { MapScreenPanel } = await import("../views/MapScreenPanel");
    const { plugin, host, broadcasts } = makePanel();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const panel = new MapScreenPanel(plugin as any, host as any);

    // 200×200 map; scale=1024/200=5.12; ftToPx=(100/5)*5.12=102.4; r=30*102.4=3072 >> 512
    // → entire canvas erased (transparent everywhere)
    const mapW = 200;
    const mapH = 200;
    panel.fogDataUrl = buildBlackFogDataUrl();
    const map = { url: "/vault/test.png", mediaType: "image" as const, naturalWidth: mapW, naturalHeight: mapH };
    panel.activeMap = map;
    panel.visions = [{ id: "v1", shape: "circle" as const, x: mapW / 2, y: mapH / 2, sizeFt: 30, featherFt: 0 }];

    await panel.bakeVisions(map);

    expect(panel.visions).toEqual([]);
    expect(broadcasts.some((b) => b.type === "map-vision")).toBe(true);
    expect(panel.fogDataUrl).toBeTruthy();
    expect(panel.fogDataUrl).toMatch(/^data:image\/png;base64,/);

    // Center should be transparent (entire canvas erased by huge radius)
    const center = await sampleFogPixel(panel.fogDataUrl!, 512, 512);
    expect(center[3]).toBeLessThan(50);
  });

  it("erases a smaller vision hole — center transparent, far corner opaque", async () => {
    const { MapScreenPanel } = await import("../views/MapScreenPanel");
    const { plugin, host } = makePanel();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const panel = new MapScreenPanel(plugin as any, host as any);

    // 1000×1000 map; scale=1.024; ftToPx=20.48; r=5*20.48≈102 fog px
    // Center=512; corner at (2,2) is ~721px away → well outside the circle → opaque
    const mapW = 1000;
    const mapH = 1000;
    panel.fogDataUrl = buildBlackFogDataUrl();
    const map = { url: "/vault/test2.png", mediaType: "image" as const, naturalWidth: mapW, naturalHeight: mapH };
    panel.activeMap = map;
    panel.visions = [{ id: "v1", shape: "circle" as const, x: mapW / 2, y: mapH / 2, sizeFt: 5, featherFt: 0 }];

    await panel.bakeVisions(map);
    expect(panel.fogDataUrl).toMatch(/^data:image\/png;base64,/);

    // Center = transparent (inside vision)
    const center = await sampleFogPixel(panel.fogDataUrl!, 512, 512);
    expect(center[3]).toBeLessThan(50);

    // Top-left corner = opaque (outside vision)
    const corner = await sampleFogPixel(panel.fogDataUrl!, 2, 2);
    expect(corner[3]).toBeGreaterThan(200);
  });

  it("feather ring has intermediate alpha", async () => {
    const { MapScreenPanel } = await import("../views/MapScreenPanel");
    const { plugin, host } = makePanel();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const panel = new MapScreenPanel(plugin as any, host as any);

    // 1000×1000; scale=1.024; ftToPx=20.48
    // r=5*20.48=102.4px; feather=5*20.48=102.4px; outer=204.8px
    // At distance 153px from center (between r=102 and outer=205) → feather zone
    const mapW = 1000;
    const mapH = 1000;
    panel.fogDataUrl = buildBlackFogDataUrl();
    const map = { url: "/vault/test3.png", mediaType: "image" as const, naturalWidth: mapW, naturalHeight: mapH };
    panel.activeMap = map;
    panel.visions = [{ id: "v1", shape: "circle" as const, x: mapW / 2, y: mapH / 2, sizeFt: 5, featherFt: 5 }];

    await panel.bakeVisions(map);
    expect(panel.fogDataUrl).toMatch(/^data:image\/png;base64,/);

    // Inside radius → transparent
    const inner = await sampleFogPixel(panel.fogDataUrl!, 512, 512);
    expect(inner[3]).toBeLessThan(50);

    // Far corner → fully opaque
    const corner = await sampleFogPixel(panel.fogDataUrl!, 10, 10);
    expect(corner[3]).toBeGreaterThan(200);

    // Feather zone at 153px from center → partially erased (not fully opaque)
    const feather = await sampleFogPixel(panel.fogDataUrl!, 512 + 153, 512);
    expect(feather[3]).toBeLessThan(255);
  });

  it("wall-clipped bake: point behind wall stays opaque, visible side transparent", async () => {
    const { MapScreenPanel } = await import("../views/MapScreenPanel");
    const { plugin, host } = makePanel();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const panel = new MapScreenPanel(plugin as any, host as any);

    const mapW = 1000;
    const mapH = 1000;
    panel.fogDataUrl = buildBlackFogDataUrl();
    const map = { url: "/vault/test4.png", mediaType: "image" as const, naturalWidth: mapW, naturalHeight: mapH };
    panel.activeMap = map;

    // Vertical wall to the right of center, blocks eastward sight
    panel.walls = [{ x1: mapW / 2 + 50, y1: 0, x2: mapW / 2 + 50, y2: mapH }];
    // Large enough vision (50ft) to reach far right but blocked by wall
    panel.visions = [{ id: "v1", shape: "circle" as const, x: mapW / 2, y: mapH / 2, sizeFt: 50, featherFt: 0 }];

    await panel.bakeVisions(map);
    expect(panel.fogDataUrl).toMatch(/^data:image\/png;base64,/);

    // Far right (fog x=900, map x≈879): well beyond the wall → should remain opaque
    const behindWall = await sampleFogPixel(panel.fogDataUrl!, 900, 512);
    expect(behindWall[3]).toBeGreaterThan(200);

    // Left of center (fog x=300, map x≈293): visible to vision → transparent
    const visible = await sampleFogPixel(panel.fogDataUrl!, 300, 512);
    expect(visible[3]).toBeLessThan(50);
  });
});

describe("shim diagnostics", () => {
  it("FakeImage loads black fog and draws it correctly into wired canvas", async () => {
    const blackUrl = buildBlackFogDataUrl();
    expect(blackUrl).toMatch(/^data:image\/png;base64,/);

    // Verify the data URL decodes to a valid PNG
    const { loadImage, createCanvas } = await import("@napi-rs/canvas");
    const b64 = blackUrl.slice(blackUrl.indexOf(",") + 1);
    const napiImg = await loadImage(Buffer.from(b64, "base64"));
    expect(napiImg.width).toBe(1024);
    expect(napiImg.height).toBe(1024);

    // Now test drawing through FakeImage into a shimmed canvas
    const el = document.createElement("canvas") as HTMLCanvasElement;
    el.width = 1024;
    el.height = 1024;
    const ctx = el.getContext("2d")!;

    // Draw via FakeImage (same path as bakeVisions)
    await new Promise<void>((resolve) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const img = new (globalThis as any).Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, 1024, 1024);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = blackUrl;
    });

    // Corner should be black (alpha=255)
    const corner = pixelAt(el, 2, 2);
    expect(corner[3]).toBe(255);
    expect(corner[0]).toBe(0); // black RGB

    // Now erase center
    const nc = createCanvas(1024, 1024);
    const checkCtx = nc.getContext("2d");
    const resultImg = await loadImage(Buffer.from(el.toDataURL("image/png").slice(el.toDataURL("image/png").indexOf(",") + 1), "base64"));
    checkCtx.drawImage(resultImg, 0, 0);
    const cornerSample = checkCtx.getImageData(2, 2, 1, 1).data;
    expect(cornerSample[3]).toBeGreaterThan(200);
  });
});

describe("bakeVisions — canvas element pixel assertions (via pixelAt)", () => {
  it("wired canvas toDataURL roundtrips black fill", () => {
    const el = document.createElement("canvas") as HTMLCanvasElement;
    el.width = 100;
    el.height = 100;
    const ctx = el.getContext("2d")!;
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, 100, 100);
    // pixelAt reads from napi backing store directly
    const px = pixelAt(el, 50, 50);
    expect(px[3]).toBe(255);
    expect(px[0]).toBe(0); // black
  });

  it("wired canvas destination-out erases pixels", () => {
    const el = document.createElement("canvas") as HTMLCanvasElement;
    el.width = 100;
    el.height = 100;
    const ctx = el.getContext("2d")!;
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, 100, 100);
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgba(0,0,0,1)";
    ctx.beginPath();
    ctx.arc(50, 50, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";

    // Inside circle → transparent
    const inside = pixelAt(el, 50, 50);
    expect(inside[3]).toBe(0);

    // Outside circle → opaque
    const outside = pixelAt(el, 2, 2);
    expect(outside[3]).toBe(255);
  });
});
