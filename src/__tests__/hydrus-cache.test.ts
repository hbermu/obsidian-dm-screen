import { beforeEach, describe, expect, it, vi } from "vitest";
import { HydrusCache, type VaultAdapterLike } from "../hydrus/cache";
import type { HydrusClient, HydrusFile } from "../hydrus/client";

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
  async mkdir(_path: string) {
    // No-op for in-memory.
  }
}

function fakeFile(overrides: Partial<HydrusFile> = {}): HydrusFile {
  return {
    hash: "h1",
    mime: "image/png",
    ext: "png",
    size: 0,
    knownTags: ["tavern", "night"],
    ...overrides,
  };
}

function fakeClient(overrides: Partial<HydrusClient> = {}): HydrusClient {
  return {
    getFileBytes: vi.fn(async () => new TextEncoder().encode("binary").buffer),
    getThumbnailBytes: vi.fn(async () => new TextEncoder().encode("thumb").buffer),
    ...overrides,
  } as unknown as HydrusClient;
}

describe("HydrusCache", () => {
  let adapter: MemoryAdapter;
  let cache: HydrusCache;

  beforeEach(() => {
    adapter = new MemoryAdapter();
    cache = new HydrusCache(null, {
      folder: ".hydrus-cache",
      ttlDays: 30,
      adapter,
    });
  });

  it("fetchAndCache writes binary + thumb and indexes the entry", async () => {
    const client = fakeClient();
    const { entry, isFresh } = await cache.fetchAndCache(client, fakeFile());
    expect(isFresh).toBe(true);
    expect(entry.vaultPath).toBe(".hydrus-cache/h1.png");
    expect(entry.thumbVaultPath).toBe(".hydrus-cache/h1.thumb.jpg");
    expect(adapter.bin.has(".hydrus-cache/h1.png")).toBe(true);
    expect(adapter.bin.has(".hydrus-cache/h1.thumb.jpg")).toBe(true);
    expect(adapter.text.has(".hydrus-cache/index.json")).toBe(true);
    expect(entry.lastUsedAt).toBe(0);
  });

  it("fetchAndCache does not refetch when the binary already exists", async () => {
    const client = fakeClient();
    await cache.fetchAndCache(client, fakeFile());
    const getFileBytes = client.getFileBytes as ReturnType<typeof vi.fn>;
    expect(getFileBytes).toHaveBeenCalledTimes(1);

    const { isFresh } = await cache.fetchAndCache(client, fakeFile());
    expect(isFresh).toBe(false);
    expect(getFileBytes).toHaveBeenCalledTimes(1);
  });

  it("markUsed updates lastUsedAt and prevents sweep from collecting the entry", async () => {
    const client = fakeClient();
    await cache.fetchAndCache(client, fakeFile());

    // Force the entry's lastUsedAt to be ancient.
    await cache.markUsed("h1");
    const entry = (await cache.get("h1"))!;
    expect(entry.lastUsedAt).toBeGreaterThan(0);

    const removed = await cache.sweep();
    expect(removed).toBe(0);
  });

  it("sweep removes entries whose lastUsedAt is older than the TTL", async () => {
    const client = fakeClient();
    await cache.fetchAndCache(client, fakeFile());
    await cache.markUsed("h1");

    // Cheat: rewrite the index to backdate lastUsedAt.
    const indexPath = ".hydrus-cache/index.json";
    const idx = JSON.parse(adapter.text.get(indexPath)!) as {
      entries: Record<string, { lastUsedAt: number }>;
    };
    idx.entries["h1"].lastUsedAt = Date.now() - 40 * 24 * 60 * 60 * 1000;
    adapter.text.set(indexPath, JSON.stringify(idx));

    // Reopen the cache so loadIndex re-reads from disk.
    const fresh = new HydrusCache(null, { folder: ".hydrus-cache", ttlDays: 30, adapter });
    const removed = await fresh.sweep();
    expect(removed).toBe(1);
    expect(adapter.bin.has(".hydrus-cache/h1.png")).toBe(false);
    expect(adapter.bin.has(".hydrus-cache/h1.thumb.jpg")).toBe(false);
    expect(await fresh.get("h1")).toBeUndefined();
  });

  it("sweep ignores entries that were never used", async () => {
    const client = fakeClient();
    await cache.fetchAndCache(client, fakeFile()); // lastUsedAt = 0 → ignored by sweep
    expect(await cache.sweep()).toBe(0);
    expect(adapter.bin.has(".hydrus-cache/h1.png")).toBe(true);
  });

  it("evict removes a single entry from disk and index", async () => {
    const client = fakeClient();
    await cache.fetchAndCache(client, fakeFile());
    await cache.evict("h1");
    expect(adapter.bin.has(".hydrus-cache/h1.png")).toBe(false);
    expect(await cache.get("h1")).toBeUndefined();
  });

  it("clear wipes everything", async () => {
    const client = fakeClient();
    await cache.fetchAndCache(client, fakeFile({ hash: "a" }));
    await cache.fetchAndCache(client, fakeFile({ hash: "b" }));
    const removed = await cache.clear();
    expect(removed).toBe(2);
    expect(adapter.bin.size).toBe(0);
    expect(await cache.listCached()).toEqual([]);
  });

  it("listCached returns every entry", async () => {
    const client = fakeClient();
    await cache.fetchAndCache(client, fakeFile({ hash: "a" }));
    await cache.fetchAndCache(client, fakeFile({ hash: "b" }));
    const list = await cache.listCached();
    expect(list.map((e) => e.hash).sort()).toEqual(["a", "b"]);
  });

  it("gracefully copes when the thumbnail download fails", async () => {
    const client = fakeClient({
      getThumbnailBytes: vi.fn(async () => {
        throw new Error("nope");
      }),
    } as Partial<HydrusClient>);
    const { entry } = await cache.fetchAndCache(client, fakeFile());
    expect(entry.thumbVaultPath).toBe("");
    expect(adapter.bin.has(".hydrus-cache/h1.png")).toBe(true);
    expect(adapter.bin.has(".hydrus-cache/h1.thumb.jpg")).toBe(false);
  });
});
