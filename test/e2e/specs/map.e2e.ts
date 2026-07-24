import * as fs from "node:fs";
import { browser, expect } from "@wdio/globals";
import { openPanel, openFixtureNote, startServer, panelButton, addMap, DEFAULT_PORT } from "../helpers/obsidian";
import { WsRecorder } from "../helpers/ws";

const FIXTURE_BYTES = fs.statSync("test/e2e/vault/attachments/map.png").size;

describe("map screen", function () {
  let rec: WsRecorder;

  before(async function () {
    await openPanel();
    await openFixtureNote();
    await startServer();
    rec = await WsRecorder.connect(DEFAULT_PORT, "map");
  });

  after(function () {
    rec.close();
  });

  it("Add Map broadcasts the full map state and serves the file over /vault/", async function () {
    await addMap();

    const show = await rec.waitFor("map-show");
    expect(show.payload.url).toBe("/vault/attachments/map.png");
    expect(show.payload.mediaType).toBe("image");
    expect(show.payload.naturalWidth).toBe(560);
    expect(show.payload.naturalHeight).toBe(420);

    const view = await rec.waitFor("map-view");
    expect(view.payload.mode).toBe("fit");
    expect(view.payload.rotation).toBe(0);
    const config = await rec.waitFor("map-config");
    expect(typeof config.payload.pxPerSquare).toBe("number");
    const fog = await rec.waitFor("map-fog");
    expect(fog.payload.dataUrl).toBe(null);
    const walls = await rec.waitFor("map-walls");
    expect(walls.payload.walls).toEqual([]);

    const res = await fetch(`http://127.0.0.1:${DEFAULT_PORT}${show.payload.url}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
    expect((await res.arrayBuffer()).byteLength).toBe(FIXTURE_BYTES);

    const late = await WsRecorder.connect(DEFAULT_PORT, "map");
    await late.waitFor("map-show");
    late.close();

    for (const text of ["Stop Map", "Scale: fit screen", "Rotate: 0°", "Fog", "Explore"]) {
      await expect(panelButton(text)).toExist();
    }
  });

  it("Rotate broadcasts an updated map-view", async function () {
    const seen = rec.count("map-view");
    await (await panelButton("Rotate: 0°")).click();
    await rec.waitFor("map-view", { skip: seen, where: (m) => m.payload.rotation === 90 });
    await expect(panelButton("Rotate: 90°")).toExist();
  });

  it("Stop Map clears the map channel cache", async function () {
    await (await panelButton("Stop Map")).click();
    await rec.waitFor("map-clear");

    const late = await WsRecorder.connect(DEFAULT_PORT, "map");
    await new Promise((r) => setTimeout(r, 500));
    expect(late.count("map-show")).toBe(0);
    late.close();

    await expect(panelButton("Add Map")).toExist();
    expect(await (await panelButton("Fog")).isExisting()).toBe(false);
    expect(await (await panelButton("Explore")).isExisting()).toBe(false);
  });
});
