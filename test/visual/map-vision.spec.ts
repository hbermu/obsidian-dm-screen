import { test, expect } from "@playwright/test";
import { startTestServer, type StartedServer } from "./harness/startServer";
import { gridPng, pngToDataUrl, fogFullPng } from "./harness/pngEncoder";

// Map is square so the fog canvas is also square — makes vision hole geometry
// easy to reason about in pixel coordinates.
const MAP_W = 512;
const MAP_H = 512;

// pxPerSquare=16 keeps the vision hole clearly contained inside the fog canvas.
// With scale = fogCanvas(1024) / naturalWidth(512) = 2:
//   ftToPx = (16/5) * 2 = 6.4
//   solid reveal radius  = 30 * 6.4 = 192 fog-canvas px
//   feather outer radius = 40 * 6.4 = 256 fog-canvas px
// The 1024×1024 fog canvas has ample black fog around the 512px-diameter hole.
const PX_PER_SQUARE = 16;

const mapImageDataUrl = pngToDataUrl(
  gridPng(MAP_W, MAP_H, 32, [60, 80, 120, 255], [100, 130, 180, 255]),
);

// Full-coverage fog (1024×1024 because fogCanvasSize(512, 512) → 1024×1024)
const fogDataUrl = pngToDataUrl(fogFullPng(1024, 1024));

const mapShowPayload = {
  url: mapImageDataUrl,
  mediaType: "image" as const,
  naturalWidth: MAP_W,
  naturalHeight: MAP_H,
};

// Vision at the exact center of the 512×512 map
const centerVision = {
  id: "v1",
  shape: "circle" as const,
  x: MAP_W / 2,
  y: MAP_H / 2,
  sizeFt: 30,
  featherFt: 10,
};

// A vertical wall to the right of center — blocks eastward sight from center.
// Placed at x = MAP_W/2 + 60 so a clear wall cut is visible in the fog hole.
const wallRightOfCenter = { x1: MAP_W / 2 + 60, y1: 0, x2: MAP_W / 2 + 60, y2: MAP_H };

// Same wall but as an open door
const openDoorRightOfCenter = { ...wallRightOfCenter, door: true, open: true };

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

/**
 * Wait until the fog canvas edge is opaque (confirming fog image rendered) and
 * the fog center is transparent (confirming vision erased it).
 *
 * Sampling the top-left corner at (2,2) for opaque fog and the canvas center
 * for the erased hole gives a deterministic two-condition signal that is
 * satisfied only after the full recomposite cycle (fog drawn + vision erased).
 */
async function waitForVisionHole(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => {
    const fog = document.getElementById("map-fog") as HTMLCanvasElement | null;
    if (!fog || fog.style.display === "none" || fog.width === 0) return false;
    const ctx = fog.getContext("2d");
    if (!ctx) return false;
    // Corner pixel must be opaque (fog not cleared)
    const corner = ctx.getImageData(2, 2, 1, 1).data;
    if (corner[3] < 200) return false;
    // Center pixel must be transparent (vision hole erased)
    const cx = Math.floor(fog.width / 2);
    const cy = Math.floor(fog.height / 2);
    const center = ctx.getImageData(cx, cy, 1, 1).data;
    return center[3] < 200;
  });
}

test("map-vision — feathered hole in the center of full fog", async ({ page }) => {
  await page.goto(`${started.url}/map`);
  await page.waitForFunction(() => (window as unknown as { __wsConnected?: boolean }).__wsConnected === true);

  started.server.broadcast({ type: "map-show", payload: mapShowPayload });
  await waitForMapImageLoaded(page);

  started.server.broadcast({ type: "map-config", payload: { pxPerSquare: PX_PER_SQUARE, gridOffsetX: 0, gridOffsetY: 0, showGrid: false, gridColor: "#ffffff", gridOpacity: 0 } });

  started.server.broadcast({ type: "map-fog", payload: { dataUrl: fogDataUrl, opacity: 1 } });
  await waitForFogLoaded(page);

  started.server.broadcast({ type: "map-vision", payload: { visions: [centerVision] } });
  await waitForVisionHole(page);

  await expect(page).toHaveScreenshot("map-vision-feather.png", {
    mask: [page.locator(".pulse-dot"), page.locator("#fullscreen-btn")],
  });
});

test("map-vision — wall clips the reveal (asymmetric hole)", async ({ page }) => {
  await page.goto(`${started.url}/map`);
  await page.waitForFunction(() => (window as unknown as { __wsConnected?: boolean }).__wsConnected === true);

  started.server.broadcast({ type: "map-show", payload: mapShowPayload });
  await waitForMapImageLoaded(page);

  started.server.broadcast({ type: "map-config", payload: { pxPerSquare: PX_PER_SQUARE, gridOffsetX: 0, gridOffsetY: 0, showGrid: false, gridColor: "#ffffff", gridOpacity: 0 } });

  started.server.broadcast({ type: "map-fog", payload: { dataUrl: fogDataUrl, opacity: 1 } });
  await waitForFogLoaded(page);

  started.server.broadcast({ type: "map-walls", payload: { walls: [wallRightOfCenter] } });
  started.server.broadcast({ type: "map-vision", payload: { visions: [centerVision] } });
  await waitForVisionHole(page);

  await expect(page).toHaveScreenshot("map-vision-wall-clip.png", {
    mask: [page.locator(".pulse-dot"), page.locator("#fullscreen-btn")],
  });
});

test("map-vision — open door restores symmetric hole", async ({ page }) => {
  await page.goto(`${started.url}/map`);
  await page.waitForFunction(() => (window as unknown as { __wsConnected?: boolean }).__wsConnected === true);

  started.server.broadcast({ type: "map-show", payload: mapShowPayload });
  await waitForMapImageLoaded(page);

  started.server.broadcast({ type: "map-config", payload: { pxPerSquare: PX_PER_SQUARE, gridOffsetX: 0, gridOffsetY: 0, showGrid: false, gridColor: "#ffffff", gridOpacity: 0 } });

  started.server.broadcast({ type: "map-fog", payload: { dataUrl: fogDataUrl, opacity: 1 } });
  await waitForFogLoaded(page);

  started.server.broadcast({ type: "map-walls", payload: { walls: [openDoorRightOfCenter] } });
  started.server.broadcast({ type: "map-vision", payload: { visions: [centerVision] } });
  await waitForVisionHole(page);

  await expect(page).toHaveScreenshot("map-vision-door-open.png", {
    mask: [page.locator(".pulse-dot"), page.locator("#fullscreen-btn")],
  });
});
