import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import {
  parseNedb,
  parseLeveldbLog,
  foundrySceneToWalls,
  pickScene,
  parseFoundryModule,
} from "../map/foundry";

// Hand-made synthetic fixtures using only public-domain data.

describe("parseNedb", () => {
  it("parses valid docs, ignores $$deleted and blank lines", () => {
    const text = [
      JSON.stringify({ _id: "abc", name: "Room", width: 1000, height: 800, grid: 100, walls: [] }),
      JSON.stringify({ _id: "del", $$deleted: true }),
      "",
    ].join("\n");
    const docs = parseNedb(text);
    expect(docs).toHaveLength(1);
    expect((docs[0] as Record<string, unknown>)["name"]).toBe("Room");
  });

  it("ignores lines that are not valid JSON", () => {
    const text = "not json\n" + JSON.stringify({ _id: "1", name: "X", width: 100, height: 100, grid: 50, walls: [] });
    const docs = parseNedb(text);
    expect(docs).toHaveLength(1);
  });
});

describe("foundrySceneToWalls", () => {
  const baseScene = {
    name: "Room",
    width: 1000,
    height: 800,
    grid: 100,
    walls: [
      // sense:20 plain wall
      { c: [0, 0, 100, 0], sense: 20, door: 0 },
      // sense:0 → filtered out
      { c: [100, 0, 100, 100], sense: 0 },
      // door:1, ds:0 (closed)
      { c: [0, 0, 0, 100], door: 1, ds: 0, sense: 20 },
      // zero-length → skipped
      { c: [50, 50, 50, 50], sense: 20 },
    ],
  };

  it("returns gridSize 100 and 2 walls (sense:0 filtered, zero-length skipped)", () => {
    const scene = foundrySceneToWalls(baseScene as Record<string, unknown>);
    expect(scene).not.toBeNull();
    expect(scene!.gridSize).toBe(100);
    // wall (0,0,100,0) and door (0,0,0,100 closed); sense:0 and zero-length excluded
    expect(scene!.walls).toHaveLength(2);
    expect(scene!.walls[0]).toEqual({ x1: 0, y1: 0, x2: 100, y2: 0 });
    expect(scene!.walls[1]).toEqual({ x1: 0, y1: 0, x2: 0, y2: 100, door: true });
    expect(scene!.walls[1].open).toBeUndefined();
  });

  it("ds:1 produces open:true on a door", () => {
    const scene = foundrySceneToWalls({
      name: "S",
      width: 500,
      height: 500,
      grid: 50,
      walls: [{ c: [0, 0, 50, 0], door: 1, ds: 1, sense: 20 }],
    });
    expect(scene).not.toBeNull();
    expect(scene!.walls[0].open).toBe(true);
  });

  it("grid as {size:70} is accepted", () => {
    const scene = foundrySceneToWalls({
      name: "S",
      width: 700,
      height: 700,
      grid: { size: 70 },
      walls: [{ c: [0, 0, 70, 0], sense: 20 }],
    });
    expect(scene).not.toBeNull();
    expect(scene!.gridSize).toBe(70);
  });

  it("returns null when all walls are filtered", () => {
    const scene = foundrySceneToWalls({
      name: "Empty",
      width: 100,
      height: 100,
      grid: 50,
      walls: [{ c: [0, 0, 50, 0], sense: 0 }],
    });
    expect(scene).toBeNull();
  });
});

describe("pickScene", () => {
  const makeScene = (name: string, wallCount: number) => ({
    name,
    width: 1000,
    height: 800,
    grid: 100,
    walls: Array.from({ length: wallCount }, (_, i) => ({ c: [i, 0, i + 1, 0], sense: 20 })),
  });

  it("prefers base name (no parens) over variant with parens", () => {
    const docs = [makeScene("Guildhall (Night)", 5), makeScene("Guildhall", 5)];
    const picked = pickScene(docs);
    expect(picked).not.toBeNull();
    expect(picked!.name).toBe("Guildhall");
  });

  it("picks the scene with most walls when all have parens", () => {
    const docs = [makeScene("Room (A)", 3), makeScene("Room (B)", 8)];
    const picked = pickScene(docs);
    expect(picked!.walls).toHaveLength(8);
  });

  it("returns null for empty docs", () => {
    expect(pickScene([])).toBeNull();
  });
});

describe("parseLeveldbLog", () => {
  it("decodes a single FULL record (type=1) with crc=0", () => {
    const doc = { _id: "wall1", name: "Hall", width: 200, height: 200, grid: 50, walls: [{ c: [0, 0, 50, 0], sense: 20 }] };
    const jsonBytes = new TextEncoder().encode(JSON.stringify(doc));
    // Build a minimal WAL block: 4-byte crc=0, 2-byte length LE, 1-byte type=1, then data
    const header = new Uint8Array(7);
    header[4] = jsonBytes.length & 0xff;
    header[5] = (jsonBytes.length >> 8) & 0xff;
    header[6] = 1; // FULL
    const block = new Uint8Array(header.length + jsonBytes.length);
    block.set(header, 0);
    block.set(jsonBytes, 7);

    const docs = parseLeveldbLog(block);
    expect(docs).toHaveLength(1);
    const parsed = docs[0] as Record<string, unknown>;
    expect(parsed["name"]).toBe("Hall");
    expect(parsed["width"]).toBe(200);
  });
});

describe("parseFoundryModule", () => {
  function makeNedbBytes(scene: object): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(scene) + "\n");
  }

  it("extracts walls and grid from a .db NeDB entry", () => {
    const scene = {
      _id: "abc",
      name: "TestMap",
      width: 1000,
      height: 800,
      grid: 100,
      walls: [
        { c: [0, 0, 1000, 0], sense: 20 },
        { c: [0, 0, 0, 800], sense: 20 },
      ],
    };
    const entries = { "packs/maps.db": makeNedbBytes(scene) };
    const result = parseFoundryModule(entries);
    expect(result.gridSquares).toEqual({ x: 10, y: 8 });
    expect(result.pixelsPerGrid).toBe(100);
    expect(result.walls).toHaveLength(2);
    // walls are in scene px (not scaled by parseFoundryModule)
    expect(result.walls[0]).toEqual({ x1: 0, y1: 0, x2: 1000, y2: 0 });
  });

  it("throws when no scene with walls found", () => {
    expect(() => parseFoundryModule({})).toThrow("No scene with walls found in module");
  });

  it("throws for entries with no valid scene", () => {
    const entries = { "packs/maps.db": new TextEncoder().encode("not json\n") };
    expect(() => parseFoundryModule(entries)).toThrow("No scene with walls found in module");
  });
});

describe("parseFoundryModule — LevelDB .log entries", () => {
  it("reads walls from a packs/*.log entry", () => {
    const scene = {
      _id: "xyz",
      name: "LogScene",
      width: 500,
      height: 500,
      grid: 50,
      walls: [{ c: [0, 0, 500, 0], sense: 20 }],
    };
    const jsonBytes = new TextEncoder().encode(JSON.stringify(scene));
    const header = new Uint8Array(7);
    header[4] = jsonBytes.length & 0xff;
    header[5] = (jsonBytes.length >> 8) & 0xff;
    header[6] = 1; // FULL
    const block = new Uint8Array(7 + jsonBytes.length);
    block.set(header, 0);
    block.set(jsonBytes, 7);

    const entries = { "packs/scenes.log": block };
    const result = parseFoundryModule(entries);
    expect(result.walls).toHaveLength(1);
    expect(result.pixelsPerGrid).toBe(50);
  });
});

describe("parseFoundryModule — end-to-end with fflate zipSync", () => {
  it("importFoundryZip reads walls via zip unzipSync from a synthesized zip", () => {
    const scene = {
      _id: "zip1",
      name: "ZipRoom",
      width: 800,
      height: 600,
      grid: 80,
      walls: [{ c: [0, 0, 800, 0], sense: 20 }, { c: [0, 0, 0, 600], sense: 20 }],
    };
    const nedbStr = JSON.stringify(scene) + "\n";
    const zipped = zipSync({ "packs/maps.db": new TextEncoder().encode(nedbStr) });
    // Unzip manually and feed to parseFoundryModule to verify the chain
    const { unzipSync } = require("fflate") as typeof import("fflate");
    const entries = unzipSync(zipped, { filter: (f: { name: string }) => /\.(db|log|ldb)$/i.test(f.name) });
    const result = parseFoundryModule(entries);
    expect(result.walls).toHaveLength(2);
    expect(result.gridSquares).toEqual({ x: 10, y: 7.5 });
  });
});
