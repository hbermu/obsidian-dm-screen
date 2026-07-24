import { browser, expect } from "@wdio/globals";

describe("plugin bootstrap", function () {
  it("loads and enables dm-screen in a real Obsidian", async function () {
    const info = await browser.executeObsidian(({ app }) => {
      const plugins = (app as any).plugins;
      const plugin = plugins.plugins["dm-screen"];
      return {
        enabled: plugins.enabledPlugins.has("dm-screen"),
        id: plugin?.manifest.id,
        version: plugin?.manifest.version,
      };
    });
    expect(info.enabled).toBe(true);
    expect(info.id).toBe("dm-screen");
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
