import type { MapWall } from "./types";

export interface UvttParseResult {
  walls: MapWall[];
  gridSquares: { x: number; y: number };
  pixelsPerGrid: number;
}

export function parseUvttWalls(doc: unknown): UvttParseResult {
  if (doc === null || typeof doc !== "object") {
    throw new Error("Not a UVTT file (missing resolution/pixels_per_grid)");
  }
  const d = doc as Record<string, unknown>;
  const res = d["resolution"];
  if (res === null || typeof res !== "object") {
    throw new Error("Not a UVTT file (missing resolution/pixels_per_grid)");
  }
  const r = res as Record<string, unknown>;
  const mapSize = r["map_size"];
  const pixelsPerGrid = r["pixels_per_grid"];
  if (
    mapSize === null || typeof mapSize !== "object" ||
    typeof pixelsPerGrid !== "number" || !Number.isFinite(pixelsPerGrid) || pixelsPerGrid <= 0
  ) {
    throw new Error("Not a UVTT file (missing resolution/pixels_per_grid)");
  }
  const ms = mapSize as Record<string, unknown>;
  const msX = ms["x"];
  const msY = ms["y"];
  if (
    typeof msX !== "number" || !Number.isFinite(msX) || msX <= 0 ||
    typeof msY !== "number" || !Number.isFinite(msY) || msY <= 0
  ) {
    throw new Error("Not a UVTT file (missing resolution/pixels_per_grid)");
  }

  const mapOrigin = r["map_origin"];
  let originX = 0;
  let originY = 0;
  if (mapOrigin !== null && typeof mapOrigin === "object") {
    const mo = mapOrigin as Record<string, unknown>;
    if (typeof mo["x"] === "number") originX = mo["x"];
    if (typeof mo["y"] === "number") originY = mo["y"];
  }

  const rawLos = d["line_of_sight"];
  const los: unknown[] = Array.isArray(rawLos) ? rawLos : [];
  const rawObjLos = d["objects_line_of_sight"];
  const objLos: unknown[] = Array.isArray(rawObjLos) ? rawObjLos : [];
  const rawPortals = d["portals"];
  const portals: unknown[] = Array.isArray(rawPortals) ? rawPortals : [];

  const walls: MapWall[] = [];

  const addPolyline = (polyline: unknown) => {
    if (!Array.isArray(polyline) || polyline.length < 2) return;
    for (let i = 0; i < polyline.length - 1; i++) {
      const a = polyline[i] as Record<string, unknown>;
      const b = polyline[i + 1] as Record<string, unknown>;
      const x1 = (Number(a["x"]) - originX) * pixelsPerGrid;
      const y1 = (Number(a["y"]) - originY) * pixelsPerGrid;
      const x2 = (Number(b["x"]) - originX) * pixelsPerGrid;
      const y2 = (Number(b["y"]) - originY) * pixelsPerGrid;
      if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
      if (x1 === x2 && y1 === y2) continue;
      walls.push({ x1, y1, x2, y2 });
    }
  };

  for (const poly of los) addPolyline(poly);
  for (const poly of objLos) addPolyline(poly);

  for (const portal of portals) {
    if (portal === null || typeof portal !== "object") continue;
    const p = portal as Record<string, unknown>;
    const bounds = p["bounds"];
    if (!Array.isArray(bounds) || bounds.length < 2) continue;
    const first = bounds[0] as Record<string, unknown>;
    const last = bounds[bounds.length - 1] as Record<string, unknown>;
    const x1 = (Number(first["x"]) - originX) * pixelsPerGrid;
    const y1 = (Number(first["y"]) - originY) * pixelsPerGrid;
    const x2 = (Number(last["x"]) - originX) * pixelsPerGrid;
    const y2 = (Number(last["y"]) - originY) * pixelsPerGrid;
    if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
    if (x1 === x2 && y1 === y2) continue;
    const wall: MapWall = { x1, y1, x2, y2, door: true };
    if (p["closed"] === false) wall.open = true;
    walls.push(wall);
  }

  return {
    walls,
    gridSquares: { x: msX, y: msY },
    pixelsPerGrid,
  };
}
