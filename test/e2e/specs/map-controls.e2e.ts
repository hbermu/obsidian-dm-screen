import { browser, expect } from "@wdio/globals";
import { openPanel, openFixtureNote, startServer, panelButton, addMap, DEFAULT_PORT } from "../helpers/obsidian";
import { httpGetRaw } from "../helpers/http";
import { WsRecorder } from "../helpers/ws";

describe("map view, grid, calibration, and vault guard", function () {
  let rec: WsRecorder;

  before(async function () {
    await openPanel();
    await openFixtureNote();
    await startServer();
    rec = await WsRecorder.connect(DEFAULT_PORT, "map");
    // A small "TV" so physical mode overflows the 560×420 fixture map and the
    // pan clamp leaves real drag range (96 dpi fallback ≈ 0.69 map scale).
    rec.send({ type: "client-info", payload: { width: 200, height: 150, devicePixelRatio: 1 } });
    await addMap();
    await rec.waitFor("map-show");
  });

  after(function () {
    rec.close();
  });

  it("the scale toggle switches to physical mode", async function () {
    const seen = rec.count("map-view");
    await (await panelButton("Scale: fit screen")).click();
    await rec.waitFor("map-view", { skip: seen, where: (m) => m.payload.mode === "physical" });
    await expect(panelButton("Scale: physical 1″")).toExist();
  });

  it("dragging the preview viewport rect pans the map", async function () {
    const stage = browser.$(".dm-control-panel .dm-map-preview-stage");
    const dot = stage.$(".dm-map-viewport-rect");
    await expect(dot).toExist();
    await dot.scrollIntoView({ block: "center" });

    const r = await browser.executeObsidian(() => {
      const rect = document
        .querySelector(".dm-control-panel .dm-map-viewport-rect")!
        .getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });

    const seen = rec.count("map-view");
    await browser
      .action("pointer", { parameters: { pointerType: "mouse" } })
      .move({ x: Math.round(r.x), y: Math.round(r.y) })
      .down()
      .move({ x: Math.round(r.x) - 20, y: Math.round(r.y) - 12 })
      .up()
      .perform();

    const view = await rec.waitFor("map-view", {
      skip: seen,
      where: (m) => (m.payload.panX as number) !== 0 || (m.payload.panY as number) !== 0,
    });
    expect(view.payload.mode).toBe("physical");
  });

  it("changing px/square broadcasts map-config", async function () {
    const seen = rec.count("map-config");
    const pxInput = browser.$(".dm-control-panel .dm-map-grid-controls").$('input[type="number"]');
    await pxInput.setValue("70");
    await browser.keys(["Tab"]);
    await rec.waitFor("map-config", { skip: seen, where: (m) => m.payload.pxPerSquare === 70 });
  });

  it("the calibration modal toggles the test-pattern overlay", async function () {
    rec.send({ type: "client-info", payload: { width: 1920, height: 1080, devicePixelRatio: 1 } });
    const badge = browser.$(".dm-control-panel .dm-client-resolution");
    await badge.waitForExist();
    await badge.click();

    const checkbox = browser.$(".modal input[type='checkbox']");
    await checkbox.waitForExist();
    const seen = rec.count("map-calibration-overlay");
    await checkbox.click();
    await rec.waitFor("map-calibration-overlay", { skip: seen, where: (m) => m.payload.show === true });

    await browser.$(".modal-close-button").click();
  });

  it("the /vault/ route rejects traversal and non-allowlisted paths", async function () {
    const traversal = await httpGetRaw(DEFAULT_PORT, "/vault/../manifest.json");
    expect(traversal.status).toBe(400);

    const notAllowed = await httpGetRaw(DEFAULT_PORT, "/vault/Home.md");
    expect(notAllowed.status).toBe(404);

    const allowed = await httpGetRaw(DEFAULT_PORT, "/vault/attachments/map.png");
    expect(allowed.status).toBe(200);
  });
});
