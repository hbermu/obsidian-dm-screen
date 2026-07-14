// src/__tests__/map-fog.test.ts
import { describe, expect, it } from "vitest";
import {
  fogCanvasSize,
  fogSidecarPath,
  gridCellRectAt,
  loadFogSidecar,
  saveFogSidecar,
  type FogAdapter,
} from "../map/fog";

// 1×1 transparent PNG
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function makeAdapter(files: Record<string, Uint8Array> = {}) {
  const dirs = new Set<string>();
  const adapter: FogAdapter = {
    exists: (p) => Promise.resolve(p in files || dirs.has(p)),
    readBinary: (p) => {
      const bytes = files[p];
      const buf = new ArrayBuffer(bytes.length);
      new Uint8Array(buf).set(bytes);
      return Promise.resolve(buf);
    },
    writeBinary: (p, data) => {
      files[p] = new Uint8Array(data);
      return Promise.resolve();
    },
    mkdir: (p) => {
      dirs.add(p);
      return Promise.resolve();
    },
  };
  return { adapter, files, dirs };
}

describe("fogCanvasSize", () => {
  it("is 1024 wide with aspect-matched height", () => {
    expect(fogCanvasSize(2048, 1024)).toEqual({ width: 1024, height: 512 });
    expect(fogCanvasSize(1000, 1500)).toEqual({ width: 1024, height: 1536 });
  });

  it("never returns a zero height", () => {
    expect(fogCanvasSize(100000, 1).height).toBeGreaterThanOrEqual(1);
  });
});

describe("fogSidecarPath", () => {
  it("is deterministic and lives under .dm-screen/fog/", () => {
    const a = fogSidecarPath("/vault/maps/dungeon%20level%201.jpg");
    expect(a).toBe(fogSidecarPath("/vault/maps/dungeon%20level%201.jpg"));
    expect(a).toMatch(/^\.dm-screen\/fog\/[A-Za-z0-9._-]+\.png$/);
  });

  it("distinguishes URLs that sanitize to the same readable tail", () => {
    expect(fogSidecarPath("/vault/a/b.png")).not.toBe(fogSidecarPath("/vault/a_b.png"));
  });

  it("keeps a readable tail from the vault path", () => {
    expect(fogSidecarPath("/vault/.dm-screen/hydrus/abc123.jpg")).toContain("abc123");
  });

  it("falls back to a placeholder tail when sanitization strips everything", () => {
    expect(fogSidecarPath("/vault/_")).toMatch(/^\.dm-screen\/fog\/x-[0-9a-f]{8}\.png$/);
  });
});

describe("gridCellRectAt", () => {
  const cfg = { pxPerSquare: 140, gridOffsetX: 0, gridOffsetY: 0 };

  it("snaps a point to its containing cell", () => {
    expect(gridCellRectAt(150, 10, cfg)).toEqual({ x: 140, y: 0, w: 140, h: 140 });
  });

  it("honors grid offsets", () => {
    const off = { pxPerSquare: 100, gridOffsetX: 30, gridOffsetY: -20 };
    expect(gridCellRectAt(135, 85, off)).toEqual({ x: 130, y: 80, w: 100, h: 100 });
  });

  it("handles points left of the offset (negative cell index)", () => {
    const off = { pxPerSquare: 100, gridOffsetX: 50, gridOffsetY: 0 };
    expect(gridCellRectAt(20, 10, off)).toEqual({ x: -50, y: 0, w: 100, h: 100 });
  });
});

describe("fog sidecar IO", () => {
  it("loadFogSidecar returns null when no sidecar exists", async () => {
    const { adapter } = makeAdapter();
    expect(await loadFogSidecar(adapter, "/vault/maps/x.jpg")).toBeNull();
  });

  it("save then load round-trips the PNG as a data URL", async () => {
    const { adapter, files } = makeAdapter();
    const dataUrl = `data:image/png;base64,${TINY_PNG_B64}`;
    await saveFogSidecar(adapter, "/vault/maps/x.jpg", dataUrl);
    const path = fogSidecarPath("/vault/maps/x.jpg");
    expect(files[path]).toBeDefined();
    expect(await loadFogSidecar(adapter, "/vault/maps/x.jpg")).toBe(dataUrl);
  });

  it("saveFogSidecar creates the fog folders when missing", async () => {
    const { adapter, dirs } = makeAdapter();
    await saveFogSidecar(adapter, "/vault/m.png", `data:image/png;base64,${TINY_PNG_B64}`);
    expect(dirs.has(".dm-screen")).toBe(true);
    expect(dirs.has(".dm-screen/fog")).toBe(true);
  });
});
