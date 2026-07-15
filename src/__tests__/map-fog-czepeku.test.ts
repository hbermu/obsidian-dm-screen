import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fogCanvasSize, fogSidecarPath, gridCellRectAt } from "../map/fog";
import { blocksSight, visibilityPolygon, type Point } from "../map/los";
import { floodRegion, wallsSidecarPath } from "../map/walls";
import type { MapWall } from "../map/types";

// Real wall geometry extracted from the Czepeku "Candle Workshop" FoundryVTT
// module (scene 01, geometry only — no artwork). Exercises the fog pipeline
// against production-shaped data: 101 walls, 15 doors, 140 px/square.
interface CzepekuFixture {
  sceneWidth: number;
  sceneHeight: number;
  gridSize: number;
  walls: MapWall[];
}

const fixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "czepeku-candle-workshop-walls.json"), "utf-8")
) as CzepekuFixture;

const { sceneWidth, sceneHeight, gridSize, walls } = fixture;
const bounds = { x: 0, y: 0, w: sceneWidth, h: sceneHeight };

function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function rasterizeWalls(scale: number, thickness: number): { blocked: Uint8Array; w: number; h: number } {
  const w = Math.ceil(sceneWidth * scale);
  const h = Math.ceil(sceneHeight * scale);
  const blocked = new Uint8Array(w * h);
  const stamp = (x: number, y: number) => {
    for (let dy = -thickness; dy <= thickness; dy++) {
      for (let dx = -thickness; dx <= thickness; dx++) {
        const px = Math.round(x) + dx;
        const py = Math.round(y) + dy;
        if (px >= 0 && py >= 0 && px < w && py < h) blocked[py * w + px] = 1;
      }
    }
  };
  for (const wall of walls.filter(blocksSight)) {
    const x1 = wall.x1 * scale;
    const y1 = wall.y1 * scale;
    const x2 = wall.x2 * scale;
    const y2 = wall.y2 * scale;
    const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1)));
    for (let s = 0; s <= steps; s++) {
      stamp(x1 + ((x2 - x1) * s) / steps, y1 + ((y2 - y1) * s) / steps);
    }
  }
  for (let x = 0; x < w; x++) {
    blocked[x] = 1;
    blocked[(h - 1) * w + x] = 1;
  }
  for (let y = 0; y < h; y++) {
    blocked[y * w] = 1;
    blocked[y * w + w - 1] = 1;
  }
  return { blocked, w, h };
}

describe("czepeku fixture sanity", () => {
  it("carries the real scene shape: 101 walls, 15 closed doors, 140 px/square", () => {
    expect(walls).toHaveLength(101);
    const doors = walls.filter((w) => w.door);
    expect(doors).toHaveLength(15);
    expect(doors.every((d) => !d.open)).toBe(true);
    expect(gridSize).toBe(140);
    expect(sceneWidth).toBe(4200);
    expect(sceneHeight).toBe(5040);
  });

  it("every wall lies within the scene bounds", () => {
    for (const w of walls) {
      for (const [x, y] of [
        [w.x1, w.y1],
        [w.x2, w.y2],
      ]) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(sceneWidth);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(sceneHeight);
      }
    }
  });
});

describe("fog pipeline at real Czepeku dimensions", () => {
  it("fogCanvasSize keeps the 4200×5040 aspect at 1024 wide", () => {
    expect(fogCanvasSize(sceneWidth, sceneHeight)).toEqual({ width: 1024, height: 1229 });
  });

  it("gridCellRectAt snaps to the module's 140px grid", () => {
    const cfg = { pxPerSquare: gridSize, gridOffsetX: 0, gridOffsetY: 0 };
    expect(gridCellRectAt(4199, 5039, cfg)).toEqual({ x: 4060, y: 4900, w: 140, h: 140 });
    expect(gridCellRectAt(0, 0, cfg)).toEqual({ x: 0, y: 0, w: 140, h: 140 });
  });

  it("sidecar paths stay deterministic for an NFS-style vault path with spaces", () => {
    const url = "/vault/TTRPG_Media/czepeku/fantasy/battlemaps/Candle%20Workshop/Gridded/Candle%20Workshop%20Original%20Night.webp";
    expect(fogSidecarPath(url)).toBe(fogSidecarPath(url));
    expect(fogSidecarPath(url)).toMatch(/^\.dm-screen\/fog\/[A-Za-z0-9._-]+\.png$/);
    expect(wallsSidecarPath(url)).toMatch(/^\.dm-screen\/walls\/[A-Za-z0-9._-]+\.json$/);
  });
});

describe("line of sight against the real wall set", () => {
  // Workshop interior: the centre of the scene sits inside the building.
  const vision = { x: sceneWidth / 2, y: sceneHeight / 2 };

  it("produces a valid polygon fully inside the scene bounds", () => {
    const poly = visibilityPolygon(vision.x, vision.y, walls, bounds);
    expect(poly.length).toBeGreaterThanOrEqual(3);
    for (const p of poly) {
      expect(p.x).toBeGreaterThanOrEqual(-1);
      expect(p.x).toBeLessThanOrEqual(sceneWidth + 1);
      expect(p.y).toBeGreaterThanOrEqual(-1);
      expect(p.y).toBeLessThanOrEqual(sceneHeight + 1);
    }
  });

  it("walls actually occlude: the polygon covers less area than the empty-map polygon", () => {
    const area = (poly: Point[]) => {
      let a = 0;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
      }
      return Math.abs(a / 2);
    };
    const withWalls = area(visibilityPolygon(vision.x, vision.y, walls, bounds));
    const noWalls = area(visibilityPolygon(vision.x, vision.y, [], bounds));
    expect(noWalls).toBeGreaterThan(0);
    expect(withWalls).toBeLessThan(noWalls * 0.9);
  });

  it("a point immediately behind a blocking wall is not visible; a point beside the vision is", () => {
    // Pick the longest non-door wall and probe both sides of its midpoint.
    const solid = walls.filter((w) => !w.door);
    const longest = solid.reduce((a, b) =>
      Math.hypot(a.x2 - a.x1, a.y2 - a.y1) >= Math.hypot(b.x2 - b.x1, b.y2 - b.y1) ? a : b
    );
    const mid = { x: (longest.x1 + longest.x2) / 2, y: (longest.y1 + longest.y2) / 2 };
    const len = Math.hypot(longest.x2 - longest.x1, longest.y2 - longest.y1);
    const nx = -(longest.y2 - longest.y1) / len;
    const ny = (longest.x2 - longest.x1) / len;
    const eyes = { x: mid.x + nx * 50, y: mid.y + ny * 50 };
    const hidden = { x: mid.x - nx * 50, y: mid.y - ny * 50 };
    const near = { x: eyes.x + nx * 10, y: eyes.y + ny * 10 };

    const poly = visibilityPolygon(eyes.x, eyes.y, walls, bounds);
    expect(pointInPolygon(near, poly)).toBe(true);
    expect(pointInPolygon(hidden, poly)).toBe(false);
  });

  it("opening every door strictly grows the visible area", () => {
    const area = (poly: Point[]) => {
      let a = 0;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
      }
      return Math.abs(a / 2);
    };
    const door = walls.find((w) => w.door)!;
    const mid = { x: (door.x1 + door.x2) / 2, y: (door.y1 + door.y2) / 2 };
    const len = Math.hypot(door.x2 - door.x1, door.y2 - door.y1);
    const nx = -(door.y2 - door.y1) / len;
    const ny = (door.x2 - door.x1) / len;
    const eyes = { x: mid.x + nx * 60, y: mid.y + ny * 60 };

    const closed = area(visibilityPolygon(eyes.x, eyes.y, walls, bounds));
    const opened = walls.map((w) => (w.door ? { ...w, open: true } : w));
    const open = area(visibilityPolygon(eyes.x, eyes.y, opened, bounds));
    expect(open).toBeGreaterThan(closed);
  });

  it("stays within budget: 5 visions × 101 walls under 250ms", () => {
    const start = performance.now();
    for (let i = 0; i < 5; i++) {
      visibilityPolygon(sceneWidth * (0.2 + i * 0.15), sceneHeight * 0.5, walls, bounds);
    }
    expect(performance.now() - start).toBeLessThan(250);
  });
});

describe("room flood fill against the real wall set", () => {
  // Rasterized at 1/10 scale (420×504) with a 2px stamp — proportionally the
  // same thickness the Room tool uses at fog resolution.
  const { blocked, w, h } = rasterizeWalls(0.1, 2);

  it("filling from inside the workshop stays bounded (a room, not the whole map)", () => {
    const free = blocked.reduce((acc, v) => acc + (v ? 0 : 1), 0);
    const region = floodRegion(blocked, w, h, Math.round((sceneWidth / 2) * 0.1), Math.round((sceneHeight / 2) * 0.1));
    expect(region).not.toBeNull();
    const size = region!.reduce((acc: number, v) => acc + v, 0);
    expect(size).toBeGreaterThan(50);
    expect(size).toBeLessThan(free * 0.9);
  });

  it("filling from a wall pixel reports null (inside a wall)", () => {
    const solid = walls.find((wl) => !wl.door)!;
    const sx = Math.round(((solid.x1 + solid.x2) / 2) * 0.1);
    const sy = Math.round(((solid.y1 + solid.y2) / 2) * 0.1);
    expect(floodRegion(blocked, w, h, sx, sy)).toBeNull();
  });
});
