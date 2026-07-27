import { browser, expect } from "@wdio/globals";
import { openPanel, openFixtureNote, startServer, addMap, DEFAULT_PORT } from "../helpers/obsidian";
import { WsRecorder, WsMessage } from "../helpers/ws";

// map-controls.e2e.ts covers the calibration modal's test-pattern toggle. This
// file covers the rest of calibration.md: the diagonal input saving a profile
// and broadcasting map-calibration, the fine-tune multiplier, the ✓ badge, and
// clearing the diagonal to delete the profile.

const KEY = "1920x1080@1";
type Profile = { diagonalInches: number; fineTune: number };
const profiles = (m: WsMessage) => m.payload.profiles as Record<string, Profile | undefined>;

function badge() {
  return browser.$(".dm-control-panel .dm-client-resolution");
}

async function openModal(): Promise<void> {
  await badge().waitForExist();
  await badge().click();
  await browser.$(".modal input[type='text']").waitForExist();
}

async function closeModal(): Promise<void> {
  await browser.$(".modal-close-button").click();
  await browser.$(".modal-close-button").waitForExist({ reverse: true });
}

async function setDiagonal(value: string): Promise<void> {
  await browser.executeObsidian((_app, v: string) => {
    const input = document.querySelector(".modal input[type='text']") as HTMLInputElement;
    input.value = v;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function setFineTune(value: number): Promise<void> {
  await browser.executeObsidian((_app, v: number) => {
    const slider = document.querySelector(".modal input[type='range']") as HTMLInputElement;
    slider.value = String(v);
    // Obsidian's SliderComponent commits on "change"; "input" only streams.
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    slider.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function savedProfile(): Promise<Profile | null> {
  return browser.executeObsidian(({ app }) => {
    const plugin = (app as any).plugins.plugins["dm-screen"];
    return plugin.settings.mapScreenProfiles["1920x1080@1"] ?? null;
  });
}

describe("map screen physical calibration", function () {
  let rec: WsRecorder;

  before(async function () {
    await openPanel();
    await openFixtureNote();
    await startServer();
    rec = await WsRecorder.connect(DEFAULT_PORT, "map");
    await addMap();
    await rec.waitFor("map-show");
    rec.send({ type: "client-info", payload: { width: 1920, height: 1080, devicePixelRatio: 1 } });
    await badge().waitForExist();
  });

  after(function () {
    rec.close();
  });

  // Safety net: if a test throws before closeModal, don't let the backdrop
  // intercept the next test's badge click.
  afterEach(async function () {
    const close = browser.$(".modal-close-button");
    if (await close.isExisting()) {
      await close.click();
      await close.waitForExist({ reverse: true });
    }
  });

  it("entering a diagonal saves the profile and broadcasts map-calibration", async function () {
    await openModal();
    const seen = rec.count("map-calibration");
    await setDiagonal("43");
    const cal = await rec.waitFor("map-calibration", {
      skip: seen,
      where: (m) => profiles(m)[KEY]?.diagonalInches === 43,
    });
    expect(profiles(cal)[KEY]?.diagonalInches).toBe(43);

    expect((await savedProfile())?.diagonalInches).toBe(43);
    await closeModal();
  });

  it("the resolution badge shows ✓ once a profile exists", async function () {
    await browser.waitUntil(async () => (await badge().getText()).includes("✓"));
    expect(await badge().getText()).toContain("1920×1080");
  });

  it("the fine-tune slider updates the broadcast profile", async function () {
    await openModal();
    const seen = rec.count("map-calibration");
    await setFineTune(1.05);
    const cal = await rec.waitFor("map-calibration", {
      skip: seen,
      where: (m) => Math.abs((profiles(m)[KEY]?.fineTune ?? 1) - 1.05) < 0.001,
    });
    expect(profiles(cal)[KEY]?.fineTune).toBeCloseTo(1.05, 3);
    expect((await savedProfile())?.fineTune).toBeCloseTo(1.05, 3);
    await closeModal();
  });

  it("clearing the diagonal deletes the profile and broadcasts its removal", async function () {
    await openModal();
    const seen = rec.count("map-calibration");
    await setDiagonal("");
    await rec.waitFor("map-calibration", {
      skip: seen,
      where: (m) => profiles(m)[KEY] === undefined,
    });
    expect(await savedProfile()).toBe(null);
    await closeModal();
  });
});
