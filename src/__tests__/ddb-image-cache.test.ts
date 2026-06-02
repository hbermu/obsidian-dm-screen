import { describe, it, expect, vi, beforeEach } from "vitest";
import { DdbImageCache } from "../dndbeyond/imageCache";
import type { VaultAdapterLike } from "../hydrus/cache";

vi.mock("obsidian", () => ({
  requestUrl: vi.fn(),
}));

import { requestUrl } from "obsidian";

function makeAdapter(): VaultAdapterLike & { files: Map<string, string | ArrayBuffer> } {
  const files = new Map<string, string | ArrayBuffer>();
  return {
    files,
    exists: vi.fn(async (p: string) => files.has(p)),
    read: vi.fn(async (p: string) => files.get(p) as string),
    write: vi.fn(async (p: string, data: string) => { files.set(p, data); }),
    writeBinary: vi.fn(async (p: string, data: ArrayBuffer) => { files.set(p, data); }),
    remove: vi.fn(async (p: string) => { files.delete(p); }),
    mkdir: vi.fn(async () => {}),
  };
}

describe("DdbImageCache", () => {
  let adapter: ReturnType<typeof makeAdapter>;
  let cache: DdbImageCache;

  beforeEach(() => {
    adapter = makeAdapter();
    cache = new DdbImageCache(".dm-screen/beyond", adapter, 30);
    vi.mocked(requestUrl).mockReset();
  });

  it("downloads an image and stores in index", async () => {
    const fakeImage = new ArrayBuffer(64);
    vi.mocked(requestUrl).mockResolvedValue({
      status: 200,
      arrayBuffer: fakeImage,
    } as never);

    const path = await cache.getOrDownload(123, "https://cdn.example.com/img/123.jpeg", "Goblin");

    expect(path).toBe(".dm-screen/beyond/123.jpeg");
    expect(adapter.files.has(path)).toBe(true);
    expect(requestUrl).toHaveBeenCalledOnce();

    const index = JSON.parse(adapter.files.get(".dm-screen/beyond/index.json") as string);
    expect(index.entries["123"].monsterId).toBe(123);
    expect(index.entries["123"].name).toBe("Goblin");
    expect(index.entries["123"].lastUsedAt).toBeGreaterThan(0);
  });

  it("returns cached path without downloading again", async () => {
    const fakeImage = new ArrayBuffer(64);
    vi.mocked(requestUrl).mockResolvedValue({ status: 200, arrayBuffer: fakeImage } as never);

    await cache.getOrDownload(123, "https://cdn.example.com/img/123.jpeg", "Goblin");
    vi.mocked(requestUrl).mockReset();

    const path = await cache.getOrDownload(123, "https://cdn.example.com/img/123.jpeg", "Goblin");

    expect(path).toBe(".dm-screen/beyond/123.jpeg");
    expect(requestUrl).not.toHaveBeenCalled();
  });

  it("updates lastUsedAt on cache hit", async () => {
    const fakeImage = new ArrayBuffer(64);
    vi.mocked(requestUrl).mockResolvedValue({ status: 200, arrayBuffer: fakeImage } as never);

    await cache.getOrDownload(123, "https://cdn.example.com/img/123.jpeg", "Goblin");
    const index1 = JSON.parse(adapter.files.get(".dm-screen/beyond/index.json") as string);
    const firstUsedAt = index1.entries["123"].lastUsedAt;

    // Simulate time passing
    vi.spyOn(Date, "now").mockReturnValue(firstUsedAt + 10000);
    await cache.getOrDownload(123, "https://cdn.example.com/img/123.jpeg", "Goblin");

    const index2 = JSON.parse(adapter.files.get(".dm-screen/beyond/index.json") as string);
    expect(index2.entries["123"].lastUsedAt).toBe(firstUsedAt + 10000);
    vi.restoreAllMocks();
  });

  it("sweep removes stale entries", async () => {
    const fakeImage = new ArrayBuffer(64);
    vi.mocked(requestUrl).mockResolvedValue({ status: 200, arrayBuffer: fakeImage } as never);

    // Download an image
    await cache.getOrDownload(456, "https://cdn.example.com/img/456.png", "Dragon");

    // Backdate the lastUsedAt to 60 days ago
    const index = JSON.parse(adapter.files.get(".dm-screen/beyond/index.json") as string);
    index.entries["456"].lastUsedAt = Date.now() - 60 * 24 * 60 * 60 * 1000;
    adapter.files.set(".dm-screen/beyond/index.json", JSON.stringify(index));

    // Create a fresh cache instance to reload the index
    const cache2 = new DdbImageCache(".dm-screen/beyond", adapter, 30);
    const swept = await cache2.sweep();

    expect(swept).toBe(1);
    expect(adapter.files.has(".dm-screen/beyond/456.png")).toBe(false);
  });

  it("sweep keeps fresh entries", async () => {
    const fakeImage = new ArrayBuffer(64);
    vi.mocked(requestUrl).mockResolvedValue({ status: 200, arrayBuffer: fakeImage } as never);

    await cache.getOrDownload(789, "https://cdn.example.com/img/789.webp", "Skeleton");
    const swept = await cache.sweep();

    expect(swept).toBe(0);
    expect(adapter.files.has(".dm-screen/beyond/789.webp")).toBe(true);
  });

  it("handles download failure gracefully", async () => {
    vi.mocked(requestUrl).mockResolvedValue({ status: 404 } as never);

    await expect(
      cache.getOrDownload(999, "https://cdn.example.com/img/999.jpeg", "Missing")
    ).rejects.toThrow("Failed to download monster image (404)");
  });

  it("extracts extension from URL", async () => {
    const fakeImage = new ArrayBuffer(64);
    vi.mocked(requestUrl).mockResolvedValue({ status: 200, arrayBuffer: fakeImage } as never);

    const path = await cache.getOrDownload(111, "https://cdn.example.com/avatars/111.png?v=2", "Orc");
    expect(path).toBe(".dm-screen/beyond/111.png");
  });
});
