import zlib from "node:zlib";

type RGBA = readonly [number, number, number, number];

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function ihdr(w: number, h: number): Buffer {
  const b = Buffer.alloc(13);
  b.writeUInt32BE(w, 0);
  b.writeUInt32BE(h, 4);
  b[8] = 8;
  b[9] = 6;
  b[10] = 0;
  b[11] = 0;
  b[12] = 0;
  return b;
}

function encodePixels(w: number, h: number, pixelAt: (x: number, y: number) => RGBA): Buffer {
  const stride = 1 + 4 * w;
  const raw = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = pixelAt(x, y);
      const off = y * stride + 1 + 4 * x;
      raw[off] = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
      raw[off + 3] = a;
    }
  }
  return Buffer.concat([
    SIG,
    chunk("IHDR", ihdr(w, h)),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function pngToDataUrl(buf: Buffer): string {
  return `data:image/png;base64,${buf.toString("base64")}`;
}

export function solidPng(w: number, h: number, color: RGBA): Buffer {
  return encodePixels(w, h, () => color);
}

export function gridPng(
  w: number,
  h: number,
  cell: number,
  a: RGBA,
  b: RGBA,
): Buffer {
  return encodePixels(w, h, (x, y) => {
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    return ((cx + cy) & 1) === 0 ? a : b;
  });
}

export function fogFullPng(w: number, h: number): Buffer {
  return solidPng(w, h, [0, 0, 0, 255]);
}

export function fogCircleRevealPng(w: number, h: number): Buffer {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.25;
  const r2 = r * r;
  return encodePixels(w, h, (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy < r2 ? [0, 0, 0, 0] : [0, 0, 0, 255];
  });
}

export function fogRectRevealPng(w: number, h: number): Buffer {
  const x0 = Math.floor(w * 0.3);
  const x1 = Math.floor(w * 0.7);
  const y0 = Math.floor(h * 0.35);
  const y1 = Math.floor(h * 0.65);
  return encodePixels(w, h, (x, y) =>
    x >= x0 && x < x1 && y >= y0 && y < y1 ? [0, 0, 0, 0] : [0, 0, 0, 255],
  );
}

export function fogFreehandRevealPng(w: number, h: number): Buffer {
  const stroke = Math.max(8, Math.floor(Math.min(w, h) * 0.04));
  const r2 = stroke * stroke;
  const pts: Array<[number, number]> = [];
  const steps = 80;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = w * (0.2 + 0.6 * t);
    const y = h * (0.5 + 0.2 * Math.sin(t * Math.PI * 2));
    pts.push([x, y]);
  }
  return encodePixels(w, h, (x, y) => {
    for (const [px, py] of pts) {
      const dx = x - px;
      const dy = y - py;
      if (dx * dx + dy * dy < r2) return [0, 0, 0, 0];
    }
    return [0, 0, 0, 255];
  });
}
