import { browser, expect } from "@wdio/globals";
import { openPanel, startServer, DEFAULT_PORT } from "../helpers/obsidian";
import { WsRecorder } from "../helpers/ws";

// The preview's pan/zoom are local-only (no broadcast), so these read the DM
// panel's runtime state and the preview transform rather than the wire. Fields
// are TS-private but plain properties at runtime.
async function previewState(): Promise<{
  dmZoom: number;
  dmPanX: number;
  dmPanY: number;
  selectedResolution: { width: number; height: number } | null;
  transform: string;
}> {
  return browser.executeObsidian(({ app }) => {
    const panel = (app as any).workspace.getLeavesOfType("dm-control-panel")[0].view;
    const inner = document.querySelector(".dm-control-panel .dm-layer-preview-inner") as HTMLElement | null;
    return {
      dmZoom: panel.dmZoom,
      dmPanX: panel.dmPanX,
      dmPanY: panel.dmPanY,
      selectedResolution: panel.selectedResolution,
      transform: inner?.style.transform ?? "",
    };
  });
}

async function setZoom(value: number): Promise<void> {
  await browser.executeObsidian((_app, v: number) => {
    const s = document.querySelector(".dm-control-panel .dm-layer-preview .dm-zoom-slider") as HTMLInputElement;
    s.value = String(v);
    s.dispatchEvent(new Event("input"));
  }, value);
}

// Middle-button drag: the handler binds mousedown on the preview (button 1) and
// mousemove/mouseup on document; dmPanX/Y advance by delta/bounds * 100.
async function panMiddle(fracX: number, fracY: number): Promise<void> {
  await browser.executeObsidian((_app, f: { fx: number; fy: number }) => {
    const preview = document.querySelector(".dm-control-panel .dm-layer-preview") as HTMLElement;
    const b = preview.getBoundingClientRect();
    const cx = b.left + b.width / 2;
    const cy = b.top + b.height / 2;
    const tx = cx + b.width * f.fx;
    const ty = cy + b.height * f.fy;
    preview.dispatchEvent(new MouseEvent("mousedown", { button: 1, clientX: cx, clientY: cy, bubbles: true }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: tx, clientY: ty, bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { button: 1, clientX: tx, clientY: ty, bubbles: true }));
  }, { fx: fracX, fy: fracY });
}

function sendClient(rec: WsRecorder, width: number, height: number): void {
  rec.send({ type: "client-info", payload: { width, height, devicePixelRatio: 1 } });
}

// The Map Screen section renders its own `.dm-client-info` / `.dm-client-resolution`
// row for map-channel clients; the player row is the one whose status text does
// not mention "map". Scope every badge query to it.
async function playerBadges(): Promise<{ text: string; active: boolean }[]> {
  return browser.executeObsidian(() => {
    const rows = Array.from(document.querySelectorAll(".dm-control-panel .dm-client-info"));
    const playerRow = rows.find((el) => !((el.querySelector(".dm-status-detail")?.textContent) ?? "").includes("map"));
    if (!playerRow) return [];
    return Array.from(playerRow.querySelectorAll(".dm-client-resolution")).map((b) => ({
      text: b.textContent ?? "",
      active: b.classList.contains("dm-client-resolution-active"),
    }));
  });
}

async function playerStatusText(): Promise<string> {
  return browser.executeObsidian(() => {
    const rows = Array.from(document.querySelectorAll(".dm-control-panel .dm-client-info"));
    const playerRow = rows.find((el) => !((el.querySelector(".dm-status-detail")?.textContent) ?? "").includes("map"));
    return (playerRow?.querySelector(".dm-status-detail")?.textContent) ?? "";
  });
}

async function clickPlayerBadge(text: string): Promise<void> {
  await browser.executeObsidian((_app, t: string) => {
    const rows = Array.from(document.querySelectorAll(".dm-control-panel .dm-client-info"));
    const playerRow = rows.find((el) => !((el.querySelector(".dm-status-detail")?.textContent) ?? "").includes("map"));
    const badge = Array.from(playerRow!.querySelectorAll(".dm-client-resolution")).find((b) => b.textContent === t) as HTMLElement;
    badge.click();
  }, text);
}

describe("DM preview pan and zoom", function () {
  let rec: WsRecorder;

  before(async function () {
    await openPanel();
    await startServer();
    rec = await WsRecorder.connect(DEFAULT_PORT, "player");
    // Let any connect-time late-joiner replay land before tests baseline the
    // wire — pan/zoom emit nothing, so message counts must be stable.
    await browser.pause(500);
  });

  after(function () {
    rec.close();
  });

  it("the zoom slider scales the preview inner and broadcasts nothing", async function () {
    const baseline = rec.messages.length;
    await setZoom(80);
    const s = await previewState();
    expect(s.dmZoom).toBe(0.8);
    expect(s.transform).toContain("scale(0.8)");
    await browser.pause(300);
    expect(rec.messages.length).toBe(baseline);
    expect(rec.count("viewport-update")).toBe(0);
  });

  it("middle-click drag pans the preview inner and broadcasts nothing", async function () {
    const baseline = rec.messages.length;
    await panMiddle(0.1, 0.2);
    const s = await previewState();
    expect(Math.abs(s.dmPanX - 10)).toBeLessThan(0.5);
    expect(Math.abs(s.dmPanY - 20)).toBeLessThan(0.5);
    expect(s.transform).toContain("translate(");
    await browser.pause(300);
    expect(rec.messages.length).toBe(baseline);
    expect(rec.count("viewport-update")).toBe(0);
  });

  it("Reset View restores zoom and pan to defaults", async function () {
    await setZoom(70);
    await panMiddle(0.15, 0.1);
    await browser.$(".dm-control-panel .dm-preview-reset-btn").click();
    await browser.waitUntil(async () => (await previewState()).dmZoom === 1);
    const s = await previewState();
    expect(s.dmZoom).toBe(1);
    expect(s.dmPanX).toBe(0);
    expect(s.dmPanY).toBe(0);
    expect(s.transform).toBe("translate(0%, 0%) scale(1)");
  });
});

describe("connected-screen resolution badges", function () {
  const recs: WsRecorder[] = [];

  before(async function () {
    await openPanel();
    await startServer();
  });

  async function connectClient(width: number, height: number): Promise<void> {
    const r = await WsRecorder.connect(DEFAULT_PORT, "player");
    recs.push(r);
    sendClient(r, width, height);
  }

  afterEach(async function () {
    while (recs.length) recs.pop()!.close();
    await browser.waitUntil(async () => (await playerBadges()).length === 0);
  });

  it("a single connected player renders one active resolution badge", async function () {
    await connectClient(1920, 1080);
    await browser.waitUntil(async () => (await playerBadges()).length === 1);
    expect(await playerStatusText()).toBe("1 screen connected");
    const badges = await playerBadges();
    expect(badges[0].text).toBe("1920×1080");
    expect(badges[0].active).toBe(true);
  });

  it("two distinct resolutions render two badges", async function () {
    await connectClient(1920, 1080);
    await connectClient(1280, 800);
    await browser.waitUntil(async () => (await playerBadges()).length === 2);
    expect(await playerStatusText()).toBe("2 screens connected");
    const texts = (await playerBadges()).map((b) => b.text).sort();
    expect(texts).toEqual(["1280×800", "1920×1080"]);
  });

  it("two clients at the same resolution collapse to one ×count badge", async function () {
    await connectClient(1920, 1080);
    await connectClient(1920, 1080);
    await browser.waitUntil(async () => (await playerStatusText()) === "2 screens connected");
    const badges = await playerBadges();
    expect(badges.length).toBe(1);
    expect(badges[0].text).toBe("1920×1080 ×2");
  });

  it("clicking a badge selects that resolution", async function () {
    await connectClient(1920, 1080);
    await connectClient(1280, 800);
    await browser.waitUntil(async () => (await playerBadges()).length === 2);
    await clickPlayerBadge("1280×800");
    await browser.waitUntil(async () => {
      const s = await previewState();
      return s.selectedResolution?.width === 1280 && s.selectedResolution?.height === 800;
    });
    const active = (await playerBadges()).find((b) => b.active);
    expect(active?.text).toBe("1280×800");
  });

  it("a map-channel client stays out of the player badge row", async function () {
    await connectClient(1920, 1080);
    await browser.waitUntil(async () => (await playerBadges()).length === 1);
    const mapRec = await WsRecorder.connect(DEFAULT_PORT, "map");
    recs.push(mapRec);
    sendClient(mapRec, 3840, 2160);
    await browser.pause(400);
    const badges = await playerBadges();
    expect(badges.length).toBe(1);
    expect(badges[0].text).toBe("1920×1080");
  });
});

describe("green viewport indicator", function () {
  const recs: WsRecorder[] = [];
  const rect = () => browser.$(".dm-control-panel .dm-layer-preview-inner .dm-player-viewport-rect");

  before(async function () {
    await openPanel();
    await startServer();
  });

  async function connectClient(width: number, height: number): Promise<void> {
    const r = await WsRecorder.connect(DEFAULT_PORT, "player");
    recs.push(r);
    sendClient(r, width, height);
  }

  afterEach(async function () {
    while (recs.length) recs.pop()!.close();
    await browser.waitUntil(async () => (await playerBadges()).length === 0);
  });

  it("shows for exactly one client and hides once a second connects", async function () {
    await connectClient(1920, 1080);
    await rect().waitForExist();

    await connectClient(1280, 800);
    await browser.waitUntil(async () => (await playerBadges()).length === 2);
    await rect().waitForExist({ reverse: true });
  });
});
