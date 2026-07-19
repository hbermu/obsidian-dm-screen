import type { MapWall } from "./types";

export interface FoundryScene {
  name: string;
  width: number;
  height: number;
  gridSize: number;
  walls: MapWall[];
}

export interface FoundryImportResult {
  walls: MapWall[];
  gridSquares: { x: number; y: number };
  pixelsPerGrid: number;
}

export function parseNedb(text: string): unknown[] {
  const results: unknown[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let doc: unknown;
    try {
      doc = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (doc !== null && typeof doc === "object" && "$$deleted" in (doc as Record<string, unknown>)) continue;
    results.push(doc);
  }
  return results;
}

// Walk brace depth to find the end of the first top-level JSON object in str,
// respecting string escapes. Returns the parsed object or null on failure.
function tryDecodeFirstJson(str: string): unknown | null {
  const start = str.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < str.length; i++) {
    const ch = str[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(str.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// LevelDB write-ahead-log parser.
// Block size is 32768; record header is 7 bytes: crc(4 LE) + length(2 LE) + type(1).
// Types: 1=FULL, 2=FIRST, 3=MIDDLE, 4=LAST. CRC is not verified.
export function parseLeveldbLog(bytes: Uint8Array): unknown[] {
  const results: unknown[] = [];
  const BLOCK = 32768;
  const HEADER = 7;
  let offset = 0;
  let pending: Uint8Array[] = [];

  const flushPending = () => {
    if (pending.length === 0) return;
    const total = pending.reduce((s, c) => s + c.length, 0);
    const buf = new Uint8Array(total);
    let pos = 0;
    for (const chunk of pending) { buf.set(chunk, pos); pos += chunk.length; }
    pending = [];
    const str = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    const doc = tryDecodeFirstJson(str);
    if (doc !== null) results.push(doc);
  };

  while (offset < bytes.length) {
    const blockStart = Math.floor(offset / BLOCK) * BLOCK;
    const blockEnd = blockStart + BLOCK;
    let pos = offset;

    while (pos + HEADER <= blockEnd && pos + HEADER <= bytes.length) {
      // crc is bytes[pos..pos+3], not verified
      const length = bytes[pos + 4] | (bytes[pos + 5] << 8);
      const type = bytes[pos + 6];

      // Zero-length, zero-crc header signals end of used space in this block
      if (length === 0 && type === 0) break;

      const dataStart = pos + HEADER;
      const dataEnd = dataStart + length;
      if (dataEnd > bytes.length) break;

      const data = bytes.slice(dataStart, dataEnd);
      pos = dataEnd;

      if (type === 1) {
        // FULL
        flushPending();
        pending = [data];
        flushPending();
      } else if (type === 2) {
        // FIRST
        flushPending();
        pending = [data];
      } else if (type === 3) {
        // MIDDLE
        pending.push(data);
      } else if (type === 4) {
        // LAST
        pending.push(data);
        flushPending();
      }
    }

    // Advance to next block boundary
    offset = blockEnd;
  }

  flushPending();
  return results;
}

export function foundrySceneToWalls(scene: Record<string, unknown>): FoundryScene | null {
  const width = scene["width"];
  const height = scene["height"];
  const rawWalls = scene["walls"];
  const rawGrid = scene["grid"];

  if (typeof width !== "number" || !Number.isFinite(width) || width <= 0) return null;
  if (typeof height !== "number" || !Number.isFinite(height) || height <= 0) return null;
  if (!Array.isArray(rawWalls)) return null;

  let gridSize: number;
  if (typeof rawGrid === "number") {
    gridSize = rawGrid;
  } else if (rawGrid !== null && typeof rawGrid === "object") {
    const g = rawGrid as Record<string, unknown>;
    if (typeof g["size"] === "number") {
      gridSize = g["size"] as number;
    } else {
      return null;
    }
  } else {
    return null;
  }
  if (!Number.isFinite(gridSize) || gridSize <= 0) return null;

  const walls: MapWall[] = [];
  for (const w of rawWalls) {
    if (w === null || typeof w !== "object") continue;
    const wr = w as Record<string, unknown>;

    // Filter walls that don't block sight
    if (wr["sense"] === 0) continue;

    const c = wr["c"];
    if (!Array.isArray(c) || c.length < 4) continue;
    const [x1, y1, x2, y2] = c as number[];
    if (![x1, y1, x2, y2].every((v) => typeof v === "number" && Number.isFinite(v))) continue;
    // Skip zero-length walls
    if (x1 === x2 && y1 === y2) continue;

    const door = typeof wr["door"] === "number" ? wr["door"] : 0;
    if (typeof door === "number" && door > 0) {
      const ds = typeof wr["ds"] === "number" ? (wr["ds"] as number) : 0;
      const wall: MapWall = { x1, y1, x2, y2, door: true };
      // ds: 0 = closed, 1 = open, 2 = locked (treat as closed)
      if (ds === 1) wall.open = true;
      walls.push(wall);
    } else {
      walls.push({ x1, y1, x2, y2 });
    }
  }

  if (walls.length === 0) return null;

  const name = typeof scene["name"] === "string" ? scene["name"] : "";
  return { name, width, height, gridSize, walls };
}

export function pickScene(docs: unknown[]): FoundryScene | null {
  const scenes: FoundryScene[] = [];
  for (const doc of docs) {
    if (doc === null || typeof doc !== "object") continue;
    const scene = foundrySceneToWalls(doc as Record<string, unknown>);
    if (scene) scenes.push(scene);
  }
  if (scenes.length === 0) return null;

  // Prefer scene whose name has no parenthesis (base variant)
  const base = scenes.filter((s) => !s.name.includes("("));
  if (base.length > 0) {
    // Among base variants, most walls first, then first
    return base.reduce((best, s) => (s.walls.length > best.walls.length ? s : best), base[0]);
  }
  // Fall back to most walls
  return scenes.reduce((best, s) => (s.walls.length > best.walls.length ? s : best), scenes[0]);
}

export function parseFoundryModule(entries: Record<string, Uint8Array>): FoundryImportResult {
  const docs: unknown[] = [];

  for (const [name, bytes] of Object.entries(entries)) {
    if (/\.db$/i.test(name)) {
      const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      docs.push(...parseNedb(text));
    } else if (/packs[/\\].*\.(log|ldb)$/i.test(name)) {
      docs.push(...parseLeveldbLog(bytes));
    }
  }

  const scene = pickScene(docs);
  if (!scene) throw new Error("No scene with walls found in module");

  return {
    walls: scene.walls,
    gridSquares: { x: scene.width / scene.gridSize, y: scene.height / scene.gridSize },
    pixelsPerGrid: scene.gridSize,
  };
}
