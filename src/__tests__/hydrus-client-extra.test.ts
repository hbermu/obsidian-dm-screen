import { afterEach, describe, expect, it, vi } from "vitest";
import * as obsidian from "obsidian";
import { HydrusClient, extFromMime } from "../hydrus/client";

function mockRequestUrl(
  handler: (call: { url: string; method?: string; headers?: Record<string, string> }) => {
    status?: number; json?: unknown; text?: string; arrayBuffer?: ArrayBuffer
  }
) {
  return vi.spyOn(obsidian, "requestUrl").mockImplementation(((param: unknown) => {
    const p = typeof param === "string" ? { url: param } : (param as any);
    const out = handler({ url: p.url, method: p.method, headers: p.headers });
    return Promise.resolve({
      status: out.status ?? 200,
      json: out.json ?? {},
      text: out.text ?? "",
      arrayBuffer: out.arrayBuffer ?? new ArrayBuffer(0),
      headers: {},
    });
  }) as any);
}

const baseOpts = { baseUrl: "https://hydrus.test", apiKey: "key123" };

afterEach(() => { vi.restoreAllMocks(); });

describe("extFromMime - extended coverage", () => {
  const cases: [string, string][] = [
    ["image/jpeg", "jpg"],
    ["image/jpg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
    ["image/gif", "gif"],
    ["image/apng", "apng"],
    ["image/avif", "avif"],
    ["image/x-icon", "ico"],
    ["image/heic", "heic"],
    ["image/heif", "heif"],
    ["image/bmp", "bmp"],
    ["image/tiff", "tiff"],
    ["video/mp4", "mp4"],
    ["video/webm", "webm"],
    ["video/quicktime", "mov"],
    ["video/x-matroska", "mkv"],
    ["video/x-msvideo", "avi"],
    ["application/pdf", "bin"],
    ["text/plain", "bin"],
    ["", "bin"],
  ];

  for (const [mime, expected] of cases) {
    it(`${mime || "(empty)"} → ${expected}`, () => {
      expect(extFromMime(mime)).toBe(expected);
    });
  }

  it("is case-insensitive", () => {
    expect(extFromMime("IMAGE/PNG")).toBe("png");
    expect(extFromMime("Video/WebM")).toBe("webm");
  });
});

describe("HydrusClient.getFileMetadata - tag extraction", () => {
  it("falls back to union of all services when tagService is not specified", async () => {
    mockRequestUrl(() => ({
      json: {
        metadata: [{
          hash: "h1",
          mime: "image/png",
          ext: ".png",
          size: 100,
          tags: {
            "svc-a": {
              name: "Service A",
              storage_tags: { "0": ["tag-a1", "tag-a2"] },
            },
            "svc-b": {
              name: "Service B",
              storage_tags: { "0": ["tag-b1"] },
            },
          },
        }],
      },
    }));
    const client = new HydrusClient(baseOpts);
    const files = await client.getFileMetadata(["h1"]);
    expect(files[0].knownTags.sort()).toEqual(["tag-a1", "tag-a2", "tag-b1"]);
  });

  it("deduplicates tags across services in union mode", async () => {
    mockRequestUrl(() => ({
      json: {
        metadata: [{
          hash: "h1",
          mime: "image/png",
          ext: ".png",
          size: 100,
          tags: {
            "svc-a": { name: "A", storage_tags: { "0": ["common", "unique-a"] } },
            "svc-b": { name: "B", storage_tags: { "0": ["common", "unique-b"] } },
          },
        }],
      },
    }));
    const client = new HydrusClient(baseOpts);
    const files = await client.getFileMetadata(["h1"]);
    expect(files[0].knownTags.sort()).toEqual(["common", "unique-a", "unique-b"]);
  });

  it("returns empty tags when metadata has no tags field", async () => {
    mockRequestUrl(() => ({
      json: {
        metadata: [{
          hash: "h1",
          mime: "image/png",
          ext: ".png",
          size: 100,
        }],
      },
    }));
    const client = new HydrusClient(baseOpts);
    const files = await client.getFileMetadata(["h1"]);
    expect(files[0].knownTags).toEqual([]);
  });

  it("falls back to union when requested service is not found", async () => {
    mockRequestUrl(() => ({
      json: {
        metadata: [{
          hash: "h1",
          mime: "image/png",
          ext: ".png",
          size: 100,
          tags: {
            "svc-a": { name: "Other Service", storage_tags: { "0": ["tag1"] } },
          },
        }],
      },
    }));
    const client = new HydrusClient(baseOpts);
    const files = await client.getFileMetadata(["h1"], "Missing Service");
    // Falls through to union of all services
    expect(files[0].knownTags).toEqual(["tag1"]);
  });

  it("returns only the active tag bucket (status 0), ignoring tombstones and pending", async () => {
    mockRequestUrl(() => ({
      json: {
        metadata: [{
          hash: "h1",
          mime: "image/png",
          ext: ".png",
          size: 100,
          tags: {
            "svc-a": {
              name: "Target",
              storage_tags: {
                "0": ["current-tag"],
                "1": ["pending-tag"],
                "2": ["deleted-tag"],
              },
            },
          },
        }],
      },
    }));
    const client = new HydrusClient(baseOpts);
    const files = await client.getFileMetadata(["h1"], "Target");
    expect(files[0].knownTags).toEqual(["current-tag"]);
  });

  it("returns empty array when called with empty hashes", async () => {
    const spy = mockRequestUrl(() => ({ json: {} }));
    const client = new HydrusClient(baseOpts);
    const files = await client.getFileMetadata([]);
    expect(files).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("strips leading dot from ext", async () => {
    mockRequestUrl(() => ({
      json: {
        metadata: [{
          hash: "h1",
          mime: "image/png",
          ext: ".png",
          size: 100,
          tags: {},
        }],
      },
    }));
    const client = new HydrusClient(baseOpts);
    const files = await client.getFileMetadata(["h1"]);
    expect(files[0].ext).toBe("png");
  });

  it("falls back to extFromMime when ext is empty", async () => {
    mockRequestUrl(() => ({
      json: {
        metadata: [{
          hash: "h1",
          mime: "video/webm",
          ext: "",
          size: 100,
          tags: {},
        }],
      },
    }));
    const client = new HydrusClient(baseOpts);
    const files = await client.getFileMetadata(["h1"]);
    expect(files[0].ext).toBe("webm");
  });
});

describe("HydrusClient.getServices", () => {
  it("returns flattened services array from services_v2", async () => {
    mockRequestUrl(() => ({
      json: {
        "local_tags": [
          { name: "all known tags", type: 5, service_key: "abc" },
        ],
        "services_v2": [
          { name: "all known tags", type: 5, service_key: "abc" },
          { name: "my tags", type: 0, service_key: "def" },
        ],
      },
    }));
    const client = new HydrusClient(baseOpts);
    const services = await client.getServices();
    expect(services).toHaveLength(2);
    expect(services[0].name).toBe("all known tags");
    expect(services[1].service_key).toBe("def");
  });

  it("falls back to legacy services dict when services_v2 missing", async () => {
    mockRequestUrl(() => ({
      json: {
        "services": {
          "abc": { name: "local tags", type: 5 },
          "def": { name: "my repo", type: 0 },
        },
      },
    }));
    const client = new HydrusClient(baseOpts);
    const services = await client.getServices();
    expect(services).toHaveLength(2);
    expect(services[0].service_key).toBe("abc");
    expect(services[1].name).toBe("my repo");
  });

  it("returns empty array when services field is missing", async () => {
    mockRequestUrl(() => ({ json: {} }));
    const client = new HydrusClient(baseOpts);
    const services = await client.getServices();
    expect(services).toEqual([]);
  });
});

describe("HydrusClient.getThumbnailBytes", () => {
  it("requests the correct endpoint", async () => {
    let captured: { url: string } | undefined;
    const buf = new ArrayBuffer(16);
    mockRequestUrl((call) => { captured = call; return { arrayBuffer: buf }; });
    const client = new HydrusClient(baseOpts);
    const result = await client.getThumbnailBytes("abc123");
    expect(captured?.url).toBe("https://hydrus.test/get_files/thumbnail?hash=abc123");
    expect(result.byteLength).toBe(16);
  });
});
