import { test, expect } from "@playwright/test";
import { startTestServer, type StartedServer } from "./harness/startServer";
import {
  twoLayersBase,
  layersWithFog,
  fogFullDataUrl,
  fogCircleDataUrl,
  fogRectDataUrl,
  fogFreehandDataUrl,
} from "./harness/fixtures";

let started: StartedServer;

test.beforeEach(async () => {
  started = await startTestServer();
});

test.afterEach(async () => {
  await started.stop();
});

async function waitForLayerImagesLoaded(page: import("@playwright/test").Page, expectedImgCount: number) {
  await page.waitForFunction((expected) => {
    const inner = document.getElementById("image-layers-inner");
    if (!inner) return false;
    const imgs = Array.from(inner.querySelectorAll("img")) as HTMLImageElement[];
    if (imgs.length < expected) return false;
    return imgs.every((i) => i.complete && i.naturalWidth > 0);
  }, expectedImgCount);
}

test("layers + fog — full fog", async ({ page }) => {
  await page.goto(started.url);
  await page.waitForFunction(() => (window as unknown as { __wsConnected?: boolean }).__wsConnected === true);

  started.server.broadcast({
    type: "image-layers-sync",
    payload: { layers: layersWithFog(fogFullDataUrl) },
  });

  await waitForLayerImagesLoaded(page, 4);
  await expect(page).toHaveScreenshot("layers-fog-full.png");
});

test("layers + fog — circle reveal", async ({ page }) => {
  await page.goto(started.url);
  await page.waitForFunction(() => (window as unknown as { __wsConnected?: boolean }).__wsConnected === true);

  started.server.broadcast({
    type: "image-layers-sync",
    payload: { layers: layersWithFog(fogCircleDataUrl) },
  });

  await waitForLayerImagesLoaded(page, 4);
  await expect(page).toHaveScreenshot("layers-fog-circle.png");
});

test("layers + fog — rect reveal", async ({ page }) => {
  await page.goto(started.url);
  await page.waitForFunction(() => (window as unknown as { __wsConnected?: boolean }).__wsConnected === true);

  started.server.broadcast({
    type: "image-layers-sync",
    payload: { layers: layersWithFog(fogRectDataUrl) },
  });

  await waitForLayerImagesLoaded(page, 4);
  await expect(page).toHaveScreenshot("layers-fog-rect.png");
});

test("layers + fog — freehand reveal", async ({ page }) => {
  await page.goto(started.url);
  await page.waitForFunction(() => (window as unknown as { __wsConnected?: boolean }).__wsConnected === true);

  started.server.broadcast({
    type: "image-layers-sync",
    payload: { layers: layersWithFog(fogFreehandDataUrl) },
  });

  await waitForLayerImagesLoaded(page, 4);
  await expect(page).toHaveScreenshot("layers-fog-freehand.png");
});

test("layers — no fog (sanity baseline for diffs)", async ({ page }) => {
  await page.goto(started.url);
  await page.waitForFunction(() => (window as unknown as { __wsConnected?: boolean }).__wsConnected === true);

  started.server.broadcast({
    type: "image-layers-sync",
    payload: { layers: twoLayersBase },
  });

  await waitForLayerImagesLoaded(page, 2);
  await expect(page).toHaveScreenshot("layers-no-fog.png");
});
