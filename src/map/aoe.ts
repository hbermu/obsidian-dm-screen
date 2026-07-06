import { rotatePoint } from "./transform";
import type { MapAoe, MapRotation } from "./types";

const CONE_ANGLE_RAD = (53 * Math.PI) / 180;

// The stage renders as `translate(tx,ty) rotate(θ) scale(s)`, so a map point
// lands at T + s·R·p; the shape's own rotation composes on top of the map's.
export function renderAoe(
  ctx: CanvasRenderingContext2D,
  aoe: MapAoe,
  scale: number,
  tx: number,
  ty: number,
  pxPerSquare: number,
  mapRotation: MapRotation
): void {
  const ftToPx = pxPerSquare / 5;
  const p = rotatePoint(aoe.x, aoe.y, mapRotation);
  const screenX = tx + p.x * scale;
  const screenY = ty + p.y * scale;
  const rot = ((aoe.rotation + mapRotation) * Math.PI) / 180;

  ctx.save();
  ctx.translate(screenX, screenY);
  ctx.rotate(rot);

  ctx.beginPath();
  buildPath(ctx, aoe.shape, aoe.sizeFt, aoe.widthFt, ftToPx * scale);
  ctx.closePath();

  ctx.fillStyle = aoe.color;
  ctx.globalAlpha = aoe.opacity;
  ctx.fill();

  ctx.globalAlpha = 1;
  ctx.strokeStyle = aoe.color;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.restore();
}

function buildPath(
  ctx: CanvasRenderingContext2D,
  shape: MapAoe["shape"],
  sizeFt: number,
  widthFt: number,
  ftScale: number
): void {
  switch (shape) {
    case "circle": {
      ctx.arc(0, 0, sizeFt * ftScale, 0, Math.PI * 2);
      break;
    }
    case "ring": {
      // Hollow band: outer radius = sizeFt, inner radius = sizeFt − widthFt.
      // The two arcs run in opposite directions so the default nonzero
      // winding rule leaves the hole; stroking both draws each band edge.
      const outer = sizeFt * ftScale;
      const inner = Math.max(0, sizeFt - widthFt) * ftScale;
      ctx.arc(0, 0, outer, 0, Math.PI * 2, false);
      ctx.moveTo(inner, 0);
      ctx.arc(0, 0, inner, 0, Math.PI * 2, true);
      break;
    }
    case "square": {
      const half = (sizeFt * ftScale) / 2;
      ctx.rect(-half, -half, half * 2, half * 2);
      break;
    }
    case "cone": {
      const halfAngle = CONE_ANGLE_RAD / 2;
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, sizeFt * ftScale, -halfAngle, halfAngle);
      break;
    }
    case "line": {
      const halfW = (widthFt * ftScale) / 2;
      ctx.rect(0, -halfW, sizeFt * ftScale, halfW * 2);
      break;
    }
  }
}
