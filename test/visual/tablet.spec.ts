import { test, expect } from "@playwright/test";
import { startTestServer, type StartedServer } from "./harness/startServer";
import { layersWithFog, fogCircleDataUrl } from "./harness/fixtures";

let started: StartedServer;

test.beforeEach(async () => {
  started = await startTestServer();
});

test.afterEach(async () => {
  await started.stop();
});

test("tablet viewport — layers + fog at 1280×800 (per-client resolution path)", async ({ page }) => {
  await page.goto(started.url);
  await page.waitForFunction(() => (window as unknown as { __wsConnected?: boolean }).__wsConnected === true);
  await expect.poll(() => started.server.clientCount).toBe(1);

  started.server.broadcast({
    type: "image-layers-sync",
    payload: { layers: layersWithFog(fogCircleDataUrl) },
  });

  await page.waitForFunction(() => {
    const inner = document.getElementById("image-layers-inner");
    if (!inner) return false;
    const imgs = Array.from(inner.querySelectorAll("img")) as HTMLImageElement[];
    return imgs.length === 4 && imgs.every((i) => i.complete && i.naturalWidth > 0);
  });

  await expect(page).toHaveScreenshot("tablet-layers-fog.png");
});
