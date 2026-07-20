import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseUvttWalls } from "../map/uvtt";
import type { MapWall } from "../map/types";

interface WallsFixture {
  walls: MapWall[];
  sceneWidth: number;
  sceneHeight: number;
  gridSize: number;
}

const rawFixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "dd2vtt-felderhouse-raw.json"), "utf-8")
) as unknown;

const wallsFixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "dd2vtt-felderhouse-walls.json"), "utf-8")
) as WallsFixture;

describe("parseUvttWalls — cross-validation against fixture", () => {
  it("produces 173 walls matching dd2vtt-felderhouse-walls.json exactly at scale 1", () => {
    const result = parseUvttWalls(rawFixture);
    expect(result.walls).toHaveLength(173);
    expect(result.walls).toEqual(wallsFixture.walls);
  });

  it("returns correct gridSquares and pixelsPerGrid", () => {
    const result = parseUvttWalls(rawFixture);
    expect(result.gridSquares).toEqual({ x: 65, y: 45 });
    expect(result.pixelsPerGrid).toBe(128);
  });
});

describe("parseUvttWalls — portal open flag", () => {
  it("open portal (closed:false) → door:true open:true", () => {
    const doc = {
      resolution: {
        map_origin: { x: 0, y: 0 },
        map_size: { x: 10, y: 10 },
        pixels_per_grid: 100,
      },
      portals: [{ bounds: [{ x: 1, y: 1 }, { x: 2, y: 1 }], closed: false }],
    };
    const result = parseUvttWalls(doc);
    expect(result.walls).toHaveLength(1);
    expect(result.walls[0]).toEqual({ x1: 100, y1: 100, x2: 200, y2: 100, door: true, open: true });
  });

  it("closed portal (closed:true) → door:true, no open property", () => {
    const doc = {
      resolution: {
        map_origin: { x: 0, y: 0 },
        map_size: { x: 10, y: 10 },
        pixels_per_grid: 100,
      },
      portals: [{ bounds: [{ x: 1, y: 1 }, { x: 2, y: 1 }], closed: true }],
    };
    const result = parseUvttWalls(doc);
    expect(result.walls[0].door).toBe(true);
    expect(result.walls[0].open).toBeUndefined();
  });
});

describe("parseUvttWalls — objects_line_of_sight", () => {
  it("included as plain walls after line_of_sight", () => {
    const doc = {
      resolution: {
        map_origin: { x: 0, y: 0 },
        map_size: { x: 10, y: 10 },
        pixels_per_grid: 10,
      },
      line_of_sight: [
        [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      ],
      objects_line_of_sight: [
        [{ x: 2, y: 0 }, { x: 3, y: 0 }],
      ],
    };
    const result = parseUvttWalls(doc);
    expect(result.walls).toHaveLength(2);
    expect(result.walls[0]).toEqual({ x1: 0, y1: 0, x2: 10, y2: 0 });
    expect(result.walls[1]).toEqual({ x1: 20, y1: 0, x2: 30, y2: 0 });
  });
});

describe("parseUvttWalls — map_origin subtraction", () => {
  it("subtracts non-zero origin from all coordinates", () => {
    const doc = {
      resolution: {
        map_origin: { x: 1, y: 2 },
        map_size: { x: 10, y: 10 },
        pixels_per_grid: 10,
      },
      line_of_sight: [
        [{ x: 2, y: 4 }, { x: 3, y: 4 }],
      ],
    };
    const result = parseUvttWalls(doc);
    expect(result.walls).toHaveLength(1);
    expect(result.walls[0]).toEqual({ x1: 10, y1: 20, x2: 20, y2: 20 });
  });
});

describe("parseUvttWalls — polyline edge cases", () => {
  it("polyline with 3 points yields 2 segments", () => {
    const doc = {
      resolution: {
        map_origin: { x: 0, y: 0 },
        map_size: { x: 10, y: 10 },
        pixels_per_grid: 10,
      },
      line_of_sight: [
        [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
      ],
    };
    const result = parseUvttWalls(doc);
    expect(result.walls).toHaveLength(2);
    expect(result.walls[0]).toEqual({ x1: 0, y1: 0, x2: 10, y2: 0 });
    expect(result.walls[1]).toEqual({ x1: 10, y1: 0, x2: 20, y2: 0 });
  });

  it("single-point polyline is ignored", () => {
    const doc = {
      resolution: {
        map_origin: { x: 0, y: 0 },
        map_size: { x: 10, y: 10 },
        pixels_per_grid: 10,
      },
      line_of_sight: [[{ x: 1, y: 1 }]],
    };
    const result = parseUvttWalls(doc);
    expect(result.walls).toHaveLength(0);
  });

  it("zero-length segments are skipped", () => {
    const doc = {
      resolution: {
        map_origin: { x: 0, y: 0 },
        map_size: { x: 10, y: 10 },
        pixels_per_grid: 10,
      },
      line_of_sight: [[{ x: 1, y: 1 }, { x: 1, y: 1 }]],
    };
    const result = parseUvttWalls(doc);
    expect(result.walls).toHaveLength(0);
  });

  it("segments with non-numeric points are skipped, valid neighbours survive", () => {
    const doc = {
      resolution: {
        map_origin: { x: 0, y: 0 },
        map_size: { x: 10, y: 10 },
        pixels_per_grid: 10,
      },
      line_of_sight: [[{ x: 1, y: 1 }, { x: "bad" }, { x: 3, y: 3 }]],
      portals: [{ bounds: [{ x: 1, y: 1 }, {}], closed: true }],
    };
    const result = parseUvttWalls(doc);
    expect(result.walls).toHaveLength(0);
  });
});

describe("parseUvttWalls — malformed docs throw", () => {
  it("null throws", () => {
    expect(() => parseUvttWalls(null)).toThrow(/Not a UVTT file/);
  });

  it("{} (no resolution) throws", () => {
    expect(() => parseUvttWalls({})).toThrow(/Not a UVTT file/);
  });

  it("{resolution:{}} (empty resolution) throws", () => {
    expect(() => parseUvttWalls({ resolution: {} })).toThrow(/Not a UVTT file/);
  });

  it("map_size.x = 0 throws", () => {
    expect(() =>
      parseUvttWalls({
        resolution: { map_size: { x: 0, y: 5 }, pixels_per_grid: 100 },
      })
    ).toThrow(/Not a UVTT file/);
  });

  it("missing pixels_per_grid throws", () => {
    expect(() =>
      parseUvttWalls({
        resolution: { map_size: { x: 10, y: 10 } },
      })
    ).toThrow(/Not a UVTT file/);
  });
});
