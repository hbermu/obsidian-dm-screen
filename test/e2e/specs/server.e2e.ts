import { browser, expect } from "@wdio/globals";
import { openPanel, panelButton, waitForHealth, DEFAULT_PORT } from "../helpers/obsidian";
import { httpGet } from "../helpers/http";
import { WsRecorder } from "../helpers/ws";

describe("player screen server", function () {
  before(async function () {
    await openPanel();
  });

  it("Start Server serves the player and map endpoints over real HTTP", async function () {
    await (await panelButton("Start Server")).click();
    const health = await waitForHealth(DEFAULT_PORT);
    expect(health.status).toBe("ok");

    const player = await httpGet(`http://127.0.0.1:${DEFAULT_PORT}/`);
    expect(player.status).toBe(200);
    expect(player.body.toString()).toContain("DM Screen - Player View");

    const map = await httpGet(`http://127.0.0.1:${DEFAULT_PORT}/map`);
    expect(map.status).toBe(200);
    expect(map.body.toString()).toContain("DM Screen - Map View");

    for (const asset of ["/player.js", "/player.css", "/map.js", "/map.css"]) {
      const res = await httpGet(`http://127.0.0.1:${DEFAULT_PORT}${asset}`);
      expect(res.status).toBe(200);
    }

    await expect(panelButton("Stop Server")).toExist();
    await expect(browser.$(".dm-server-status .dm-status-on")).toExist();
  });

  it("replays cached state per channel to late joiners", async function () {
    const player = await WsRecorder.connect(DEFAULT_PORT, "player");
    const map = await WsRecorder.connect(DEFAULT_PORT, "map");

    const waiting = await player.waitFor("waiting-screen");
    expect(typeof waiting.payload.title).toBe("string");
    const inspiration = await player.waitFor("inspiration-style");
    expect(typeof inspiration.payload.pulse).toBe("boolean");
    await map.waitFor("map-calibration");

    expect(player.count("map-calibration")).toBe(0);
    expect(map.count("waiting-screen")).toBe(0);

    const health = await waitForHealth(DEFAULT_PORT);
    expect(health.clients).toBe(2);

    player.close();
    map.close();
  });

  it("serves on the new port after a settings change and restart", async function () {
    await browser.executeObsidian(async ({ app }) => {
      const plugin = (app as any).plugins.plugins["dm-screen"];
      plugin.settings.serverPort = 3210;
      await plugin.saveSettings();
      plugin.stopServer();
      await plugin.startServer();
    });
    const health = await waitForHealth(3210);
    expect(health.status).toBe("ok");

    let oldPortRefused = false;
    try {
      await httpGet(`http://127.0.0.1:${DEFAULT_PORT}/health`);
    } catch {
      oldPortRefused = true;
    }
    expect(oldPortRefused).toBe(true);
  });

  it("persists settings across a plugin disable/enable cycle", async function () {
    const port = await browser.executeObsidian(async ({ app }) => {
      await (app as any).plugins.disablePlugin("dm-screen");
      await (app as any).plugins.enablePlugin("dm-screen");
      return (app as any).plugins.plugins["dm-screen"].settings.serverPort as number;
    });
    expect(port).toBe(3210);

    let refused = false;
    try {
      await httpGet("http://127.0.0.1:3210/health");
    } catch {
      refused = true;
    }
    expect(refused).toBe(true);
  });
});
