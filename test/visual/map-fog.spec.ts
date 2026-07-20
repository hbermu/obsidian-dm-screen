import { test, expect } from "@playwright/test";
import { startTestServer, type StartedServer } from "./harness/startServer";
import {
  fogFullDataUrl,
  fogCircleDataUrl,
} from "./harness/fixtures";
import { gridPng, pngToDataUrl } from "./harness/pngEncoder";

const MAP_W = 512;
const MAP_H = 384;

const mapImageDataUrl = pngToDataUrl(
  gridPng(MAP_W, MAP_H, 64, [60, 80, 120, 255], [100, 130, 180, 255]),
);

const mapShowPayload = {
  url: mapImageDataUrl,
  mediaType: "image" as const,
  naturalWidth: MAP_W,
  naturalHeight: MAP_H,
};

let started: StartedServer;

test.beforeEach(async () => {
  started = await startTestServer();
});

test.afterEach(async () => {
  await started.stop();
});

async function waitForMapImageLoaded(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => {
    const img = document.getElementById("map-image") as HTMLImageElement | null;
    return img !== null && img.style.display !== "none" && img.complete && img.naturalWidth > 0;
  });
}

async function waitForFogLoaded(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => {
    const fog = document.getElementById("map-fog") as HTMLCanvasElement | null;
    return fog !== null && fog.style.display !== "none" && fog.width > 0;
  });
}

test("map-fog — full fog cover", async ({ page }) => {
  await page.goto(`${started.url}/map`);
  await page.waitForFunction(() => (window as unknown as { __wsConnected?: boolean }).__wsConnected === true);

  started.server.broadcast({ type: "map-show", payload: mapShowPayload });
  await waitForMapImageLoaded(page);

  started.server.broadcast({
    type: "map-fog",
    payload: { dataUrl: fogFullDataUrl, opacity: 1 },
  });
  await waitForFogLoaded(page);

  await expect(page).toHaveScreenshot("map-fog-full.png", {
    mask: [page.locator(".pulse-dot"), page.locator("#fullscreen-btn")],
  });
});

test("map-fog — circular hole reveal", async ({ page }) => {
  await page.goto(`${started.url}/map`);
  await page.waitForFunction(() => (window as unknown as { __wsConnected?: boolean }).__wsConnected === true);

  started.server.broadcast({ type: "map-show", payload: mapShowPayload });
  await waitForMapImageLoaded(page);

  started.server.broadcast({
    type: "map-fog",
    payload: { dataUrl: fogCircleDataUrl, opacity: 1 },
  });
  await waitForFogLoaded(page);

  await expect(page).toHaveScreenshot("map-fog-hole.png", {
    mask: [page.locator(".pulse-dot"), page.locator("#fullscreen-btn")],
  });
});

test("map-fog — null dataUrl clears fog", async ({ page }) => {
  await page.goto(`${started.url}/map`);
  await page.waitForFunction(() => (window as unknown as { __wsConnected?: boolean }).__wsConnected === true);

  started.server.broadcast({ type: "map-show", payload: mapShowPayload });
  await waitForMapImageLoaded(page);

  started.server.broadcast({
    type: "map-fog",
    payload: { dataUrl: fogFullDataUrl, opacity: 1 },
  });
  await waitForFogLoaded(page);

  started.server.broadcast({
    type: "map-fog",
    payload: { dataUrl: null, opacity: 1 },
  });
  await page.waitForFunction(() => {
    const fog = document.getElementById("map-fog") as HTMLImageElement | null;
    return fog !== null && fog.style.display === "none";
  });

  await expect(page).toHaveScreenshot("map-fog-none.png", {
    mask: [page.locator(".pulse-dot"), page.locator("#fullscreen-btn")],
  });
});

test("map-fog — physical mode with pan and hole", async ({ page }) => {
  await page.goto(`${started.url}/map`);
  await page.waitForFunction(() => (window as unknown as { __wsConnected?: boolean }).__wsConnected === true);

  started.server.broadcast({ type: "map-show", payload: mapShowPayload });
  await waitForMapImageLoaded(page);

  started.server.broadcast({
    type: "map-view",
    payload: { mode: "physical", panX: MAP_W / 2, panY: MAP_H / 2, rotation: 0 },
  });
  // The uncalibrated hint turns visible synchronously with the physical-mode
  // layout — a DOM-observable signal that the transform has been applied.
  await page.waitForFunction(() => {
    const hint = document.getElementById("scale-hint");
    return hint !== null && hint.style.display === "block";
  });

  started.server.broadcast({
    type: "map-fog",
    payload: { dataUrl: fogCircleDataUrl, opacity: 1 },
  });
  await waitForFogLoaded(page);

  await expect(page).toHaveScreenshot("map-fog-physical.png", {
    mask: [page.locator(".pulse-dot"), page.locator("#fullscreen-btn"), page.locator("#scale-hint")],
  });
});
