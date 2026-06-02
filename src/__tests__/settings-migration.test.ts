import { describe, expect, it } from "vitest";
import { migrateLegacyCacheFolder } from "../main";

describe("migrateLegacyCacheFolder", () => {
  it("strips a trailing /bg from the legacy default", () => {
    const { data, changed } = migrateLegacyCacheFolder({
      hydrusCacheFolder: ".dm-screen/bg",
      serverPort: 3000,
    });
    expect(changed).toBe(true);
    expect(data.cacheBaseFolder).toBe(".dm-screen");
    expect("hydrusCacheFolder" in data).toBe(false);
    expect(data.serverPort).toBe(3000);
  });

  it("keeps a legacy folder that has no /bg suffix", () => {
    const { data, changed } = migrateLegacyCacheFolder({
      hydrusCacheFolder: ".dm-screen",
    });
    expect(changed).toBe(true);
    expect(data.cacheBaseFolder).toBe(".dm-screen");
    expect("hydrusCacheFolder" in data).toBe(false);
  });

  it("strips /bg from a custom path", () => {
    const { data, changed } = migrateLegacyCacheFolder({
      hydrusCacheFolder: "custom/path/bg",
    });
    expect(changed).toBe(true);
    expect(data.cacheBaseFolder).toBe("custom/path");
  });

  it("strips a leading /hydrus suffix too", () => {
    const { data, changed } = migrateLegacyCacheFolder({
      hydrusCacheFolder: ".dm-screen/hydrus",
    });
    expect(changed).toBe(true);
    expect(data.cacheBaseFolder).toBe(".dm-screen");
  });

  it("falls back to .dm-screen when the legacy value is empty", () => {
    const { data, changed } = migrateLegacyCacheFolder({
      hydrusCacheFolder: "",
    });
    expect(changed).toBe(true);
    expect(data.cacheBaseFolder).toBe(".dm-screen");
  });

  it("preserves an existing cacheBaseFolder when both fields are present", () => {
    const { data, changed } = migrateLegacyCacheFolder({
      hydrusCacheFolder: ".dm-screen/bg",
      cacheBaseFolder: "user/chosen",
    });
    expect(changed).toBe(true);
    expect(data.cacheBaseFolder).toBe("user/chosen");
    expect("hydrusCacheFolder" in data).toBe(false);
  });

  it("is a no-op when no legacy field is present", () => {
    const input = { cacheBaseFolder: ".dm-screen", serverPort: 3000 };
    const { data, changed } = migrateLegacyCacheFolder(input);
    expect(changed).toBe(false);
    expect(data).toBe(input);
  });
});
