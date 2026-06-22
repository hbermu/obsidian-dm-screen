import { describe, expect, it, vi } from "vitest";
import { parseHydrusRefs, resolveHydrusRefs, ensureLocalCopy } from "../hydrus/noteRefs";
import type { HydrusCache, CachedEntry } from "../hydrus/cache";
import type { HydrusClient } from "../hydrus/client";

const H1 = "a".repeat(64);
const H2 = "b".repeat(64);

describe("parseHydrusRefs", () => {
  it("extracts a single labelled reference", () => {
    expect(parseHydrusRefs(`intro [Goblin warrior](hydrus://${H1}) outro`)).toEqual([
      { label: "Goblin warrior", hash: H1 },
    ]);
  });

  it("returns multiple refs in order", () => {
    const body = `[One](hydrus://${H1})\n[Two](hydrus://${H2})`;
    expect(parseHydrusRefs(body)).toEqual([
      { label: "One", hash: H1 },
      { label: "Two", hash: H2 },
    ]);
  });

  it("dedupes by hash, keeping the first label", () => {
    const body = `[First](hydrus://${H1}) ... [Second](hydrus://${H1.toUpperCase()})`;
    expect(parseHydrusRefs(body)).toEqual([{ label: "First", hash: H1 }]);
  });

  it("ignores malformed and non-hydrus links", () => {
    const body = [
      `[short](hydrus://${"a".repeat(40)})`,
      `[plain](https://example.com/x.png)`,
      `[[wikilink]]`,
      `hydrus://${H2}`,
    ].join("\n");
    expect(parseHydrusRefs(body)).toEqual([]);
  });

  it("accepts an empty label", () => {
    expect(parseHydrusRefs(`[](hydrus://${H1})`)).toEqual([{ label: "", hash: H1 }]);
  });
});

function cachedEntry(hash: string, mime: string): CachedEntry {
  const ext = mime.split("/")[1];
  return {
    hash,
    ext,
    mime,
    sizeBytes: 1,
    downloadedAt: 0,
    lastUsedAt: 0,
    knownTags: [],
    vaultPath: `.dm-screen/hydrus/${hash}.${ext}`,
    thumbVaultPath: "",
  };
}

function fakeCache(entries: Record<string, CachedEntry>): HydrusCache {
  return {
    get: vi.fn(async (h: string) => entries[h]),
    fetchAndCache: vi.fn(async (_c: HydrusClient, f: { hash: string; mime: string }) => ({
      entry: cachedEntry(f.hash, f.mime),
      isFresh: true,
    })),
  } as unknown as HydrusCache;
}

describe("resolveHydrusRefs", () => {
  it("resolves a cached ref offline (null client)", async () => {
    const cache = fakeCache({ [H1]: cachedEntry(H1, "image/png") });
    const out = await resolveHydrusRefs([{ label: "L", hash: H1 }], cache, null);
    expect(out).toEqual([
      { label: "L", hash: H1, mediaType: "image", cached: true, available: true },
    ]);
  });

  it("batch-resolves uncached refs via one getFileMetadata call", async () => {
    const cache = fakeCache({});
    const client = {
      getFileMetadata: vi.fn(async (hashes: string[]) =>
        hashes.map((h) => ({
          hash: h,
          mime: h === H2 ? "video/mp4" : "image/png",
          ext: "x",
          size: 0,
          knownTags: [],
        }))
      ),
    } as unknown as HydrusClient;
    const out = await resolveHydrusRefs(
      [
        { label: "A", hash: H1 },
        { label: "B", hash: H2 },
      ],
      cache,
      client
    );
    expect(client.getFileMetadata).toHaveBeenCalledTimes(1);
    expect(out.map((r) => r.mediaType)).toEqual(["image", "video"]);
    expect(out.every((r) => r.available && !r.cached)).toBe(true);
  });

  it("marks uncached refs unavailable when client is null", async () => {
    const out = await resolveHydrusRefs([{ label: "A", hash: H1 }], fakeCache({}), null);
    expect(out).toEqual([
      { label: "A", hash: H1, mediaType: null, cached: false, available: false },
    ]);
  });

  it("marks refs unavailable on network error", async () => {
    const client = {
      getFileMetadata: vi.fn(async () => {
        throw new Error("net");
      }),
    } as unknown as HydrusClient;
    const out = await resolveHydrusRefs([{ label: "A", hash: H1 }], fakeCache({}), client);
    expect(out[0].available).toBe(false);
    expect(out[0].mediaType).toBeNull();
  });
});

describe("ensureLocalCopy", () => {
  it("returns the cached entry without downloading", async () => {
    const entry = cachedEntry(H1, "image/png");
    const cache = fakeCache({ [H1]: entry });
    const out = await ensureLocalCopy(
      { label: "L", hash: H1, mediaType: "image", cached: true, available: true },
      cache,
      null
    );
    expect(out).toBe(entry);
    expect(cache.fetchAndCache).not.toHaveBeenCalled();
  });

  it("downloads on miss when a client is present", async () => {
    const cache = fakeCache({});
    const client = {
      getFileMetadata: vi.fn(async (hashes: string[]) =>
        hashes.map((h) => ({ hash: h, mime: "image/png", ext: "png", size: 0, knownTags: [] }))
      ),
    } as unknown as HydrusClient;
    const ref = { label: "L", hash: H1, mediaType: "image" as const, cached: false, available: true };
    const out = await ensureLocalCopy(ref, cache, client);
    expect(cache.fetchAndCache).toHaveBeenCalledTimes(1);
    expect(out.hash).toBe(H1);
  });

  it("throws on miss with null client", async () => {
    await expect(
      ensureLocalCopy(
        { label: "L", hash: H1, mediaType: null, cached: false, available: false },
        fakeCache({}),
        null
      )
    ).rejects.toThrow();
  });
});
