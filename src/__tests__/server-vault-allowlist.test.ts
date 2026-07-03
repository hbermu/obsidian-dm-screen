import { describe, expect, it } from "vitest";
import { vaultPathFromUrl, VaultServeAllowlist } from "../server";

describe("vaultPathFromUrl", () => {
  it("decodes a simple vault URL", () => {
    expect(vaultPathFromUrl("/vault/foo.png")).toBe("foo.png");
  });

  it("decodes percent-encoded spaces", () => {
    expect(vaultPathFromUrl("/vault/My%20Folder/a.png")).toBe("My Folder/a.png");
  });

  it("decodes %2F to a literal slash (traversal guard handles abuse separately)", () => {
    expect(vaultPathFromUrl("/vault/foo%2Fbar.png")).toBe("foo/bar.png");
  });

  it("decodes nested paths", () => {
    expect(vaultPathFromUrl("/vault/.dm-screen/hydrus/ab/cd/ef.png")).toBe(
      ".dm-screen/hydrus/ab/cd/ef.png"
    );
  });

  it("returns null for data: URLs", () => {
    expect(vaultPathFromUrl("data:image/png;base64,AAAA")).toBeNull();
  });

  it("returns null for http/https URLs", () => {
    expect(vaultPathFromUrl("http://example.com/x")).toBeNull();
    expect(vaultPathFromUrl("https://example.com/x")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(vaultPathFromUrl("")).toBeNull();
  });

  it("returns null for non-string input", () => {
    expect(vaultPathFromUrl(123)).toBeNull();
    expect(vaultPathFromUrl(null)).toBeNull();
    expect(vaultPathFromUrl(undefined)).toBeNull();
    expect(vaultPathFromUrl({ url: "/vault/x" })).toBeNull();
  });

  it("returns null for non-/vault/ paths", () => {
    expect(vaultPathFromUrl("/health")).toBeNull();
    expect(vaultPathFromUrl("/")).toBeNull();
    expect(vaultPathFromUrl("/vault")).toBeNull();
  });

  it("returns null for malformed percent-encoding", () => {
    expect(vaultPathFromUrl("/vault/%E0%A4%A")).toBeNull();
    expect(vaultPathFromUrl("/vault/%ZZ")).toBeNull();
  });

  it("returns the empty path for /vault/ alone", () => {
    expect(vaultPathFromUrl("/vault/")).toBe("");
  });
});

describe("VaultServeAllowlist", () => {
  describe("deny by default", () => {
    it("rejects anything when no broadcasts have been observed", () => {
      const allow = new VaultServeAllowlist();
      expect(allow.isAllowed("foo.png")).toBe(false);
      expect(allow.isAllowed("")).toBe(false);
      expect(allow.isAllowed(".obsidian/plugins/dm-screen/data.json")).toBe(false);
    });

    it("snapshot is empty by default", () => {
      const allow = new VaultServeAllowlist();
      expect(allow.snapshot()).toEqual({ background: null, map: null, layers: [] });
    });
  });

  describe("show-background-media", () => {
    it("allows a /vault/ background after observe", () => {
      const allow = new VaultServeAllowlist();
      allow.observe({ type: "show-background-media", payload: { url: "/vault/bg.webm" } });
      expect(allow.isAllowed("bg.webm")).toBe(true);
      expect(allow.isAllowed("other.png")).toBe(false);
    });

    it("replaces the previous background", () => {
      const allow = new VaultServeAllowlist();
      allow.observe({ type: "show-background-media", payload: { url: "/vault/a.png" } });
      allow.observe({ type: "show-background-media", payload: { url: "/vault/b.png" } });
      expect(allow.isAllowed("a.png")).toBe(false);
      expect(allow.isAllowed("b.png")).toBe(true);
    });

    it("clears the background when payload.url is a data: URL", () => {
      const allow = new VaultServeAllowlist();
      allow.observe({ type: "show-background-media", payload: { url: "/vault/a.png" } });
      allow.observe({
        type: "show-background-media",
        payload: { url: "data:image/png;base64,AAAA" },
      });
      expect(allow.isAllowed("a.png")).toBe(false);
      expect(allow.snapshot().background).toBeNull();
    });

    it("clears the background when payload.url is missing or non-string", () => {
      const allow = new VaultServeAllowlist();
      allow.observe({ type: "show-background-media", payload: { url: "/vault/a.png" } });
      allow.observe({ type: "show-background-media", payload: {} });
      expect(allow.snapshot().background).toBeNull();
    });
  });

  describe("hide-background-media", () => {
    it("clears the background but leaves layers intact", () => {
      const allow = new VaultServeAllowlist();
      allow.observe({ type: "show-background-media", payload: { url: "/vault/bg.webm" } });
      allow.observe({
        type: "image-layers-sync",
        payload: { layers: [{ dataUrl: "/vault/a.png", fogDataUrl: "data:" }] },
      });
      allow.observe({ type: "hide-background-media", payload: {} });
      expect(allow.isAllowed("bg.webm")).toBe(false);
      expect(allow.isAllowed("a.png")).toBe(true);
    });
  });

  describe("image-layers-sync", () => {
    it("collects /vault/ paths from both dataUrl and fogDataUrl", () => {
      const allow = new VaultServeAllowlist();
      allow.observe({
        type: "image-layers-sync",
        payload: {
          layers: [
            { dataUrl: "/vault/a.png", fogDataUrl: "/vault/a-fog.png" },
            { dataUrl: "/vault/b.png", fogDataUrl: "/vault/b-fog.png" },
          ],
        },
      });
      expect(allow.isAllowed("a.png")).toBe(true);
      expect(allow.isAllowed("a-fog.png")).toBe(true);
      expect(allow.isAllowed("b.png")).toBe(true);
      expect(allow.isAllowed("b-fog.png")).toBe(true);
    });

    it("ignores data: dataUrl but admits a /vault/ fogDataUrl", () => {
      const allow = new VaultServeAllowlist();
      allow.observe({
        type: "image-layers-sync",
        payload: {
          layers: [
            { dataUrl: "data:image/png;base64,AAAA", fogDataUrl: "/vault/fog.png" },
          ],
        },
      });
      expect(allow.isAllowed("fog.png")).toBe(true);
      expect(allow.snapshot().layers).toEqual(["fog.png"]);
    });

    it("yields an empty layer set when all URLs are data: URLs", () => {
      const allow = new VaultServeAllowlist();
      allow.observe({
        type: "image-layers-sync",
        payload: {
          layers: [
            { dataUrl: "data:image/png;base64,AAAA", fogDataUrl: "data:image/png;base64,BBBB" },
          ],
        },
      });
      expect(allow.snapshot().layers).toEqual([]);
    });

    it("replaces the previous layer set rather than accumulating", () => {
      const allow = new VaultServeAllowlist();
      allow.observe({
        type: "image-layers-sync",
        payload: { layers: [{ dataUrl: "/vault/old.png", fogDataUrl: "data:" }] },
      });
      allow.observe({
        type: "image-layers-sync",
        payload: { layers: [{ dataUrl: "/vault/new.png", fogDataUrl: "data:" }] },
      });
      expect(allow.isAllowed("old.png")).toBe(false);
      expect(allow.isAllowed("new.png")).toBe(true);
    });

    it("leaves the background intact when layers are emptied", () => {
      const allow = new VaultServeAllowlist();
      allow.observe({ type: "show-background-media", payload: { url: "/vault/bg.webm" } });
      allow.observe({ type: "image-layers-sync", payload: { layers: [] } });
      expect(allow.isAllowed("bg.webm")).toBe(true);
    });

    it("tolerates a missing or non-array layers field", () => {
      const allow = new VaultServeAllowlist();
      allow.observe({ type: "image-layers-sync", payload: {} });
      expect(allow.snapshot().layers).toEqual([]);
      allow.observe({ type: "image-layers-sync", payload: { layers: "nope" as unknown as [] } });
      expect(allow.snapshot().layers).toEqual([]);
    });
  });

  describe("union semantics", () => {
    it("allows both background and layer paths simultaneously", () => {
      const allow = new VaultServeAllowlist();
      allow.observe({ type: "show-background-media", payload: { url: "/vault/bg.webm" } });
      allow.observe({
        type: "image-layers-sync",
        payload: { layers: [{ dataUrl: "/vault/a.png", fogDataUrl: "data:" }] },
      });
      expect(allow.isAllowed("bg.webm")).toBe(true);
      expect(allow.isAllowed("a.png")).toBe(true);
    });
  });

  describe("clear", () => {
    it("empties both background and layers", () => {
      const allow = new VaultServeAllowlist();
      allow.observe({ type: "show-background-media", payload: { url: "/vault/bg.webm" } });
      allow.observe({
        type: "image-layers-sync",
        payload: { layers: [{ dataUrl: "/vault/a.png", fogDataUrl: "data:" }] },
      });
      allow.observe({ type: "clear", payload: {} });
      expect(allow.isAllowed("bg.webm")).toBe(false);
      expect(allow.isAllowed("a.png")).toBe(false);
      expect(allow.snapshot()).toEqual({ background: null, map: null, layers: [] });
    });
  });

  describe("unrelated messages", () => {
    it("leaves state untouched on unknown message types", () => {
      const allow = new VaultServeAllowlist();
      allow.observe({ type: "show-background-media", payload: { url: "/vault/bg.webm" } });
      allow.observe({ type: "initiative-update", payload: { combatants: [], round: 0 } });
      allow.observe({ type: "ping", payload: { n: 1 } });
      expect(allow.isAllowed("bg.webm")).toBe(true);
    });
  });
});
