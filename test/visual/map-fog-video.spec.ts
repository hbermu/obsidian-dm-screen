import { test, expect } from "@playwright/test";
import { startTestServer, type StartedServer } from "./harness/startServer";
import { fogFullPng, gridPng, pngToDataUrl } from "./harness/pngEncoder";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MAP_W = 320;
const MAP_H = 240;

// Green video fixture: 320×240 VP9 webm, 2 frames, ~500 bytes
const webmBuf = readFileSync(resolve(__dirname, "harness/fixtures/green.webm"));
const videoDataUrl = `data:video/webm;base64,${webmBuf.toString("base64")}`;

// Fog that covers the entire map
const fogDataUrl = pngToDataUrl(fogFullPng(MAP_W, MAP_H));

const mapShowPayload = {
  url: videoDataUrl,
  mediaType: "video" as const,
  naturalWidth: MAP_W,
  naturalHeight: MAP_H,
  loop: true,
  muted: true,
};

let started: StartedServer;

test.beforeEach(async () => {
  started = await startTestServer();
});

test.afterEach(async () => {
  await started.stop();
});

async function waitForVideoLoaded(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => {
    const vid = document.getElementById("map-video") as HTMLVideoElement | null;
    return vid !== null && vid.style.display !== "none" && vid.videoWidth > 0;
  });
}

async function waitForFogLoaded(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => {
    const fog = document.getElementById("map-fog") as HTMLCanvasElement | null;
    return fog !== null && fog.style.display !== "none" && fog.width > 0;
  });
}

test("map-fog-video — full fog over video shows black", async ({ page }) => {
  await page.goto(`${started.url}/map`);
  await page.waitForFunction(() => (window as unknown as { __wsConnected?: boolean }).__wsConnected === true);

  started.server.broadcast({ type: "map-show", payload: mapShowPayload });
  await waitForVideoLoaded(page);

  started.server.broadcast({
    type: "map-fog",
    payload: { dataUrl: fogDataUrl, opacity: 1 },
  });
  await waitForFogLoaded(page);

  await expect(page).toHaveScreenshot("map-fog-video-full.png", {
    mask: [page.locator(".pulse-dot"), page.locator("#fullscreen-btn")],
  });
});

test("map-fog-video — null fog clears to show video", async ({ page }) => {
  await page.goto(`${started.url}/map`);
  await page.waitForFunction(() => (window as unknown as { __wsConnected?: boolean }).__wsConnected === true);

  started.server.broadcast({ type: "map-show", payload: mapShowPayload });
  await waitForVideoLoaded(page);

  // Apply full fog first
  started.server.broadcast({
    type: "map-fog",
    payload: { dataUrl: fogDataUrl, opacity: 1 },
  });
  await waitForFogLoaded(page);

  // Clear fog
  started.server.broadcast({
    type: "map-fog",
    payload: { dataUrl: null, opacity: 1 },
  });
  await page.waitForFunction(() => {
    const fog = document.getElementById("map-fog") as HTMLCanvasElement | null;
    return fog !== null && fog.style.display === "none";
  });

  await expect(page).toHaveScreenshot("map-fog-video-none.png", {
    mask: [page.locator(".pulse-dot"), page.locator("#fullscreen-btn")],
  });
});
