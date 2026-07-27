import { browser, expect } from "@wdio/globals";
import { openPanel, openFixtureNote, startServer, panelButton, addMap, DEFAULT_PORT } from "../helpers/obsidian";
import { WsRecorder, WsMessage } from "../helpers/ws";

const MAP_W = 560;
const MAP_H = 420;

// Drive the fog/walls canvas by dispatching synthetic mouse events inside the
// Obsidian renderer. The overlay handlers read clientX/clientY + getBoundingClientRect,
// so this reproduces real drawing. It also sidesteps two WebDriver pitfalls:
// the Walls tab clones the canvas node (WebDriver can't resolve the clone), and
// raw pointer actions before an element .click() can misfire onto the backdrop.
async function clickCanvas(nx: number, ny: number): Promise<void> {
  await browser.executeObsidian((_app, a: { nx: number; ny: number; w: number; h: number }) => {
    const el = document.querySelector(".dm-fog-overlay");
    if (!el) throw new Error("fog overlay not found");
    const b = el.getBoundingClientRect();
    const opts: MouseEventInit = {
      clientX: b.left + (a.nx / a.w) * b.width,
      clientY: b.top + (a.ny / a.h) * b.height,
      button: 0,
      bubbles: true,
    };
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    document.dispatchEvent(new MouseEvent("mouseup", opts));
  }, { nx, ny, w: MAP_W, h: MAP_H });
}

async function dragCanvas(n0: [number, number], n1: [number, number]): Promise<void> {
  await browser.executeObsidian(
    (_app, a: { x0: number; y0: number; x1: number; y1: number; w: number; h: number }) => {
      const el = document.querySelector(".dm-fog-overlay");
      if (!el) throw new Error("fog overlay not found");
      const b = el.getBoundingClientRect();
      const pt = (nx: number, ny: number): MouseEventInit => ({
        clientX: b.left + (nx / a.w) * b.width,
        clientY: b.top + (ny / a.h) * b.height,
        button: 0,
        bubbles: true,
      });
      el.dispatchEvent(new MouseEvent("mousedown", pt(a.x0, a.y0)));
      document.dispatchEvent(new MouseEvent("mousemove", pt((a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2)));
      document.dispatchEvent(new MouseEvent("mousemove", pt(a.x1, a.y1)));
      document.dispatchEvent(new MouseEvent("mouseup", pt(a.x1, a.y1)));
    },
    { x0: n0[0], y0: n0[1], x1: n1[0], y1: n1[1], w: MAP_W, h: MAP_H },
  );
}

function fogModal() {
  return browser.$(".dm-fog-modal");
}

// Click a modal button programmatically. A WDIO element .click() uses pointer
// coordinates, and after raw pointer actions on the canvas it can misfire onto
// the modal backdrop and close the modal; dispatching the click on the element
// itself is coordinate-free and reliable.
async function clickModalButton(label: string): Promise<void> {
  await browser.executeObsidian((_app, text: string) => {
    const btn = Array.from(document.querySelectorAll(".dm-fog-modal button")).find(
      (b) => b.textContent === text,
    ) as HTMLElement | undefined;
    if (!btn) throw new Error(`fog modal button not found: ${text}`);
    btn.click();
  }, label);
}

interface Wall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  door?: boolean;
  open?: boolean;
}

function walls(m: WsMessage): Wall[] {
  return m.payload.walls as Wall[];
}

describe("fog drawing tools and walls tab", function () {
  let rec: WsRecorder;

  // Wait for the map-fog that a just-performed action commits. `since` MUST be
  // captured BEFORE the action — the broadcast can land before this runs, so
  // snapshotting the count here would skip past the new message and hang.
  async function fogSince(since: number): Promise<string> {
    const msg = await rec.waitFor("map-fog", {
      skip: since,
      where: (m) => typeof m.payload.dataUrl === "string",
    });
    return msg.payload.dataUrl as string;
  }

  async function coverAll(): Promise<void> {
    const since = rec.count("map-fog");
    await clickModalButton("Cover All");
    await fogSince(since);
  }

  before(async function () {
    await openPanel();
    await openFixtureNote();
    await startServer();
    rec = await WsRecorder.connect(DEFAULT_PORT, "map");
    await addMap();
    await rec.waitFor("map-show");

    // Vertical divider at x=140 with a closed door: encloses a left room (with
    // the canvas borders) for the Room-flood test and gives the Walls tab a
    // door to toggle and plain segments to erase.
    await browser.executeObsidian(async ({ app }) => {
      const view = app.workspace.getLeavesOfType("dm-control-panel")[0].view as any;
      await view.mapPanel.commitWalls([
        { x1: 140, y1: 0, x2: 140, y2: 180 },
        { x1: 140, y1: 180, x2: 140, y2: 260, door: true, open: false },
        { x1: 140, y1: 260, x2: 140, y2: 420 },
      ]);
    });
    await rec.waitFor("map-walls", { where: (m) => walls(m).length === 3 });

    await (await panelButton("Fog")).click();
    await expect(fogModal()).toExist();
    await coverAll();
  });

  after(function () {
    rec.close();
  });

  it("Reveal All clears the mask and commits map-fog", async function () {
    const since = rec.count("map-fog");
    await clickModalButton("Reveal All");
    const cleared = await fogSince(since);
    expect(cleared.startsWith("data:image/png")).toBe(true);
    await coverAll();
  });

  it("the Rectangle tool reveals a dragged marquee", async function () {
    await clickModalButton("Reveal");
    await clickModalButton("Rectangle");
    const since = rec.count("map-fog");
    await dragCanvas([220, 120], [360, 300]);
    expect((await fogSince(since)).startsWith("data:image/png")).toBe(true);
  });

  it("the Grid cell tool reveals a snapped cell", async function () {
    await coverAll();
    await clickModalButton("Grid cell");
    const since = rec.count("map-fog");
    await clickCanvas(300, 200);
    expect((await fogSince(since)).startsWith("data:image/png")).toBe(true);
  });

  it("the Grid rect tool reveals a snapped block", async function () {
    await clickModalButton("Grid rect");
    const since = rec.count("map-fog");
    await dragCanvas([180, 100], [420, 320]);
    expect((await fogSince(since)).startsWith("data:image/png")).toBe(true);
  });

  it("the Room tool floods a walled room, and a wall-pixel click does not commit", async function () {
    await coverAll();
    await clickModalButton("Room");
    const since = rec.count("map-fog");
    await clickCanvas(70, 210); // inside the left room
    expect((await fogSince(since)).startsWith("data:image/png")).toBe(true);

    const before = rec.count("map-fog");
    await clickCanvas(140, 90); // on the wall itself → Notice, no commit
    await browser.pause(500);
    expect(rec.count("map-fog")).toBe(before);
  });

  it("the Walls tab draws a plain wall segment", async function () {
    await clickModalButton("Walls");
    await clickModalButton("Wall");
    const before = rec.count("map-walls");
    await clickCanvas(300, 320); // chain anchor
    await clickCanvas(420, 320); // second click commits the segment
    const msg = await rec.waitFor("map-walls", { skip: before, where: (m) => walls(m).length === 4 });
    expect(walls(msg).filter((w) => w.door).length).toBe(1); // still just the seeded door
  });

  it("the Door tool draws a door segment", async function () {
    await clickModalButton("Door");
    const before = rec.count("map-walls");
    await clickCanvas(300, 360);
    await clickCanvas(420, 360);
    const msg = await rec.waitFor("map-walls", { skip: before, where: (m) => walls(m).length === 5 });
    expect(walls(msg).filter((w) => w.door).length).toBe(2);
  });

  it("Toggle door flips the seeded door open", async function () {
    await clickModalButton("Toggle door");
    const before = rec.count("map-walls");
    await clickCanvas(140, 220); // the seeded door midpoint
    const msg = await rec.waitFor("map-walls", {
      skip: before,
      where: (m) => walls(m).some((w) => w.door === true && w.open === true),
    });
    expect(walls(msg).length).toBe(5);
  });

  it("Erase removes the nearest wall", async function () {
    await clickModalButton("Erase");
    const before = rec.count("map-walls");
    await clickCanvas(140, 90); // near the top seeded plain segment
    await rec.waitFor("map-walls", { skip: before, where: (m) => walls(m).length === 4 });

    await browser.executeObsidian(() => {
      (document.querySelector(".dm-fog-modal .modal-close-button") as HTMLElement | null)?.click();
    });
    await browser.waitUntil(async () => !(await fogModal().isExisting()));
  });
});
