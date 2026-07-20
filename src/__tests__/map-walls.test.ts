// src/__tests__/map-walls.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { blocksSight, visibilityPolygon } from "../map/los";
import { wallsSidecarPath, loadWallsSidecar, saveWallsSidecar, floodRegion, buildBlockedMask, regionToCanvas } from "../map/walls";
import { fogSidecarPath, type FogAdapter } from "../map/fog";
import type { MapWall } from "../map/types";
import { installNapiCanvas, pixelAt } from "../../test/canvas/napi-canvas-shim";

function makeAdapter(files: Record<string, Uint8Array> = {}) {
  const dirs = new Set<string>();
  const adapter: FogAdapter = {
    exists: (p) => Promise.resolve(p in files || dirs.has(p)),
    readBinary: (p) => {
      const bytes = files[p];
      const buf = new ArrayBuffer(bytes.length);
      new Uint8Array(buf).set(bytes);
      return Promise.resolve(buf);
    },
    writeBinary: (p, data) => {
      files[p] = new Uint8Array(data);
      return Promise.resolve();
    },
    mkdir: (p) => {
      dirs.add(p);
      return Promise.resolve();
    },
  };
  return { adapter, files, dirs };
}

describe("blocksSight", () => {
  it("plain wall blocks sight", () => {
    expect(blocksSight({ x1: 0, y1: 0, x2: 10, y2: 0 })).toBe(true);
  });

  it("closed door blocks sight", () => {
    expect(blocksSight({ x1: 0, y1: 0, x2: 10, y2: 0, door: true, open: false })).toBe(true);
  });

  it("open door does not block sight", () => {
    expect(blocksSight({ x1: 0, y1: 0, x2: 10, y2: 0, door: true, open: true })).toBe(false);
  });
});

describe("visibilityPolygon", () => {
  const bounds = { x: 0, y: 0, w: 100, h: 100 };

  it("with no walls from center, all points lie on the bounds edges", () => {
    const pts = visibilityPolygon(50, 50, [], bounds);
    expect(pts.length).toBeGreaterThan(0);
    for (const p of pts) {
      const onEdge =
        Math.abs(p.x - 0) < 0.5 ||
        Math.abs(p.x - 100) < 0.5 ||
        Math.abs(p.y - 0) < 0.5 ||
        Math.abs(p.y - 100) < 0.5;
      expect(onEdge).toBe(true);
    }
  });

  it("with no walls, corners are visible (a point within 1.5 of each corner)", () => {
    const pts = visibilityPolygon(50, 50, [], bounds);
    const corners: [number, number][] = [[0, 0], [100, 0], [100, 100], [0, 100]];
    for (const [cx, cy] of corners) {
      const near = pts.some((p) => Math.abs(p.x - cx) < 1.5 && Math.abs(p.y - cy) < 1.5);
      expect(near).toBe(true);
    }
  });

  it("vertical blocking wall: no point extends beyond x=60+0.5", () => {
    const wall: MapWall = { x1: 60, y1: 0, x2: 60, y2: 100 };
    const pts = visibilityPolygon(50, 50, [wall], bounds);
    expect(pts.length).toBeGreaterThan(0);
    for (const p of pts) {
      expect(p.x).toBeLessThanOrEqual(60.5);
    }
  });

  it("vertical open door: sight passes through (some point has x > 61)", () => {
    const wall: MapWall = { x1: 60, y1: 0, x2: 60, y2: 100, door: true, open: true };
    const pts = visibilityPolygon(50, 50, [wall], bounds);
    const seesThrough = pts.some((p) => p.x > 61);
    expect(seesThrough).toBe(true);
  });
});

describe("wallsSidecarPath", () => {
  it("lives under .dm-screen/walls/ and ends in .json", () => {
    const p = wallsSidecarPath("/vault/maps/dungeon.jpg");
    expect(p).toMatch(/^\.dm-screen\/walls\//);
    expect(p).toMatch(/\.json$/);
  });

  it("shares the same tail+hash core as fogSidecarPath for the same URL", () => {
    const url = "/vault/maps/room.png";
    const fogPath = fogSidecarPath(url);
    const wallsPath = wallsSidecarPath(url);
    // Extract tail+hash portion (everything after the last slash, minus extension)
    const fogCore = fogPath.replace(/^\.dm-screen\/fog\//, "").replace(/\.png$/, "");
    const wallsCore = wallsPath.replace(/^\.dm-screen\/walls\//, "").replace(/\.json$/, "");
    expect(fogCore).toBe(wallsCore);
  });
});

describe("walls sidecar IO", () => {
  it("loadWallsSidecar returns [] when no sidecar exists", async () => {
    const { adapter } = makeAdapter();
    expect(await loadWallsSidecar(adapter, "/vault/maps/x.jpg")).toEqual([]);
  });

  it("save then load round-trips a wall list", async () => {
    const { adapter } = makeAdapter();
    const walls: MapWall[] = [
      { x1: 0, y1: 0, x2: 100, y2: 0 },
      { x1: 50, y1: 50, x2: 50, y2: 150, door: true, open: false },
    ];
    await saveWallsSidecar(adapter, "/vault/maps/x.jpg", walls);
    const loaded = await loadWallsSidecar(adapter, "/vault/maps/x.jpg");
    expect(loaded).toEqual(walls);
  });

  it("corrupted JSON returns []", async () => {
    const { adapter, files } = makeAdapter();
    const path = wallsSidecarPath("/vault/maps/x.jpg");
    files[path] = new TextEncoder().encode("not json at all");
    expect(await loadWallsSidecar(adapter, "/vault/maps/x.jpg")).toEqual([]);
  });

  it("saveWallsSidecar creates the walls folders when missing", async () => {
    const { adapter, dirs } = makeAdapter();
    await saveWallsSidecar(adapter, "/vault/m.png", []);
    expect(dirs.has(".dm-screen")).toBe(true);
    expect(dirs.has(".dm-screen/walls")).toBe(true);
  });
});

describe("floodRegion", () => {
  it("fills from (2,2) only reaching the left side when a full vertical column at x=5 blocks", () => {
    const w = 10;
    const h = 10;
    const blocked = new Uint8Array(w * h);
    // Block the entire column at x=5
    for (let y = 0; y < h; y++) blocked[y * w + 5] = 1;

    const region = floodRegion(blocked, w, h, 2, 2);
    expect(region).not.toBeNull();
    // (8,2) — right side — should NOT be reachable
    expect(region![2 * w + 8]).toBe(0);
    // (2,8) — left side, different row — should be reachable
    expect(region![8 * w + 2]).toBe(1);
  });

  it("returns null when starting on a blocked pixel", () => {
    const w = 5;
    const h = 5;
    const blocked = new Uint8Array(w * h);
    blocked[2 * w + 2] = 1;
    expect(floodRegion(blocked, w, h, 2, 2)).toBeNull();
  });

  it("with no blocks, fills the entire grid", () => {
    const w = 8;
    const h = 8;
    const blocked = new Uint8Array(w * h);
    const region = floodRegion(blocked, w, h, 3, 3);
    expect(region).not.toBeNull();
    for (let i = 0; i < w * h; i++) {
      expect(region![i]).toBe(1);
    }
  });
});

describe("buildBlockedMask", () => {
  let uninstall: () => void;
  beforeEach(() => { uninstall = installNapiCanvas(); });
  afterEach(() => { uninstall(); });

  // Fog-resolution canvas dimensions and a wall filter that admits everything.
  const FW = 200;
  const FH = 200;
  const all = () => true;

  it("a wall splits the canvas so a flood from one side cannot reach the other", () => {
    // Vertical wall at natural x=100 (fogScale 1) spanning the full height.
    const walls: MapWall[] = [{ x1: 100, y1: 0, x2: 100, y2: 200 }];
    const mask = buildBlockedMask(walls, FW, FH, 1, 100, all);
    const region = floodRegion(mask, FW, FH, 40, 100);
    expect(region).not.toBeNull();
    // Left of the wall reached, right of the wall not.
    expect(region![100 * FW + 40]).toBe(1);
    expect(region![100 * FW + 160]).toBe(0);
  });

  it("seals the 1px outer border", () => {
    const mask = buildBlockedMask([], FW, FH, 1, 100, all);
    for (let x = 0; x < FW; x++) {
      expect(mask[x]).toBe(1);
      expect(mask[(FH - 1) * FW + x]).toBe(1);
    }
    for (let y = 0; y < FH; y++) {
      expect(mask[y * FW]).toBe(1);
      expect(mask[y * FW + FW - 1]).toBe(1);
    }
    // Interior stays open.
    expect(mask[100 * FW + 100]).toBe(0);
  });

  it("honors the blocks predicate: an open door blocks when admitted, passes when filtered", () => {
    const openDoor: MapWall = { x1: 100, y1: 0, x2: 100, y2: 200, door: true, open: true };

    // Predicate admits the open door → it splits the canvas.
    const blocking = buildBlockedMask([openDoor], FW, FH, 1, 100, all);
    const split = floodRegion(blocking, FW, FH, 40, 100);
    expect(split![100 * FW + 160]).toBe(0);

    // blocksSight drops the open door → flood crosses the (now-absent) wall.
    const passable = buildBlockedMask([openDoor], FW, FH, 1, 100, blocksSight);
    const merged = floodRegion(passable, FW, FH, 40, 100);
    expect(merged![100 * FW + 160]).toBe(1);
  });
});

describe("regionToCanvas", () => {
  let uninstall: () => void;
  beforeEach(() => { uninstall = installNapiCanvas(); });
  afterEach(() => { uninstall(); });

  it("is opaque black where region is set, transparent elsewhere", () => {
    const w = 20;
    const h = 20;
    const region = new Uint8Array(w * h);
    region[5 * w + 5] = 1;
    const canvas = regionToCanvas(region, w, h);
    expect(pixelAt(canvas, 5, 5)).toEqual([0, 0, 0, 255]);
    expect(pixelAt(canvas, 15, 15)).toEqual([0, 0, 0, 0]);
  });
});
