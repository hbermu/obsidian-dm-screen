import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as obsidian from "obsidian";
import { HydrusClient } from "../hydrus/client";
import { HydrusCache, type VaultAdapterLike } from "../hydrus/cache";

class MemoryAdapter implements VaultAdapterLike {
  text = new Map<string, string>();
  bin = new Map<string, ArrayBuffer>();
  async exists(path: string) {
    return this.text.has(path) || this.bin.has(path);
  }
  async read(path: string) {
    const v = this.text.get(path);
    if (v === undefined) throw new Error("ENOENT " + path);
    return v;
  }
  async write(path: string, data: string) {
    this.text.set(path, data);
  }
  async writeBinary(path: string, data: ArrayBuffer) {
    this.bin.set(path, data);
  }
  async remove(path: string) {
    this.text.delete(path);
    this.bin.delete(path);
  }
  async mkdir(_path: string) {}
}

const HASHES = ["aaaaaaaa", "bbbbbbbb"];
const METADATA = [
  {
    hash: HASHES[0],
    mime: "image/png",
    ext: ".png",
    size: 100,
    width: 800,
    height: 600,
    tags: {
      svc: { name: "my tags", storage_tags: { "0": ["tavern", "night"] } },
    },
  },
  {
    hash: HASHES[1],
    mime: "image/webp",
    ext: ".webp",
    size: 200,
    width: 1024,
    height: 768,
    tags: {
      svc: { name: "my tags", storage_tags: { "0": ["castle", "exterior"] } },
    },
  },
];

function bytesFor(content: string): ArrayBuffer {
  return new TextEncoder().encode(content).buffer;
}

function ok(body: unknown, arrayBuffer?: ArrayBuffer) {
  return Promise.resolve({
    status: 200,
    json: body,
    text: "",
    arrayBuffer: arrayBuffer ?? new ArrayBuffer(0),
    headers: {},
  });
}

describe("Hydrus client + cache end-to-end", () => {
  let adapter: MemoryAdapter;
  let cache: HydrusCache;
  let client: HydrusClient;
  let requestSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    adapter = new MemoryAdapter();
    cache = new HydrusCache(null, {
      folder: ".dm-screen/hydrus",
      ttlDays: 30,
      adapter,
    });
    client = new HydrusClient({ baseUrl: "http://hydrus.test", apiKey: "k" });

    requestSpy = vi.spyOn(obsidian, "requestUrl").mockImplementation(((param: unknown) => {
      const url = typeof param === "string" ? param : (param as { url: string }).url;
      if (url.includes("/get_files/search_files")) {
        return ok({ hashes: HASHES });
      }
      if (url.includes("/get_files/file_metadata")) {
        return ok({ metadata: METADATA });
      }
      if (url.includes("/get_files/file?hash=")) {
        const hash = url.split("hash=")[1];
        return ok({}, bytesFor(`bin-${hash}`));
      }
      if (url.includes("/get_files/thumbnail?hash=")) {
        const hash = url.split("hash=")[1];
        return ok({}, bytesFor(`thumb-${hash}`));
      }
      return ok({});
    }) as never);
  });

  afterEach(() => {
    requestSpy.mockRestore();
  });

  it("search → metadata → fetchAndCache populates the vault adapter and index", async () => {
    const { hashes } = await client.searchFiles(["tavern"], 50);
    expect(hashes).toEqual(HASHES);

    const files = await client.getFileMetadata(hashes);
    expect(files.map((f) => f.hash)).toEqual(HASHES);
    expect(files[0].knownTags).toEqual(["tavern", "night"]);
    expect(files[1].mime).toBe("image/webp");

    const results = await Promise.all(files.map((f) => cache.fetchAndCache(client, f)));
    expect(results.every((r) => r.isFresh)).toBe(true);

    expect(adapter.bin.get(".dm-screen/hydrus/aaaaaaaa.png")).toBeDefined();
    expect(adapter.bin.get(".dm-screen/hydrus/aaaaaaaa.thumb.jpg")).toBeDefined();
    expect(adapter.bin.get(".dm-screen/hydrus/bbbbbbbb.webp")).toBeDefined();
    expect(adapter.text.has(".dm-screen/hydrus/index.json")).toBe(true);

    const cached = await cache.listCached();
    expect(cached).toHaveLength(2);
    expect(cached.find((e) => e.hash === HASHES[0])!.knownTags).toEqual(["tavern", "night"]);
  });

  it("a second fetchAndCache for the same hash short-circuits without re-downloading", async () => {
    const [file] = await client.getFileMetadata(HASHES.slice(0, 1));
    await cache.fetchAndCache(client, file);

    requestSpy.mockClear();
    const second = await cache.fetchAndCache(client, file);
    expect(second.isFresh).toBe(false);

    const downloadCalls = requestSpy.mock.calls.filter(([param]: [unknown]) => {
      const url = typeof param === "string" ? param : (param as { url: string }).url;
      return url.includes("/get_files/file?hash=") || url.includes("/get_files/thumbnail?hash=");
    });
    expect(downloadCalls).toHaveLength(0);
  });

  it("propagates a non-2xx response from the API as an Error", async () => {
    requestSpy.mockImplementationOnce(((_param: unknown) => Promise.resolve({
      status: 401,
      json: null,
      text: "bad key",
      arrayBuffer: new ArrayBuffer(0),
      headers: {},
    })) as never);

    await expect(client.searchFiles(["anything"])).rejects.toThrow(/Hydrus 401/);
  });
});
