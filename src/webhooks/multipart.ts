// Multipart/form-data builder for outbound webhook POSTs.
// Pure functions, no network — tested in isolation.

export interface ParsedDataUrl {
  mime: string;
  bytes: Uint8Array;
  ext: string;
}

export interface MultipartTextField {
  name: string;
  value: string;
}

export interface MultipartFileField {
  name: string;
  filename: string;
  mime: string;
  bytes: Uint8Array;
}

export interface MultipartBody {
  contentType: string;
  body: ArrayBuffer;
}

const DATA_URL_RE = /^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/;

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/bmp": "bmp",
};

export function dataUrlToBytes(dataUrl: string): ParsedDataUrl {
  const m = DATA_URL_RE.exec(dataUrl);
  if (!m) {
    throw new Error("Unsupported data URL: only image/* base64 data URLs are accepted");
  }
  const mime = m[1].toLowerCase();
  const b64 = m[2];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = MIME_TO_EXT[mime] ?? "bin";
  return { mime, bytes, ext };
}

export function generateBoundary(): string {
  const r1 = Math.random().toString(16).slice(2, 10).padStart(8, "0");
  const r2 = Math.random().toString(16).slice(2, 10).padStart(8, "0");
  return `----DmScreenBoundary${r1}${r2}`;
}

export function buildMultipart(
  textFields: MultipartTextField[],
  file: MultipartFileField,
  boundary: string = generateBoundary(),
): MultipartBody {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const f of textFields) {
    chunks.push(enc.encode(`--${boundary}\r\n`));
    chunks.push(enc.encode(`Content-Disposition: form-data; name="${f.name}"\r\n\r\n`));
    chunks.push(enc.encode(`${f.value}\r\n`));
  }
  chunks.push(enc.encode(`--${boundary}\r\n`));
  chunks.push(
    enc.encode(
      `Content-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\n`,
    ),
  );
  chunks.push(enc.encode(`Content-Type: ${file.mime}\r\n\r\n`));
  chunks.push(file.bytes);
  chunks.push(enc.encode(`\r\n--${boundary}--\r\n`));

  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: out.buffer,
  };
}
