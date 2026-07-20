import type { MapWall } from "./types";
import { fogSidecarPath, type FogAdapter } from "./fog";

// Same key derivation as the fog sidecar, different folder and extension.
export function wallsSidecarPath(mapUrl: string): string {
  return fogSidecarPath(mapUrl).replace("/fog/", "/walls/").replace(/\.png$/, ".json");
}

export async function loadWallsSidecar(adapter: FogAdapter, mapUrl: string): Promise<MapWall[]> {
  const path = wallsSidecarPath(mapUrl);
  if (!(await adapter.exists(path))) return [];
  const buf = await adapter.readBinary(path);
  try {
    const parsed = JSON.parse(new TextDecoder().decode(buf)) as { walls?: MapWall[] };
    return Array.isArray(parsed.walls) ? parsed.walls : [];
  } catch {
    return [];
  }
}

export async function saveWallsSidecar(adapter: FogAdapter, mapUrl: string, walls: MapWall[]): Promise<void> {
  for (const dir of [".dm-screen", ".dm-screen/walls"]) {
    if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
  }
  const bytes = new TextEncoder().encode(JSON.stringify({ walls }));
  const buf = new ArrayBuffer(bytes.length);
  new Uint8Array(buf).set(bytes);
  await adapter.writeBinary(wallsSidecarPath(mapUrl), buf);
}

// Rasterize the walls the `blocks` predicate admits onto a fresh fogW×fogH
// canvas at fog resolution, read their alpha into a 0/1 blocked mask, and seal
// the 1px outer border (the map edge acts as a wall — mirrors how
// visibilityPolygon closes with the bounds rect). Shared by the Fog Room tool
// (predicate = blocksSight) and Exploration (predicate = () => true).
export function buildBlockedMask(
  walls: MapWall[],
  fogW: number,
  fogH: number,
  fogScale: number,
  pxPerSquare: number,
  blocks: (w: MapWall) => boolean
): Uint8Array {
  const canvas = document.createElement("canvas");
  canvas.width = fogW;
  canvas.height = fogH;
  const ctx = canvas.getContext("2d")!;
  ctx.lineWidth = Math.max(3, pxPerSquare * fogScale * 0.12);
  ctx.lineCap = "round";
  ctx.strokeStyle = "black";
  for (const w of walls) {
    if (!blocks(w)) continue;
    ctx.beginPath();
    ctx.moveTo(w.x1 * fogScale, w.y1 * fogScale);
    ctx.lineTo(w.x2 * fogScale, w.y2 * fogScale);
    ctx.stroke();
  }
  const imgData = ctx.getImageData(0, 0, fogW, fogH);
  const blocked = new Uint8Array(fogW * fogH);
  for (let i = 0; i < fogW * fogH; i++) {
    blocked[i] = imgData.data[i * 4 + 3] > 0 ? 1 : 0;
  }
  for (let x = 0; x < fogW; x++) {
    blocked[x] = 1;
    blocked[(fogH - 1) * fogW + x] = 1;
  }
  for (let y = 0; y < fogH; y++) {
    blocked[y * fogW] = 1;
    blocked[y * fogW + fogW - 1] = 1;
  }
  return blocked;
}

// Paint a floodRegion mask onto a fresh fogW×fogH canvas: opaque black where
// region===1, transparent elsewhere — ready for source-over / destination-out
// compositing onto the fog canvas.
export function regionToCanvas(region: Uint8Array, fogW: number, fogH: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = fogW;
  canvas.height = fogH;
  const ctx = canvas.getContext("2d")!;
  const data = ctx.createImageData(fogW, fogH);
  for (let i = 0; i < fogW * fogH; i++) {
    if (region[i]) {
      data.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

// BFS flood over unblocked pixels; returns the connected region containing
// (sx, sy) as a 0/1 mask, or null when the start pixel is blocked.
export function floodRegion(blocked: Uint8Array, w: number, h: number, sx: number, sy: number): Uint8Array | null {
  const start = Math.floor(sy) * w + Math.floor(sx);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h || blocked[start]) return null;
  const region = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  region[start] = 1;
  while (head < tail) {
    const i = queue[head++];
    const x = i % w;
    if (x > 0 && !blocked[i - 1] && !region[i - 1]) { region[i - 1] = 1; queue[tail++] = i - 1; }
    if (x < w - 1 && !blocked[i + 1] && !region[i + 1]) { region[i + 1] = 1; queue[tail++] = i + 1; }
    if (i >= w && !blocked[i - w] && !region[i - w]) { region[i - w] = 1; queue[tail++] = i - w; }
    if (i < w * (h - 1) && !blocked[i + w] && !region[i + w]) { region[i + w] = 1; queue[tail++] = i + w; }
  }
  return region;
}
