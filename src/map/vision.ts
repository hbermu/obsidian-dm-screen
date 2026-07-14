import { blocksSight, visibilityPolygon } from "./los";
import type { MapVision, MapWall } from "./types";

// Fully revealed out to sizeFt; alpha fades to 0 across the feather band
// beyond it ("can't see further").
export function eraseVision(
  ctx: CanvasRenderingContext2D,
  vision: MapVision,
  scale: number,
  pxPerSquare: number
): void {
  const ftToPx = (pxPerSquare / 5) * scale;
  const cx = vision.x * scale;
  const cy = vision.y * scale;
  const r = Math.max(0, vision.sizeFt) * ftToPx;
  const feather = Math.max(0, vision.featherFt) * ftToPx;
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "rgba(0,0,0,1)";
  if (vision.shape === "circle") {
    const outer = Math.max(1, r + feather);
    if (feather > 0) {
      const g = ctx.createRadialGradient(cx, cy, r, cx, cy, outer);
      g.addColorStop(0, "rgba(0,0,0,1)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
    }
    ctx.beginPath();
    ctx.arc(cx, cy, outer, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // blur() approximates the radial falloff for squares; half the feather on
    // each side keeps the fully-revealed area at sizeFt.
    if (feather > 0) ctx.filter = `blur(${feather / 2}px)`;
    const half = r + feather / 2;
    ctx.fillRect(cx - half, cy - half, half * 2, half * 2);
    ctx.filter = "none";
  }
  ctx.restore();
}

export function eraseVisionWithWalls(
  ctx: CanvasRenderingContext2D,
  vision: MapVision,
  scale: number,
  pxPerSquare: number,
  walls: MapWall[],
  mapWidth: number,
  mapHeight: number
): void {
  if (!walls.some(blocksSight)) {
    eraseVision(ctx, vision, scale, pxPerSquare);
    return;
  }
  const poly = visibilityPolygon(vision.x, vision.y, walls, { x: 0, y: 0, w: mapWidth, h: mapHeight });
  if (poly.length < 3) return;
  const path = new Path2D();
  path.moveTo(poly[0].x * scale, poly[0].y * scale);
  for (let i = 1; i < poly.length; i++) path.lineTo(poly[i].x * scale, poly[i].y * scale);
  path.closePath();
  ctx.save();
  ctx.clip(path);
  eraseVision(ctx, vision, scale, pxPerSquare);
  ctx.restore();
}
