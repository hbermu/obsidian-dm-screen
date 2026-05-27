import { afterEach, describe, expect, it, vi } from "vitest";
import * as obsidian from "obsidian";
import { HydrusClient, extFromMime } from "../hydrus/client";

interface CapturedCall {
  url: string;
  method?: string;
  headers?: Record<string, string>;
}

function mockRequestUrl(
  handler: (call: CapturedCall) => { status?: number; json?: unknown; text?: string; arrayBuffer?: ArrayBuffer }
) {
  return vi.spyOn(obsidian, "requestUrl").mockImplementation(((param: unknown) => {
    const p = typeof param === "string" ? { url: param } : (param as { url: string; method?: string; headers?: Record<string, string> });
    const out = handler({ url: p.url, method: p.method, headers: p.headers });
    return Promise.resolve({
      status: out.status ?? 200,
      json: out.json ?? {},
      text: out.text ?? "",
      arrayBuffer: out.arrayBuffer ?? new ArrayBuffer(0),
      headers: {},
    });
  }) as unknown as typeof obsidian.requestUrl);
}

const baseOpts = { baseUrl: "https://hydrus-api.test", apiKey: "deadbeef" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HydrusClient", () => {
  it("verifyAccess hits /verify_access_key with auth header", async () => {
    let captured: CapturedCall | undefined;
    mockRequestUrl((call) => {
      captured = call;
      return { json: { basic_permissions: [0, 1], human_description: "ok" } };
    });
    const client = new HydrusClient(baseOpts);
    const info = await client.verifyAccess();
    expect(info.human_description).toBe("ok");
    expect(captured?.url).toBe("https://hydrus-api.test/verify_access_key");
    expect(captured?.headers?.["Hydrus-Client-API-Access-Key"]).toBe("deadbeef");
  });

  it("searchFiles JSON-encodes the tags array and includes system:limit", async () => {
    let captured: CapturedCall | undefined;
    mockRequestUrl((call) => {
      captured = call;
      return { json: { hashes: ["abc", "def"] } };
    });
    const client = new HydrusClient(baseOpts);
    const result = await client.searchFiles(["czepeku", "tavern night"], 50);
    expect(result.hashes).toEqual(["abc", "def"]);
    const u = new URL(captured!.url);
    expect(u.pathname).toBe("/get_files/search_files");
    expect(JSON.parse(u.searchParams.get("tags") ?? "[]")).toEqual([
      "czepeku",
      "tavern night",
      "system:limit=50",
    ]);
    expect(u.searchParams.get("return_hashes")).toBe("true");
  });

  it("searchFiles without limit omits the system:limit tag", async () => {
    let captured: CapturedCall | undefined;
    mockRequestUrl((call) => {
      captured = call;
      return { json: { hashes: [] } };
    });
    const client = new HydrusClient(baseOpts);
    await client.searchFiles(["tavern"]);
    const tags = JSON.parse(new URL(captured!.url).searchParams.get("tags") ?? "[]");
    expect(tags).toEqual(["tavern"]);
  });

  it("getFileMetadata maps Hydrus rows to flat HydrusFile and picks tags from the chosen service", async () => {
    mockRequestUrl(() => ({
      json: {
        metadata: [
          {
            hash: "h1",
            mime: "image/png",
            ext: ".png",
            width: 1920,
            height: 1080,
            size: 12345,
            tags: {
              "svc-ai": {
                name: "A.I. Tags",
                storage_tags: { "0": ["tavern", "night"] },
              },
              "svc-other": {
                name: "other",
                storage_tags: { "0": ["ignored"] },
              },
            },
          },
        ],
      },
    }));
    const client = new HydrusClient(baseOpts);
    const files = await client.getFileMetadata(["h1"], "A.I. Tags");
    expect(files).toHaveLength(1);
    expect(files[0].knownTags.sort()).toEqual(["night", "tavern"]);
    expect(files[0].ext).toBe("png");
    expect(files[0].width).toBe(1920);
  });

  it("getFileBytes returns the raw arrayBuffer for /get_files/file", async () => {
    const buf = new TextEncoder().encode("BINARYDATA").buffer;
    let captured: CapturedCall | undefined;
    mockRequestUrl((call) => {
      captured = call;
      return { arrayBuffer: buf };
    });
    const client = new HydrusClient(baseOpts);
    const out = await client.getFileBytes("abcd");
    expect(out.byteLength).toBe(buf.byteLength);
    expect(captured?.url).toBe("https://hydrus-api.test/get_files/file?hash=abcd");
  });

  it("searchTags hits /add_tags/search_tags with the service key and slices to the requested limit", async () => {
    let captured: CapturedCall | undefined;
    mockRequestUrl((call) => {
      captured = call;
      return {
        json: {
          tags: [
            { value: "tavern", count: 12 },
            { value: "tavern night", count: 4 },
            { value: "tavern day", count: 2 },
          ],
        },
      };
    });
    const client = new HydrusClient(baseOpts);
    const out = await client.searchTags("tav", { tagServiceKey: "KEY", limit: 2 });
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ value: "tavern", count: 12 });
    const u = new URL(captured!.url);
    expect(u.pathname).toBe("/add_tags/search_tags");
    expect(u.searchParams.get("search")).toBe("tav");
    expect(u.searchParams.get("tag_service_key")).toBe("KEY");
    expect(captured?.headers?.["Hydrus-Client-API-Access-Key"]).toBe("deadbeef");
  });

  it("searchTags returns an empty array when Hydrus omits the tags field", async () => {
    mockRequestUrl(() => ({ json: {} }));
    const client = new HydrusClient(baseOpts);
    expect(await client.searchTags("zzz")).toEqual([]);
  });

  it("throws with a useful message on non-2xx", async () => {
    mockRequestUrl(() => ({ status: 401, text: "Bad key" }));
    const client = new HydrusClient(baseOpts);
    await expect(client.verifyAccess()).rejects.toThrow(/401.*Bad key/);
  });

  it("requires baseUrl and apiKey", () => {
    expect(() => new HydrusClient({ baseUrl: "", apiKey: "x" })).toThrow(/baseUrl/);
    expect(() => new HydrusClient({ baseUrl: "x", apiKey: "" })).toThrow(/apiKey/);
  });

  it("extFromMime handles common mimes and falls back to bin", () => {
    expect(extFromMime("image/png")).toBe("png");
    expect(extFromMime("video/mp4")).toBe("mp4");
    expect(extFromMime("application/x-unknown")).toBe("bin");
  });
});
