import { browser, expect } from "@wdio/globals";
import { openPanel, openFixtureNote, startServer, panelButton, addMap, DEFAULT_PORT } from "../helpers/obsidian";
import { WsRecorder } from "../helpers/ws";

describe("aoe overlays and vision", function () {
  let rec: WsRecorder;

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

  it("Add AoE > Circle broadcasts one aoe and renders its row and dot", async function () {
    await (await panelButton("Add AoE")).click();
    await browser.$(".menu").waitForExist();
    await browser.$(".menu-item-title=Circle").click();

    const sync = await rec.waitFor("map-aoe-sync", {
      where: (m) => (m.payload.aoes as unknown[]).length === 1,
    });
    const aoe = (sync.payload.aoes as Record<string, unknown>[])[0];
    expect(aoe.shape).toBe("circle");
    expect(typeof aoe.sizeFt).toBe("number");
    expect(typeof aoe.x).toBe("number");

    await expect(browser.$(".dm-control-panel .dm-map-aoe-row")).toExist();
    await expect(browser.$(".dm-control-panel .dm-map-aoe-dot")).toExist();
  });

  it("dragging the aoe anchor dot moves it and broadcasts", async function () {
    const r = await browser.executeObsidian(() => {
      const rect = document.querySelector(".dm-control-panel .dm-map-aoe-dot")!.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });

    const before = await rec.waitFor("map-aoe-sync", { skip: rec.count("map-aoe-sync") - 1 });
    const x0 = (before.payload.aoes as Record<string, unknown>[])[0].x as number;

    const seen = rec.count("map-aoe-sync");
    await browser
      .action("pointer", { parameters: { pointerType: "mouse" } })
      .move({ x: Math.round(r.x), y: Math.round(r.y) })
      .down()
      .move({ x: Math.round(r.x) + 30, y: Math.round(r.y) })
      .up()
      .perform();

    await rec.waitFor("map-aoe-sync", {
      skip: seen,
      where: (m) => ((m.payload.aoes as Record<string, unknown>[])[0]?.x as number) > x0,
    });
  });

  it("removing the aoe empties the sync", async function () {
    const seen = rec.count("map-aoe-sync");
    await browser.$(".dm-control-panel .dm-map-aoe-row").$("button=✕").click();
    await rec.waitFor("map-aoe-sync", {
      skip: seen,
      where: (m) => (m.payload.aoes as unknown[]).length === 0,
    });
  });

  it("Add Vision > Circle broadcasts one vision; the bind toggle marks followsView", async function () {
    await (await panelButton("Add Vision")).click();
    await browser.$(".menu").waitForExist();
    await browser.$(".menu-item-title=Circle 30 ft").click();

    await rec.waitFor("map-vision", {
      where: (m) => (m.payload.visions as unknown[]).length === 1,
    });
    await expect(browser.$(".dm-control-panel .dm-map-vision-dot")).toExist();

    const seen = rec.count("map-vision");
    await browser.$(".dm-control-panel .dm-map-vision-bind").click();
    await rec.waitFor("map-vision", {
      skip: seen,
      where: (m) => (m.payload.visions as Record<string, unknown>[])[0]?.followsView === true,
    });
  });

  it("Bake into fog burns the vision and clears the live layer", async function () {
    const seenFog = rec.count("map-fog");
    const seenVision = rec.count("map-vision");
    await (await panelButton("Bake into fog")).click();

    const fog = await rec.waitFor("map-fog", {
      skip: seenFog,
      where: (m) => typeof m.payload.dataUrl === "string",
    });
    expect((fog.payload.dataUrl as string).startsWith("data:image/png")).toBe(true);
    await rec.waitFor("map-vision", {
      skip: seenVision,
      where: (m) => (m.payload.visions as unknown[]).length === 0,
    });
  });
});
