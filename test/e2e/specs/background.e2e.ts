import { browser, expect } from "@wdio/globals";
import { openPanel, openFixtureNote, startServer, panelButton, DEFAULT_PORT } from "../helpers/obsidian";
import { WsRecorder } from "../helpers/ws";

describe("background media from a real note", function () {
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

  it("Add BG broadcasts show-background-media for the note embed", async function () {
    await (await panelButton("Add BG")).click();
    const show = await rec.waitFor("show-background-media");
    expect(show.payload.mediaType).toBe("image");
    expect(typeof show.payload.url).toBe("string");
    await expect(panelButton("Stop BG")).toExist();
  });

  it("Stop BG broadcasts hide-background-media", async function () {
    await (await panelButton("Stop BG")).click();
    await rec.waitFor("hide-background-media");
    await expect(panelButton("Add BG")).toExist();
  });
});
