import { browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";
import { openPanel, openFixtureNote, startServer, panelButton, addMap, DEFAULT_PORT } from "../helpers/obsidian";
import { WsRecorder } from "../helpers/ws";

const MAP_W = 560;
const MAP_H = 420;
const DOOR = { x: 140, y: 220 };

describe("exploration mode", function () {
  let rec: WsRecorder;

  before(async function () {
    await openPanel();
    await openFixtureNote();
    await startServer();
    rec = await WsRecorder.connect(DEFAULT_PORT, "map");
    await addMap();
    await rec.waitFor("map-show");

    await browser.executeObsidian(async ({ app }) => {
      const view = app.workspace.getLeavesOfType("dm-control-panel")[0].view as any;
      await view.mapPanel.commitWalls([
        { x1: 140, y1: 0, x2: 140, y2: 180 },
        { x1: 140, y1: 180, x2: 140, y2: 260, door: true, open: false },
        { x1: 140, y1: 260, x2: 140, y2: 420 },
      ]);
    });
    await rec.waitFor("map-walls", { where: (m) => (m.payload.walls as unknown[]).length === 3 });
  });

  after(async function () {
    await browser.releaseActions();
    rec.close();
  });

  it("Explore opens a near-fullscreen surface with the table-play controls", async function () {
    await (await panelButton("Explore")).click();
    const modal = browser.$(".dm-explore-modal");
    await expect(modal).toExist();
    await expect(modal.$(".dm-explore-overlay")).toExist();
    await expect(modal.$(".dm-explore-markers")).toExist();
    for (const text of ["Reveal All", "Cover All", "Exit"]) {
      await expect(modal.$(`button=${text}`)).toExist();
    }

    const coverage = await browser.executeObsidian(() => {
      const r = document.querySelector(".dm-explore-modal")!.getBoundingClientRect();
      return (r.width * r.height) / (window.innerWidth * window.innerHeight);
    });
    expect(coverage).toBeGreaterThan(0.8);
  });

  it("holding Shift toggles the exploration focus class", async function () {
    const markers = browser.$(".dm-explore-modal .dm-explore-markers");

    await browser.action("key").down(Key.Shift).perform(true);
    await browser.waitUntil(async () =>
      ((await markers.getAttribute("class")) ?? "").includes("dm-explore-focus"),
    );

    await browser.action("key").up(Key.Shift).perform();
    await browser.waitUntil(async () =>
      !((await markers.getAttribute("class")) ?? "").includes("dm-explore-focus"),
    );
  });

  it("a Shift-click on a door marker opens the door and broadcasts map-walls", async function () {
    const r = await browser.executeObsidian(() => {
      const rect = document.querySelector(".dm-explore-modal .dm-explore-overlay")!.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    });
    const x = Math.round(r.left + (DOOR.x * r.width) / MAP_W);
    const y = Math.round(r.top + (DOOR.y * r.height) / MAP_H);

    const seen = rec.count("map-walls");
    await browser.action("key").down(Key.Shift).perform(true);
    await browser
      .action("pointer", { parameters: { pointerType: "mouse" } })
      .move({ x, y })
      .down()
      .up()
      .perform();
    await browser.action("key").up(Key.Shift).perform();

    const walls = await rec.waitFor("map-walls", {
      skip: seen,
      where: (m) => (m.payload.walls as Record<string, unknown>[]).some((w) => w.door === true && w.open === true),
    });
    expect((walls.payload.walls as unknown[]).length).toBe(3);

    await browser.$(".dm-explore-modal").$("button=Exit").click();
    await browser.waitUntil(async () => !(await browser.$(".dm-explore-modal").isExisting()));
  });
});
