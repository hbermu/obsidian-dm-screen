import type { MapWall } from "./types";

export interface Point {
  x: number;
  y: number;
}

interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function blocksSight(wall: MapWall): boolean {
  return !(wall.door && wall.open);
}

function rayHit(cx: number, cy: number, dx: number, dy: number, w: MapWall): number | null {
  const sx = w.x2 - w.x1;
  const sy = w.y2 - w.y1;
  const denom = dx * sy - dy * sx;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((w.x1 - cx) * sy - (w.y1 - cy) * sx) / denom;
  const u = ((w.x1 - cx) * dy - (w.y1 - cy) * dx) / denom;
  if (t >= 0 && u >= -1e-9 && u <= 1 + 1e-9) return t;
  return null;
}

// Angular-sweep visibility: cast rays at every wall endpoint (± epsilon so
// rays slip past corners), keep the nearest hit per ray, connect by angle.
export function visibilityPolygon(cx: number, cy: number, walls: MapWall[], bounds: Bounds): Point[] {
  const segs: MapWall[] = [
    ...walls.filter(blocksSight),
    { x1: bounds.x, y1: bounds.y, x2: bounds.x + bounds.w, y2: bounds.y },
    { x1: bounds.x + bounds.w, y1: bounds.y, x2: bounds.x + bounds.w, y2: bounds.y + bounds.h },
    { x1: bounds.x + bounds.w, y1: bounds.y + bounds.h, x2: bounds.x, y2: bounds.y + bounds.h },
    { x1: bounds.x, y1: bounds.y + bounds.h, x2: bounds.x, y2: bounds.y },
  ];
  const angles: number[] = [];
  for (const s of segs) {
    for (const [px, py] of [
      [s.x1, s.y1],
      [s.x2, s.y2],
    ]) {
      const a = Math.atan2(py - cy, px - cx);
      angles.push(a - 1e-4, a, a + 1e-4);
    }
  }
  angles.sort((a, b) => a - b);
  const pts: Point[] = [];
  for (const a of angles) {
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let tMin = Infinity;
    for (const s of segs) {
      const t = rayHit(cx, cy, dx, dy, s);
      if (t !== null && t < tMin) tMin = t;
    }
    if (tMin < Infinity) pts.push({ x: cx + dx * tMin, y: cy + dy * tMin });
  }
  return pts;
}
