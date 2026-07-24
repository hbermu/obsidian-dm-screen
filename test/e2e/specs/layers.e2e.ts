import * as fs from "node:fs";
import { browser, expect } from "@wdio/globals";
import { openPanel, openFixtureNote, startServer, panelButton, DEFAULT_PORT } from "../helpers/obsidian";
import { WsRecorder } from "../helpers/ws";

const FIXTURE_BYTES = fs.statSync("test/e2e/vault/attachments/map.png").size;

describe("image layers from a real note", function () {
  let rec: WsRecorder;

  before(async function () {
    await openPanel();
    await openFixtureNote();
    await startServer();
    rec = await WsRecorder.connect(DEFAULT_PORT, "player");
  });

  after(function () {
    rec.close();
  });

  it("Add Image pushes the note embed as a hidden layer", async function () {
    await (await panelButton("Add Image")).click();

    const sync = await rec.waitFor("image-layers-sync", {
      where: (m) => (m.payload.layers as unknown[]).length === 1,
    });
    const layer = (sync.payload.layers as Record<string, unknown>[])[0];
    expect(layer.label).toBe("Home (embed)");
    expect(layer.visible).toBe(false);
    const dataUrl = layer.dataUrl as string;
    expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    const decoded = Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
    expect(decoded.length).toBe(FIXTURE_BYTES);

    const geometry = await rec.waitFor("image-layers-geometry", {
      where: (m) => (m.payload.layers as Record<string, unknown>[]).some((l) => l.id === layer.id),
    });
    expect((geometry.payload.layers as unknown[]).length).toBe(1);

    const rows = await browser.$(".dm-control-panel").$$(".dm-layer-row");
    expect(rows.length).toBe(1);
    await expect(rows[0]).toHaveElementClass("dm-layer-hidden");
  });

  it("Clear All Layers empties the layer sync", async function () {
    const seen = rec.count("image-layers-sync");
    await (await panelButton("Clear All Layers")).click();
    await rec.waitFor("image-layers-sync", {
      skip: seen,
      where: (m) => (m.payload.layers as unknown[]).length === 0,
    });
    await browser.waitUntil(async () => {
      const rows = await browser.$(".dm-control-panel").$$(".dm-layer-row").length;
      return rows === 0;
    });
  });
});
