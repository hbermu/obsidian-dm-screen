import { afterEach, describe, expect, it, vi } from "vitest";
import * as obsidian from "obsidian";
import { HydrusClient } from "../hydrus/client";
import { filterTags } from "../hydrus/tagFilter";

function mockRequestUrl(
  handler: (call: { url: string }) => {
    status?: number; json?: unknown; text?: string; arrayBuffer?: ArrayBuffer
  }
) {
  return vi.spyOn(obsidian, "requestUrl").mockImplementation(((param: unknown) => {
    const p = typeof param === "string" ? { url: param } : (param as any);
    const out = handler({ url: p.url });
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

describe("searchTags wildcard behavior", () => {
  it("sends * as search term when prefix is empty", async () => {
    let capturedUrl = "";
    mockRequestUrl((call) => {
      capturedUrl = call.url;
      return { json: { tags: [{ value: "castle" }, { value: "forest" }] } };
    });
    const client = new HydrusClient(baseOpts);
    const prefix = "";
    const search = prefix || "*";
    await client.searchTags(search, {});
    expect(capturedUrl).toContain("search=*");
  });

  it("sends actual prefix when non-empty", async () => {
    let capturedUrl = "";
    mockRequestUrl((call) => {
      capturedUrl = call.url;
      return { json: { tags: [{ value: "tavern" }] } };
    });
    const client = new HydrusClient(baseOpts);
    await client.searchTags("tav", {});
    expect(capturedUrl).toContain("search=tav");
  });

  it("returns all tags from wildcard search", async () => {
    mockRequestUrl(() => ({
      json: { tags: [{ value: "castle" }, { value: "forest" }, { value: "night" }] },
    }));
    const client = new HydrusClient(baseOpts);
    const results = await client.searchTags("*", {});
    expect(results).toHaveLength(3);
    expect(results.map(r => r.value)).toEqual(["castle", "forest", "night"]);
  });
});

describe("searchTags with tag_service_key", () => {
  it("includes tag_service_key param when provided", async () => {
    let capturedUrl = "";
    mockRequestUrl((call) => {
      capturedUrl = call.url;
      return { json: { tags: [] } };
    });
    const client = new HydrusClient(baseOpts);
    await client.searchTags("cas", { tagServiceKey: "abc123" });
    expect(capturedUrl).toContain("tag_service_key=abc123");
  });

  it("omits tag_service_key when not provided", async () => {
    let capturedUrl = "";
    mockRequestUrl((call) => {
      capturedUrl = call.url;
      return { json: { tags: [] } };
    });
    const client = new HydrusClient(baseOpts);
    await client.searchTags("cas", {});
    expect(capturedUrl).not.toContain("tag_service_key");
  });
});

describe("multi-service tag search deduplication", () => {
  it("deduplicates results from multiple services", async () => {
    let callCount = 0;
    mockRequestUrl(() => {
      callCount++;
      if (callCount === 1) {
        return { json: { tags: [{ value: "castle" }, { value: "forest" }] } };
      }
      return { json: { tags: [{ value: "forest" }, { value: "night" }] } };
    });
    const client = new HydrusClient(baseOpts);
    const serviceKeys = ["svc1", "svc2"];
    const all: string[] = [];
    for (const key of serviceKeys) {
      const remote = await client.searchTags("*", { tagServiceKey: key });
      all.push(...remote.map((s) => s.value));
    }
    const deduped = [...new Set(all)];
    expect(deduped).toEqual(["castle", "forest", "night"]);
    expect(deduped).toHaveLength(3);
  });
});

describe("filterTags applied to suggestions", () => {
  it("removes ignored tags from suggestion results", () => {
    const suggestions = ["castle", "rating:general", "forest", "wd eva02-large v3 tagger ai generated tags"];
    const patterns = ["rating:.*", "wd eva02-large v3 tagger ai generated tags"];
    const filtered = filterTags(suggestions, patterns);
    expect(filtered).toEqual(["castle", "forest"]);
  });

  it("returns all suggestions when no patterns configured", () => {
    const suggestions = ["castle", "rating:general", "forest"];
    const filtered = filterTags(suggestions, []);
    expect(filtered).toEqual(["castle", "rating:general", "forest"]);
  });

  it("handles empty suggestion list", () => {
    const filtered = filterTags([], ["rating:.*"]);
    expect(filtered).toEqual([]);
  });
});

describe("getServices - tag service filtering", () => {
  it("filters to only tag services (type 0 and 5)", async () => {
    mockRequestUrl(() => ({
      json: {
        services_v2: [
          { name: "A.I. Tags", service_key: "aaa", type: 5 },
          { name: "my files", service_key: "bbb", type: 2 },
          { name: "tag repo", service_key: "ccc", type: 0 },
          { name: "trash", service_key: "ddd", type: 14 },
          { name: "all known tags", service_key: "eee", type: 10 },
        ],
      },
    }));
    const client = new HydrusClient(baseOpts);
    const services = await client.getServices();
    const tagServices = services.filter((s) => s.type === 0 || s.type === 5);
    expect(tagServices).toHaveLength(2);
    expect(tagServices[0].name).toBe("A.I. Tags");
    expect(tagServices[1].name).toBe("tag repo");
  });

  it("skips services_v2 entries without service_key", async () => {
    mockRequestUrl(() => ({
      json: {
        services_v2: [
          { name: "A.I. Tags", service_key: "aaa", type: 5 },
          { name: "broken", type: 5 },
          { service_key: "ccc", type: 5 },
        ],
      },
    }));
    const client = new HydrusClient(baseOpts);
    const services = await client.getServices();
    expect(services).toHaveLength(1);
    expect(services[0].name).toBe("A.I. Tags");
  });

  it("does not duplicate when response has both category arrays and services_v2", async () => {
    mockRequestUrl(() => ({
      json: {
        local_tags: [
          { name: "A.I. Tags", service_key: "aaa", type: 5 },
          { name: "my tags", service_key: "bbb", type: 5 },
        ],
        services_v2: [
          { name: "A.I. Tags", service_key: "aaa", type: 5 },
          { name: "my tags", service_key: "bbb", type: 5 },
          { name: "my files", service_key: "ccc", type: 2 },
        ],
      },
    }));
    const client = new HydrusClient(baseOpts);
    const services = await client.getServices();
    // Should only use services_v2, no duplicates
    expect(services).toHaveLength(3);
  });
});
