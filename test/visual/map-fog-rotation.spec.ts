import { test, expect } from "@playwright/test";
import { startTestServer, type StartedServer } from "./harness/startServer";
import { fogCircleRevealPng, fogFullPng, gridPng, pngToDataUrl } from "./harness/pngEncoder";

// Use a non-square map so that the rotation is visually obvious (asymmetric)
const MAP_W = 512;
const MAP_H = 384;

const mapImageDataUrl = pngToDataUrl(
  gridPng(MAP_W, MAP_H, 64, [60, 80, 120, 255], [100, 130, 180, 255]),
);

// Fog with a circle reveal off-center so rotation is verifiable
const fogDataUrl = pngToDataUrl(fogCircleRevealPng(MAP_W, MAP_H));

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

test("map-fog-rotation — 90° rotation moves the fog hole with the stage", async ({ page }) => {
  await page.goto(`${started.url}/map`);
  await page.waitForFunction(() => (window as unknown as { __wsConnected?: boolean }).__wsConnected === true);

  started.server.broadcast({ type: "map-show", payload: mapShowPayload });
  await waitForMapImageLoaded(page);

  // Apply fog with off-center circle reveal
  started.server.broadcast({
    type: "map-fog",
    payload: { dataUrl: fogDataUrl, opacity: 1 },
  });
  await waitForFogLoaded(page);

  // Apply 90° rotation
  started.server.broadcast({
    type: "map-view",
    payload: { mode: "fit", panX: MAP_W / 2, panY: MAP_H / 2, rotation: 90 },
  });

  // Wait until the map stage has the 90-degree rotation applied
  await page.waitForFunction(() => {
    const stage = document.getElementById("map-stage");
    return stage !== null && (stage.style.transform ?? "").includes("rotate(90deg)");
  });

  await expect(page).toHaveScreenshot("map-fog-rotated-90.png", {
    mask: [page.locator(".pulse-dot"), page.locator("#fullscreen-btn")],
  });
});
