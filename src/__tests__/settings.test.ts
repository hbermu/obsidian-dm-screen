import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../settings";
import type { DmScreenSettings } from "../settings";

describe("DEFAULT_SETTINGS", () => {
  it("has expected server defaults", () => {
    expect(DEFAULT_SETTINGS.serverPort).toBe(3000);
    expect(DEFAULT_SETTINGS.autoStartServer).toBe(false);
    expect(DEFAULT_SETTINGS.maxClients).toBe(10);
  });

  it("has expected grid defaults", () => {
    expect(DEFAULT_SETTINGS.gridColor).toBe("#ffffff");
    expect(DEFAULT_SETTINGS.gridOpacity).toBe(0.3);
    expect(DEFAULT_SETTINGS.tvWidth).toBe(1920);
    expect(DEFAULT_SETTINGS.tvHeight).toBe(1080);
  });

  it("has expected hydrus defaults", () => {
    expect(DEFAULT_SETTINGS.hydrusEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.hydrusApiUrl).toBe("");
    expect(DEFAULT_SETTINGS.hydrusApiKey).toBe("");
    expect(DEFAULT_SETTINGS.hydrusCacheFolder).toBe(".dm-screen/bg");
    expect(DEFAULT_SETTINGS.hydrusCacheTtlDays).toBe(30);
    expect(DEFAULT_SETTINGS.hydrusDefaultLoop).toBe(true);
    expect(DEFAULT_SETTINGS.hydrusDefaultMuted).toBe(true);
    expect(DEFAULT_SETTINGS.hydrusTagServices).toEqual([]);
    expect(DEFAULT_SETTINGS.hydrusAvailableTagServices).toEqual([]);
    expect(DEFAULT_SETTINGS.hydrusDefaultSearchTags).toBe("");
  });

  it("has expected DDB defaults", () => {
    expect(DEFAULT_SETTINGS.ddbEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.ddbCobaltSession).toBe("");
  });

  it("has expected combat tracker scale default", () => {
    expect(DEFAULT_SETTINGS.combatTrackerScale).toBe(1);
  });

  it("has expected debug default", () => {
    expect(DEFAULT_SETTINGS.debugMode).toBe(false);
  });

  it("includes 3 default ignored tag patterns", () => {
    expect(DEFAULT_SETTINGS.hydrusIgnoredTagPatterns).toHaveLength(3);
    expect(DEFAULT_SETTINGS.hydrusIgnoredTagPatterns).toContain("rating:.*");
  });

  it("has empty encounter battlemaps map", () => {
    expect(DEFAULT_SETTINGS.encounterBattlemaps).toEqual({});
  });

  it("has empty persisted player screen state", () => {
    expect(DEFAULT_SETTINGS.lastPlayerScreenWidth).toBe(0);
    expect(DEFAULT_SETTINGS.lastPlayerScreenHeight).toBe(0);
    expect(DEFAULT_SETTINGS.lastImageLayers).toBe("[]");
    expect(DEFAULT_SETTINGS.lastBroadcastCache).toEqual({});
  });
});

describe("Settings merge behavior", () => {
  it("Object.assign preserves defaults for missing keys", () => {
    const saved = { serverPort: 8080 } as Partial<DmScreenSettings>;
    const merged = Object.assign({}, DEFAULT_SETTINGS, saved);
    expect(merged.serverPort).toBe(8080);
    expect(merged.autoStartServer).toBe(false);
    expect(merged.gridColor).toBe("#ffffff");
    expect(merged.hydrusCacheFolder).toBe(".dm-screen/bg");
  });

  it("Object.assign with null returns defaults", () => {
    const merged = Object.assign({}, DEFAULT_SETTINGS, null);
    expect(merged).toEqual(DEFAULT_SETTINGS);
  });

  it("Object.assign with undefined returns defaults", () => {
    const merged = Object.assign({}, DEFAULT_SETTINGS, undefined);
    expect(merged).toEqual(DEFAULT_SETTINGS);
  });

  it("saved encounterBattlemaps overrides completely (not deep merged)", () => {
    const saved = { encounterBattlemaps: { "Fight": "maps/fight.png" } } as Partial<DmScreenSettings>;
    const merged = Object.assign({}, DEFAULT_SETTINGS, saved);
    expect(merged.encounterBattlemaps).toEqual({ "Fight": "maps/fight.png" });
  });

  it("preserves hydrusDefaultSearchTags default when missing from saved data", () => {
    const saved = { hydrusEnabled: true } as Partial<DmScreenSettings>;
    const merged = Object.assign({}, DEFAULT_SETTINGS, saved);
    expect(merged.hydrusDefaultSearchTags).toBe("");
  });

  it("saved hydrusDefaultSearchTags overrides default", () => {
    const saved = {
      hydrusDefaultSearchTags: "tavern, night",
    } as Partial<DmScreenSettings>;
    const merged = Object.assign({}, DEFAULT_SETTINGS, saved);
    expect(merged.hydrusDefaultSearchTags).toBe("tavern, night");
  });
});

describe("Settings input validation logic", () => {
  describe("port parsing", () => {
    it("parseInt coerces valid port string", () => {
      expect(parseInt("8080") || 3000).toBe(8080);
    });

    it("parseInt fallback for non-numeric string", () => {
      expect(parseInt("abc") || 3000).toBe(3000);
    });

    it("parseInt fallback for empty string", () => {
      expect(parseInt("") || 3000).toBe(3000);
    });

    it("parseInt handles zero (falsy) — falls back to default", () => {
      expect(parseInt("0") || 3000).toBe(3000);
    });
  });

  describe("opacity parsing", () => {
    it("parseFloat coerces valid opacity", () => {
      expect(parseFloat("0.5") || 0.3).toBe(0.5);
    });

    it("parseFloat fallback for invalid string", () => {
      expect(parseFloat("not-a-number") || 0.3).toBe(0.3);
    });

    it("parseFloat handles 0 — falls back to default", () => {
      expect(parseFloat("0") || 0.3).toBe(0.3);
    });

    it("parseFloat preserves 1.0", () => {
      expect(parseFloat("1.0") || 0.3).toBe(1.0);
    });
  });

  describe("cache TTL parsing", () => {
    it("valid integer remains", () => {
      const n = parseInt("14", 10);
      expect(Number.isFinite(n) && n > 0 ? n : 30).toBe(14);
    });

    it("non-numeric falls back to 30", () => {
      const n = parseInt("abc", 10);
      expect(Number.isFinite(n) && n > 0 ? n : 30).toBe(30);
    });

    it("zero falls back to 30", () => {
      const n = parseInt("0", 10);
      expect(Number.isFinite(n) && n > 0 ? n : 30).toBe(30);
    });

    it("negative falls back to 30", () => {
      const n = parseInt("-5", 10);
      expect(Number.isFinite(n) && n > 0 ? n : 30).toBe(30);
    });
  });

  describe("cache folder validation", () => {
    it("rejects paths containing '..'", () => {
      const value = "../etc/secret";
      const normalized = value.trim().replace(/^\/+|\/+$/g, "");
      expect(normalized.includes("..")).toBe(true);
    });

    it("accepts normal relative paths", () => {
      const value = ".dm-screen/bg";
      const normalized = value.trim().replace(/^\/+|\/+$/g, "");
      expect(normalized.includes("..")).toBe(false);
      expect(normalized).toBe(".dm-screen/bg");
    });

    it("strips leading and trailing slashes", () => {
      const value = "/some/path/";
      const normalized = value.trim().replace(/^\/+|\/+$/g, "");
      expect(normalized).toBe("some/path");
    });

    it("empty input falls back to default", () => {
      const value = "   ";
      const normalized = value.trim().replace(/^\/+|\/+$/g, "");
      expect(normalized || ".dm-screen/bg").toBe(".dm-screen/bg");
    });
  });

  describe("API URL normalization", () => {
    it("strips trailing slashes", () => {
      const value = "http://hydrus.local:45869///";
      expect(value.replace(/\/+$/, "")).toBe("http://hydrus.local:45869");
    });

    it("no-op when no trailing slash", () => {
      const value = "http://hydrus.local:45869";
      expect(value.replace(/\/+$/, "")).toBe("http://hydrus.local:45869");
    });
  });

  describe("API key normalization", () => {
    it("trims whitespace", () => {
      expect("  abc123  ".trim()).toBe("abc123");
    });
  });

  describe("ignored tag patterns parsing", () => {
    it("splits by newline, trims, and filters empty", () => {
      const value = "rating:.*\n\n  wd tagger \n";
      const result = value
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      expect(result).toEqual(["rating:.*", "wd tagger"]);
    });

    it("handles single line", () => {
      const value = "pattern";
      const result = value.split("\n").map(l => l.trim()).filter(l => l.length > 0);
      expect(result).toEqual(["pattern"]);
    });

    it("handles empty input", () => {
      const value = "";
      const result = value.split("\n").map(l => l.trim()).filter(l => l.length > 0);
      expect(result).toEqual([]);
    });
  });

  describe("tag service migration", () => {
    it("migrates old single service to new array format", () => {
      const available = [
        { name: "A.I. Tags", key: "abc123", type: 0 },
        { name: "My Tags", key: "def456", type: 5 },
      ];
      const oldService = "A.I. Tags";
      const currentServices: string[] = [];

      // Simulate migration logic
      if (oldService && currentServices.length === 0) {
        const match = available.find(s => s.name === oldService);
        if (match) {
          currentServices.push(match.key);
        }
      }

      expect(currentServices).toEqual(["abc123"]);
    });

    it("skips migration when services already selected", () => {
      const available = [{ name: "A.I. Tags", key: "abc123", type: 0 }];
      const oldService = "A.I. Tags";
      const currentServices = ["xyz789"];

      if (oldService && currentServices.length === 0) {
        const match = available.find(s => s.name === oldService);
        if (match) currentServices.push(match.key);
      }

      expect(currentServices).toEqual(["xyz789"]); // not modified
    });

    it("handles migration when old service name not found in available", () => {
      const available = [{ name: "Other Tags", key: "xyz", type: 0 }];
      const oldService = "Deleted Service";
      const currentServices: string[] = [];

      if (oldService && currentServices.length === 0) {
        const match = available.find(s => s.name === oldService);
        if (match) currentServices.push(match.key);
      }

      expect(currentServices).toEqual([]);
    });
  });

  describe("maxClients parsing", () => {
    it("valid number is preserved", () => {
      expect(parseInt("5") || 10).toBe(5);
    });

    it("invalid string falls back to 10", () => {
      expect(parseInt("nope") || 10).toBe(10);
    });
  });
});
