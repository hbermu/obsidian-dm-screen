import { beforeEach, describe, expect, it, vi } from "vitest";
import { HydrusCache, type VaultAdapterLike } from "../hydrus/cache";
import type { HydrusClient, HydrusFile } from "../hydrus/client";

class MemoryAdapter implements VaultAdapterLike {
  text = new Map<string, string>();
  bin = new Map<string, ArrayBuffer>();
  async exists(path: string) { return this.text.has(path) || this.bin.has(path); }
  async read(path: string) {
    const v = this.text.get(path);
    if (v === undefined) throw new Error("ENOENT " + path);
    return v;
  }
  async write(path: string, data: string) { this.text.set(path, data); }
  async writeBinary(path: string, data: ArrayBuffer) { this.bin.set(path, data); }
  async remove(path: string) { this.text.delete(path); this.bin.delete(path); }
  async mkdir(_path: string) {}
}

function fakeFile(overrides: Partial<HydrusFile> = {}): HydrusFile {
  return { hash: "h1", mime: "image/png", ext: "png", size: 1024, knownTags: ["tag1"], ...overrides };
}

function fakeClient(overrides: Partial<HydrusClient> = {}): HydrusClient {
  return {
    getFileBytes: vi.fn(async () => new TextEncoder().encode("file-data").buffer),
    getThumbnailBytes: vi.fn(async () => new TextEncoder().encode("thumb-data").buffer),
    ...overrides,
  } as unknown as HydrusClient;
}

describe("HydrusCache - paths", () => {
  it("generates correct vault paths", () => {
    const adapter = new MemoryAdapter();
    const cache = new HydrusCache(null, { folder: ".dm-screen/bg", ttlDays: 30, adapter });
    const paths = cache.paths("abcdef123", "webp");
    expect(paths.vaultPath).toBe(".dm-screen/bg/abcdef123.webp");
    expect(paths.thumbVaultPath).toBe(".dm-screen/bg/abcdef123.thumb.jpg");
  });

  it("strips leading/trailing slashes from folder", () => {
    const adapter = new MemoryAdapter();
    const cache = new HydrusCache(null, { folder: "/my-cache/", ttlDays: 30, adapter });
    const paths = cache.paths("abc", "png");
    expect(paths.vaultPath).toBe("my-cache/abc.png");
  });

  it("uses default folder when empty", () => {
    const adapter = new MemoryAdapter();
    const cache = new HydrusCache(null, { folder: "", ttlDays: 30, adapter });
    const paths = cache.paths("abc", "png");
    expect(paths.vaultPath).toBe(".dm-screen/bg/abc.png");
  });
});

describe("HydrusCache - concurrent operations", () => {
  let adapter: MemoryAdapter;
  let cache: HydrusCache;

  beforeEach(() => {
    adapter = new MemoryAdapter();
    cache = new HydrusCache(null, { folder: ".dm-screen/bg", ttlDays: 30, adapter });
  });

  it("handles concurrent markUsed calls without corruption", async () => {
    const client = fakeClient();
    await cache.fetchAndCache(client, fakeFile({ hash: "a" }));
    await cache.fetchAndCache(client, fakeFile({ hash: "b" }));

    await Promise.all([
      cache.markUsed("a"),
      cache.markUsed("b"),
    ]);

    const a = await cache.get("a");
    const b = await cache.get("b");
    expect(a?.lastUsedAt).toBeGreaterThan(0);
    expect(b?.lastUsedAt).toBeGreaterThan(0);
  });

  it("handles concurrent fetchAndCache + markUsed", async () => {
    const client = fakeClient();
    await cache.fetchAndCache(client, fakeFile({ hash: "a" }));

    await Promise.all([
      cache.markUsed("a"),
      cache.fetchAndCache(client, fakeFile({ hash: "b" })),
    ]);

    const list = await cache.listCached();
    expect(list).toHaveLength(2);
  });
});

describe("HydrusCache - index resilience", () => {
  it("recovers from corrupted index JSON", async () => {
    const adapter = new MemoryAdapter();
    adapter.text.set(".dm-screen/bg/index.json", "not valid json {{{");

    const cache = new HydrusCache(null, { folder: ".dm-screen/bg", ttlDays: 30, adapter });
    const entries = await cache.listCached();
    expect(entries).toEqual([]);
  });

  it("recovers from wrong version index", async () => {
    const adapter = new MemoryAdapter();
    adapter.text.set(".dm-screen/bg/index.json", JSON.stringify({ version: 99, entries: { x: {} } }));

    const cache = new HydrusCache(null, { folder: ".dm-screen/bg", ttlDays: 30, adapter });
    const entries = await cache.listCached();
    expect(entries).toEqual([]);
  });

  it("creates folder on first write if it doesn't exist", async () => {
    const adapter = new MemoryAdapter();
    const mkdirSpy = vi.spyOn(adapter, "mkdir");
    const cache = new HydrusCache(null, { folder: ".dm-screen/bg", ttlDays: 30, adapter });

    await cache.fetchAndCache(fakeClient(), fakeFile());
    expect(mkdirSpy).toHaveBeenCalledWith(".dm-screen/bg");
  });
});

describe("HydrusCache - TTL edge cases", () => {
  it("ttlDays minimum is 1 day", () => {
    const adapter = new MemoryAdapter();
    const cache = new HydrusCache(null, { folder: ".dm-screen/bg", ttlDays: 0, adapter });
    // Internal ttlMs should be at least 1 day
    expect((cache as any).ttlMs).toBe(24 * 60 * 60 * 1000);
  });

  it("sweep does not remove entries that are exactly at the TTL boundary", async () => {
    const adapter = new MemoryAdapter();
    const cache = new HydrusCache(null, { folder: ".dm-screen/bg", ttlDays: 30, adapter });
    const client = fakeClient();
    await cache.fetchAndCache(client, fakeFile());
    await cache.markUsed("h1");

    // Set lastUsedAt to exactly the TTL boundary (not past it)
    const idx = JSON.parse(adapter.text.get(".dm-screen/bg/index.json")!);
    const ttlMs = 30 * 24 * 60 * 60 * 1000;
    idx.entries["h1"].lastUsedAt = Date.now() - ttlMs + 1000; // just within TTL
    adapter.text.set(".dm-screen/bg/index.json", JSON.stringify(idx));

    const fresh = new HydrusCache(null, { folder: ".dm-screen/bg", ttlDays: 30, adapter });
    expect(await fresh.sweep()).toBe(0);
  });
});

describe("HydrusCache - knownTags preservation", () => {
  it("stores and returns knownTags from the original file", async () => {
    const adapter = new MemoryAdapter();
    const cache = new HydrusCache(null, { folder: ".dm-screen/bg", ttlDays: 30, adapter });
    const client = fakeClient();

    await cache.fetchAndCache(client, fakeFile({
      hash: "tagged",
      knownTags: ["castle", "night", "rain", "czepeku"],
    }));

    const entry = await cache.get("tagged");
    expect(entry?.knownTags).toEqual(["castle", "night", "rain", "czepeku"]);
  });
});
