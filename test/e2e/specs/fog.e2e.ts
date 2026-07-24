import { browser, expect } from "@wdio/globals";
import { openPanel, openFixtureNote, startServer, panelButton, addMap, DEFAULT_PORT } from "../helpers/obsidian";
import { WsRecorder } from "../helpers/ws";

async function fogOverlayRect(): Promise<{ left: number; top: number; width: number; height: number }> {
  return browser.executeObsidian(() => {
    const r = document.querySelector(".dm-fog-modal .dm-fog-overlay")!.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
}

describe("fog of war on the real canvas", function () {
  let rec: WsRecorder;
  let coverDataUrl: string;

  before(async function () {
    await openPanel();
    await openFixtureNote();
    await startServer();
    rec = await WsRecorder.connect(DEFAULT_PORT, "map");
    await addMap();
    await rec.waitFor("map-show");
  });

  after(function () {
    rec.close();
  });

  it("Cover All commits: map-fog broadcast plus a vault sidecar", async function () {
    await (await panelButton("Fog")).click();
    const modal = browser.$(".dm-fog-modal");
    await expect(modal).toExist();
    await expect(modal.$("button=Cover All")).toExist();

    const seen = rec.count("map-fog");
    await modal.$("button=Cover All").click();
    const fog = await rec.waitFor("map-fog", {
      skip: seen,
      where: (m) => typeof m.payload.dataUrl === "string" && (m.payload.dataUrl as string).startsWith("data:image/png"),
    });
    coverDataUrl = fog.payload.dataUrl as string;

    const sidecars = await browser.executeObsidian(async ({ app }) =>
      (await app.vault.adapter.list(".dm-screen/fog")).files,
    );
    expect(sidecars.length).toBe(1);
    expect(sidecars[0]).toMatch(/attachments_map\.png-[0-9a-f]{8}\.png$/);
  });

  it("a brush stroke on the canvas commits a different fog mask", async function () {
    const r = await fogOverlayRect();
    const cy = Math.round(r.top + r.height / 2);
    const x0 = Math.round(r.left + r.width * 0.3);
    const x1 = Math.round(r.left + r.width * 0.5);
    const x2 = Math.round(r.left + r.width * 0.7);

    const seen = rec.count("map-fog");
    await browser
      .action("pointer", { parameters: { pointerType: "mouse" } })
      .move({ x: x0, y: cy })
      .down()
      .move({ x: x1, y: cy })
      .move({ x: x2, y: cy })
      .up()
      .perform();

    const fog = await rec.waitFor("map-fog", {
      skip: seen,
      where: (m) => typeof m.payload.dataUrl === "string" && m.payload.dataUrl !== coverDataUrl,
    });
    expect((fog.payload.dataUrl as string).startsWith("data:image/png")).toBe(true);
  });

  it("fog replays from the sidecar after Stop Map and re-Add Map", async function () {
    await browser.$(".dm-fog-modal .modal-close-button").click();
    await browser.waitUntil(async () => !(await browser.$(".dm-fog-modal").isExisting()));

    await (await panelButton("Stop Map")).click();
    await rec.waitFor("map-clear");

    const seenShow = rec.count("map-show");
    const seenFog = rec.count("map-fog");
    await (await panelButton("Add Map")).click();
    await rec.waitFor("map-show", { skip: seenShow });
    const fog = await rec.waitFor("map-fog", {
      skip: seenFog,
      where: (m) => m.payload.dataUrl !== null,
    });
    expect((fog.payload.dataUrl as string).startsWith("data:image/png")).toBe(true);
    await expect(panelButton("Fog ●")).toExist();
  });
});
