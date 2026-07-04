import type { MapAoe } from "./types";

const CONE_ANGLE_RAD = (53 * Math.PI) / 180;

export function renderAoe(
  ctx: CanvasRenderingContext2D,
  aoe: MapAoe,
  scale: number,
  tx: number,
  ty: number,
  pxPerSquare: number
): void {
  const ftToPx = pxPerSquare / 5;
  const screenX = tx + aoe.x * scale;
  const screenY = ty + aoe.y * scale;
  const rot = (aoe.rotation * Math.PI) / 180;

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
      const r = sizeFt * ftScale;
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      break;
    }
    case "square": {
      const half = (sizeFt * ftScale) / 2;
      ctx.rect(-half, -half, half * 2, half * 2);
      break;
    }
    case "cone": {
      const len = sizeFt * ftScale;
      const halfAngle = CONE_ANGLE_RAD / 2;
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, len, -halfAngle, halfAngle);
      ctx.lineTo(0, 0);
      break;
    }
    case "line": {
      const len = sizeFt * ftScale;
      const halfW = (widthFt * ftScale) / 2;
      ctx.rect(0, -halfW, len, halfW * 2);
      break;
    }
  }
}
