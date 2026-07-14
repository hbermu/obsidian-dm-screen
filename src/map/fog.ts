import type { MapGridConfig } from "./types";

export const FOG_RESOLUTION = 1024;

export interface FogAdapter {
  exists(path: string): Promise<boolean>;
  readBinary(path: string): Promise<ArrayBuffer>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  mkdir(path: string): Promise<void>;
}

export interface CellRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function fogCanvasSize(naturalWidth: number, naturalHeight: number): { width: number; height: number } {
  return {
    width: FOG_RESOLUTION,
    height: Math.max(1, Math.round(FOG_RESOLUTION * (naturalHeight / naturalWidth))),
  };
}

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// Readable tail + content hash: the tail aids manual cleanup in the vault,
// the hash guarantees distinct maps never share a sidecar.
export function fogSidecarPath(mapUrl: string): string {
  const raw = mapUrl.startsWith("/vault/") ? decodeURIComponent(mapUrl.slice("/vault/".length)) : mapUrl;
  const tail = raw.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-60).replace(/^[._]+/, "") || "x";
  return `.dm-screen/fog/${tail}-${fnv1a(mapUrl)}.png`;
}

export function gridCellRectAt(
  mapX: number,
  mapY: number,
  cfg: Pick<MapGridConfig, "pxPerSquare" | "gridOffsetX" | "gridOffsetY">
): CellRect {
  const s = cfg.pxPerSquare;
  const ix = Math.floor((mapX - cfg.gridOffsetX) / s);
  const iy = Math.floor((mapY - cfg.gridOffsetY) / s);
  return { x: cfg.gridOffsetX + ix * s, y: cfg.gridOffsetY + iy * s, w: s, h: s };
}

export async function loadFogSidecar(adapter: FogAdapter, mapUrl: string): Promise<string | null> {
  const path = fogSidecarPath(mapUrl);
  if (!(await adapter.exists(path))) return null;
  const buf = await adapter.readBinary(path);
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:image/png;base64,${btoa(bin)}`;
}

export async function saveFogSidecar(adapter: FogAdapter, mapUrl: string, dataUrl: string): Promise<void> {
  for (const dir of [".dm-screen", ".dm-screen/fog"]) {
    if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
  }
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const buf = new ArrayBuffer(bytes.length);
  new Uint8Array(buf).set(bytes);
  await adapter.writeBinary(fogSidecarPath(mapUrl), buf);
}
