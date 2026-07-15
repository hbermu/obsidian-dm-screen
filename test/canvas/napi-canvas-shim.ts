import { Canvas, Path2D, createCanvas, loadImage } from "@napi-rs/canvas";

// WeakMap wiring: HTMLCanvasElement → napi Canvas
const wired = new WeakMap<HTMLCanvasElement, Canvas>();

function getOrCreateNapi(el: HTMLCanvasElement): Canvas {
  let nc = wired.get(el);
  if (!nc) {
    nc = createCanvas(el.width || 1, el.height || 1);
    wired.set(el, nc);
  }
  return nc;
}

// Wire a canvas element (even if not created via shimmed createElement) so
// getContext("2d") returns a Proxy-backed napi context. Safe to call repeatedly.
function wireCanvasEl(canvasEl: HTMLCanvasElement): void {
  if (wired.has(canvasEl)) return;
  const nc = createCanvas(canvasEl.width || 1, canvasEl.height || 1);
  wired.set(canvasEl, nc);
}

function unwrapImage(src: unknown): unknown {
  if (src instanceof FakeImage) return src._napiImage;
  const el = src as HTMLCanvasElement | null;
  if (el && typeof el === "object" && "nodeName" in el && (el as Element).nodeName === "CANVAS") {
    // Ensure the napi canvas exists (getContext may not have been called yet)
    return getOrCreateNapi(el);
  }
  return src;
}

function makeContextProxy(napiCtx: ReturnType<Canvas["getContext"]>): CanvasRenderingContext2D {
  return new Proxy(napiCtx as unknown as CanvasRenderingContext2D, {
    get(target, prop) {
      const val = (target as unknown as Record<string | symbol, unknown>)[prop];
      if (prop === "drawImage") {
        const origDraw = (val as (...a: unknown[]) => unknown).bind(target);
        return (src: unknown, ...args: unknown[]) => {
          // napi ctx accepts its own Image/Canvas; unwrap happy-dom elements
          origDraw(unwrapImage(src), ...args);
        };
      }
      if (typeof val === "function") {
        return (val as (...a: unknown[]) => unknown).bind(target);
      }
      return val;
    },
    set(target, prop, value) {
      (target as unknown as Record<string | symbol, unknown>)[prop] = value;
      return true;
    },
  });
}

// FakeImage: global Image replacement that decodes data URLs via napi loadImage
export class FakeImage {
  _napiImage: Awaited<ReturnType<typeof loadImage>> | null = null;
  onload: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  private _src = "";

  get naturalWidth(): number { return this._napiImage?.width ?? 0; }
  get naturalHeight(): number { return this._napiImage?.height ?? 0; }

  get src(): string { return this._src; }
  set src(dataUrl: string) {
    this._src = dataUrl;
    const comma = dataUrl.indexOf(",");
    const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    const buf = Buffer.from(b64, "base64");
    // loadImage (async) is required: new Image(); img.src = buf sets dimensions
    // but does NOT make pixels available to drawImage on napi canvas contexts.
    loadImage(buf).then((ni) => {
      this._napiImage = ni;
      this.onload?.();
    }).catch((err: unknown) => {
      this.onerror?.(err);
    });
  }
}

let _origCreate: typeof document.createElement | null = null;
let _origProtoGetContext: unknown = null;
let _origProtoToDataURL: unknown = null;

// Returns napi 2d context from a canvas element, creating the napi backing if needed.
function getNapiCtx(el: HTMLCanvasElement): ReturnType<Canvas["getContext"]> {
  wireCanvasEl(el);
  const nc = wired.get(el)!;
  const w = el.width || 1;
  const h = el.height || 1;
  if (nc.width !== w) nc.width = w;
  if (nc.height !== h) nc.height = h;
  return nc.getContext("2d");
}

export function installNapiCanvas(): () => void {
  // Set globals used by vision/fog code.
  // In vitest happy-dom, `new Image()` resolves through window, so patch both.
  (globalThis as Record<string, unknown>).Image = FakeImage;
  (globalThis as Record<string, unknown>).Path2D = Path2D;
  if (typeof window !== "undefined") {
    (window as unknown as Record<string, unknown>).Image = FakeImage;
    (window as unknown as Record<string, unknown>).Path2D = Path2D;
  }

  // Patch HTMLCanvasElement.prototype so cloned canvases (cloneNode) also get
  // napi-backed contexts without going through document.createElement.
  if (typeof HTMLCanvasElement !== "undefined") {
    const proto = HTMLCanvasElement.prototype;
    _origProtoGetContext = proto.getContext;
    _origProtoToDataURL = proto.toDataURL;

    (proto as unknown as Record<string, unknown>).getContext = function (
      this: HTMLCanvasElement, contextId: string, ...args: unknown[]
    ): unknown {
      if (contextId !== "2d") {
        return (_origProtoGetContext as (id: string, ...a: unknown[]) => unknown).call(this, contextId, ...args);
      }
      return makeContextProxy(getNapiCtx(this));
    };

    (proto as unknown as Record<string, unknown>).toDataURL = function (
      this: HTMLCanvasElement, type = "image/png"
    ): string {
      wireCanvasEl(this);
      const nc = wired.get(this)!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const buf = (nc as unknown as { toBuffer(t: string): Buffer }).toBuffer(type);
      return `data:${type};base64,${buf.toString("base64")}`;
    };
  }

  // Patch document.createElement to intercept <canvas> and set up width/height
  // property trackers that keep the napi canvas in sync.
  _origCreate = document.createElement.bind(document) as typeof document.createElement;
  const origCreate = _origCreate;

  (document as unknown as Record<string, unknown>).createElement = (tagName: string, options?: ElementCreationOptions) => {
    const el = origCreate(tagName as "canvas", options);
    if (tagName.toLowerCase() !== "canvas") return el;

    const canvasEl = el as HTMLCanvasElement;
    let _w = 0;
    let _h = 0;

    Object.defineProperty(canvasEl, "width", {
      get() { return _w; },
      set(v: number) {
        _w = v;
        const nc = wired.get(canvasEl);
        if (nc) nc.width = v || 1;
      },
      configurable: true,
      enumerable: true,
    });
    Object.defineProperty(canvasEl, "height", {
      get() { return _h; },
      set(v: number) {
        _h = v;
        const nc = wired.get(canvasEl);
        if (nc) nc.height = v || 1;
      },
      configurable: true,
      enumerable: true,
    });

    return canvasEl;
  };

  return () => {
    if (_origCreate) {
      document.createElement = _origCreate;
      _origCreate = null;
    }
    if (typeof HTMLCanvasElement !== "undefined") {
      if (_origProtoGetContext) {
        (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).getContext = _origProtoGetContext;
        _origProtoGetContext = null;
      }
      if (_origProtoToDataURL) {
        (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).toDataURL = _origProtoToDataURL;
        _origProtoToDataURL = null;
      }
    }
    delete (globalThis as Record<string, unknown>).Image;
    delete (globalThis as Record<string, unknown>).Path2D;
    if (typeof window !== "undefined") {
      delete (window as unknown as Record<string, unknown>).Image;
      delete (window as unknown as Record<string, unknown>).Path2D;
    }
  };
}

// Read a pixel from a wired canvas element via napi getImageData.
export function pixelAt(canvasEl: HTMLCanvasElement, x: number, y: number): [number, number, number, number] {
  const nc = wired.get(canvasEl);
  if (!nc) return [0, 0, 0, 0];
  const ctx = nc.getContext("2d");
  const data = ctx.getImageData(x, y, 1, 1).data;
  return [data[0], data[1], data[2], data[3]];
}

// Load a data URL into a napi Image for pixel inspection outside a canvas element.
export async function loadDataUrl(dataUrl: string): Promise<Awaited<ReturnType<typeof loadImage>>> {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return loadImage(Buffer.from(b64, "base64"));
}
