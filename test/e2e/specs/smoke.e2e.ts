import { browser, expect } from "@wdio/globals";
import { openPanel, panelButton } from "../helpers/obsidian";

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

  it("registers both commands", async function () {
    const ids = await browser.executeObsidian(({ app }) =>
      Object.keys((app as any).commands.commands).filter((id) => id.startsWith("dm-screen:")),
    );
    expect(ids).toContain("dm-screen:open-dm-control-panel");
    expect(ids).toContain("dm-screen:toggle-player-server");
  });

  it("adds the DM Screen ribbon icon", async function () {
    await expect(browser.$('.side-dock-ribbon-action[aria-label="DM Screen"]')).toExist();
  });

  it("opens the DM Control Panel with its sections", async function () {
    await openPanel();
    const panel = browser.$(".dm-control-panel");
    await expect(panel.$("h3=Player Screen Server")).toExist();
    await expect(panel.$("h3=Player Screen")).toExist();
    await expect(panel.$("h3=Map Screen")).toExist();
    await expect(panel.$("h3=COMBAT")).toExist();
    const startBtn = await panelButton("Start Server");
    await expect(startBtn).toExist();
    await expect(startBtn).toHaveElementClass("mod-cta");
    await expect(panel.$(".dm-server-status .dm-status-off")).toExist();
  });
});
