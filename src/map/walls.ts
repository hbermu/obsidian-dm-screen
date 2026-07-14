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
