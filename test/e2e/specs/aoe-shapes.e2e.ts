import { browser, expect } from "@wdio/globals";
import { openPanel, openFixtureNote, startServer, panelButton, addMap, DEFAULT_PORT } from "../helpers/obsidian";
import { WsRecorder, WsMessage } from "../helpers/ws";

// aoe-vision.e2e.ts covers the Circle happy path (add / drag dot / remove) plus
// vision. This file exercises the rest of aoe-overlays.md: the non-circle shapes
// and their per-shape fields, the rotation handle, Clear All, and the Spells…
// catalog modal.

const aoes = (m: WsMessage) => m.payload.aoes as Record<string, unknown>[];

async function addShape(name: string): Promise<void> {
  await (await panelButton("Add AoE")).click();
  await browser.$(".menu").waitForExist();
  await browser.$(`.menu-item-title=${name}`).click();
}

describe("aoe shapes, rotation, clear, and the spell catalog", function () {
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

  // Leave a clean slate between tests so the per-row/per-handle assertions see
  // only the shape under test.
  afterEach(async function () {
    const clear = browser.$(".dm-control-panel").$("button=Clear All");
    if (await clear.isExisting()) {
      const seen = rec.count("map-aoe-sync");
      await clear.click();
      await rec.waitFor("map-aoe-sync", { skip: seen, where: (m) => aoes(m).length === 0 });
    }
  });

  it("Cone adds a rotatable shape with no width field", async function () {
    const seen = rec.count("map-aoe-sync");
    await addShape("Cone");
    const sync = await rec.waitFor("map-aoe-sync", { skip: seen, where: (m) => aoes(m).length === 1 });
    expect(aoes(sync)[0].shape).toBe("cone");

    await expect(browser.$(".dm-control-panel .dm-map-aoe-rot-handle")).toExist();
    // Cone has no width/thickness field — neither label is rendered.
    const row = browser.$(".dm-control-panel .dm-map-aoe-row");
    await expect(row.$("span*=wide")).not.toExist();
    await expect(row.$("span*=thick")).not.toExist();
  });

  it("Line adds a width field and a rotation handle", async function () {
    const seen = rec.count("map-aoe-sync");
    await addShape("Line");
    const sync = await rec.waitFor("map-aoe-sync", { skip: seen, where: (m) => aoes(m).length === 1 });
    expect(aoes(sync)[0].shape).toBe("line");
    expect(typeof aoes(sync)[0].widthFt).toBe("number");

    await expect(browser.$(".dm-control-panel .dm-map-aoe-row").$("span*=wide")).toExist();
    await expect(browser.$(".dm-control-panel .dm-map-aoe-rot-handle")).toExist();
  });

  it("Ring adds a band-thickness field and is not rotatable", async function () {
    const seen = rec.count("map-aoe-sync");
    await addShape("Ring");
    const sync = await rec.waitFor("map-aoe-sync", { skip: seen, where: (m) => aoes(m).length === 1 });
    expect(aoes(sync)[0].shape).toBe("ring");

    await expect(browser.$(".dm-control-panel .dm-map-aoe-row").$("span*=thick")).toExist();
    // Ring is rotationally symmetric — no rotation handle in the preview.
    await expect(browser.$(".dm-control-panel .dm-map-aoe-rot-handle")).not.toExist();
  });

  it("dragging the rotation handle rotates the shape and broadcasts", async function () {
    const seenAdd = rec.count("map-aoe-sync");
    await addShape("Cone");
    await rec.waitFor("map-aoe-sync", { skip: seenAdd, where: (m) => aoes(m).length === 1 });

    const handle = browser.$(".dm-control-panel .dm-map-aoe-rot-handle");
    await handle.waitForExist();
    await handle.scrollIntoView({ block: "center" });

    // Handle sits to the right of the centered dot at rotation 0; drag the
    // cursor straight below the dot (the AoE's stage centre) → ~90° rotation.
    const p = await browser.executeObsidian(() => {
      const h = document.querySelector(".dm-control-panel .dm-map-aoe-rot-handle")!.getBoundingClientRect();
      const d = document.querySelector(".dm-control-panel .dm-map-aoe-dot")!.getBoundingClientRect();
      return {
        hx: h.left + h.width / 2,
        hy: h.top + h.height / 2,
        dx: d.left + d.width / 2,
        dy: d.top + d.height / 2,
      };
    });

    const seen = rec.count("map-aoe-sync");
    await browser
      .action("pointer", { parameters: { pointerType: "mouse" } })
      .move({ x: Math.round(p.hx), y: Math.round(p.hy) })
      .down()
      .move({ x: Math.round(p.dx), y: Math.round(p.dy) + 60 })
      .up()
      .perform();

    await rec.waitFor("map-aoe-sync", {
      skip: seen,
      where: (m) => ((aoes(m)[0]?.rotation as number) ?? 0) > 0,
    });
  });

  it("Clear All removes every AoE and broadcasts an empty sync", async function () {
    let seen = rec.count("map-aoe-sync");
    await addShape("Cone");
    await rec.waitFor("map-aoe-sync", { skip: seen, where: (m) => aoes(m).length === 1 });
    seen = rec.count("map-aoe-sync");
    await addShape("Line");
    await rec.waitFor("map-aoe-sync", { skip: seen, where: (m) => aoes(m).length === 2 });

    seen = rec.count("map-aoe-sync");
    await (await panelButton("Clear All")).click();
    await rec.waitFor("map-aoe-sync", { skip: seen, where: (m) => aoes(m).length === 0 });
  });

  it("Add AoE > Spells… adds a labeled spell area from the catalog", async function () {
    const seen = rec.count("map-aoe-sync");
    await (await panelButton("Add AoE")).click();
    await browser.$(".menu").waitForExist();
    await browser.$(".menu-item-title*=Spells").click();

    await browser.$(".prompt-input").waitForExist();
    await browser.keys("Burning Hands");
    // Wait until the exact spell is the top suggestion, then choose it.
    await browser.waitUntil(async () => {
      const first = browser.$(".suggestion-item");
      return (await first.isExisting()) && (await first.getText()).includes("Burning Hands");
    });
    await browser.keys("Enter");

    const sync = await rec.waitFor("map-aoe-sync", {
      skip: seen,
      where: (m) => aoes(m).some((a) => a.label === "Burning Hands"),
    });
    const spell = aoes(sync).find((a) => a.label === "Burning Hands")!;
    expect(spell.shape).toBe("cone");
    expect(spell.sizeFt).toBe(15);

    await expect(browser.$(".dm-control-panel .dm-map-aoe-label")).toExist();
  });
});
