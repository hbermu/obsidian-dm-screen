import { browser, expect } from "@wdio/globals";
import { zipSync, strToU8 } from "fflate";
import { openPanel, openFixtureNote, startServer, panelButton, addMap, DEFAULT_PORT } from "../helpers/obsidian";
import { WsRecorder, WsMessage } from "../helpers/ws";

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

// A small UVTT doc on a 10×8 grid at 100 px/grid: two line_of_sight polylines
// (3 segments) plus one closed portal (1 door) → 4 walls, 1 door. On the 560px
// fixture map that yields pxPerSquare = 560/10 = 56.
const UVTT_DOC = {
  format: 0.3,
  resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: 10, y: 8 }, pixels_per_grid: 100 },
  line_of_sight: [
    [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }],
    [{ x: 0, y: 0 }, { x: 0, y: 8 }],
  ],
  objects_line_of_sight: [],
  portals: [{ bounds: [{ x: 5, y: 0 }, { x: 6, y: 0 }], closed: true }],
};

// A minimal Foundry module zip: one NeDB scene pack (walls stored inline) on a
// 1000×800 scene at gridSize 100 → 10 squares wide, three sight-blocking walls
// (one a closed door). pxPerSquare = 560/10 = 56, matching the UVTT case.
function foundryZipBase64(): string {
  const scene = {
    name: "TestScene",
    width: 1000,
    height: 800,
    grid: { size: 100 },
    padding: 0,
    walls: [
      { c: [0, 0, 1000, 0] },
      { c: [1000, 0, 1000, 800] },
      { c: [0, 0, 0, 800], door: 1, ds: 0 },
    ],
  };
  const nedb = JSON.stringify(scene) + "\n";
  const zip = zipSync({ "packs/maps.db": strToU8(nedb) });
  return Buffer.from(zip).toString("base64");
}

// Click a modal button by its exact label, dispatched inside the renderer. Same
// coordinate-free approach as fog-tools.e2e.ts — a WDIO pointer .click() can
// misfire onto the modal backdrop and close it.
async function clickModalButton(label: string): Promise<void> {
  await browser.executeObsidian((_app, text: string) => {
    const btn = Array.from(document.querySelectorAll(".dm-fog-modal button")).find(
      (b) => b.textContent === text,
    ) as HTMLElement | undefined;
    if (!btn) throw new Error(`fog modal button not found: ${text}`);
    btn.click();
  }, label);
}

// Drive the real Import <input>. The import handlers create a detached file
// input and call input.click() to open the OS picker — undrivable and never in
// the DOM. Override HTMLInputElement.prototype.click to capture that input
// instead of opening a dialog, click the import button so its handler runs and
// registers its change listener, then assign a real File via DataTransfer and
// dispatch change. This exercises the whole path: button wiring → file.text()/
// arrayBuffer() → JSON.parse/unzipSync → parse → scale → commit → broadcast.
async function importFile(buttonLabel: string, name: string, mime: string, dataBase64: string): Promise<void> {
  await browser.executeObsidian(
    (_app, a: { label: string; name: string; mime: string; b64: string }) => {
      const proto = HTMLInputElement.prototype;
      const orig = proto.click;
      proto.click = function (this: HTMLInputElement) {
        if (this.type === "file") {
          (window as unknown as { __dmFileInput?: HTMLInputElement }).__dmFileInput = this;
          return;
        }
        return orig.apply(this);
      };
      try {
        const btn = Array.from(document.querySelectorAll(".dm-fog-modal button")).find(
          (b) => b.textContent === a.label,
        ) as HTMLElement | undefined;
        if (!btn) throw new Error(`import button not found: ${a.label}`);
        btn.click();
        const input = (window as unknown as { __dmFileInput?: HTMLInputElement }).__dmFileInput;
        if (!input) throw new Error("file input was not captured");
        const bin = atob(a.b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const file = new File([bytes], a.name, { type: a.mime });
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event("change"));
      } finally {
        proto.click = orig;
      }
    },
    { label: buttonLabel, name, mime, b64: dataBase64 },
  );
}

describe("UVTT and Foundry map import", function () {
  let rec: WsRecorder;

  before(async function () {
    await openPanel();
    await openFixtureNote();
    await startServer();
    rec = await WsRecorder.connect(DEFAULT_PORT, "map");
    await addMap();
    await rec.waitFor("map-show");

    await (await panelButton("Fog")).click();
    await expect(browser.$(".dm-fog-modal")).toExist();
    await clickModalButton("Walls");
  });

  after(function () {
    rec.close();
  });

  it("Import UVTT commits scaled walls and grid", async function () {
    const wallsBefore = rec.count("map-walls");
    const configBefore = rec.count("map-config");
    await importFile("Import UVTT", "sample.dd2vtt", "application/json", btoa(JSON.stringify(UVTT_DOC)));

    const w = await rec.waitFor("map-walls", { skip: wallsBefore, where: (m) => walls(m).length === 4 });
    expect(walls(w).filter((x) => x.door).length).toBe(1);

    const cfg = await rec.waitFor("map-config", {
      skip: configBefore,
      where: (m) => m.payload.pxPerSquare === 56,
    });
    expect(cfg.payload.gridOffsetX).toBe(0);
    expect(cfg.payload.gridOffsetY).toBe(0);
  });

  it("Import Foundry commits scaled walls and grid", async function () {
    const wallsBefore = rec.count("map-walls");
    const configBefore = rec.count("map-config");
    await importFile("Import Foundry", "module.zip", "application/zip", foundryZipBase64());

    const w = await rec.waitFor("map-walls", { skip: wallsBefore, where: (m) => walls(m).length === 3 });
    expect(walls(w).filter((x) => x.door).length).toBe(1);

    await rec.waitFor("map-config", { skip: configBefore, where: (m) => m.payload.pxPerSquare === 56 });
  });

  it("malformed UVTT shows a Notice and commits nothing", async function () {
    const wallsBefore = rec.count("map-walls");
    await importFile("Import UVTT", "broken.dd2vtt", "application/json", btoa("{ not json"));
    await browser.pause(500);
    expect(rec.count("map-walls")).toBe(wallsBefore);
  });
});
