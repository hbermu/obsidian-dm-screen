import { test, expect } from "@playwright/test";
import { startTestServer, type StartedServer } from "./harness/startServer";
import { backgroundImageDataUrl } from "./harness/fixtures";

let started: StartedServer;

test.beforeEach(async () => {
  started = await startTestServer();
});

test.afterEach(async () => {
  await started.stop();
});

test("background image — show-background-media", async ({ page }) => {
  await page.goto(started.url);
  await page.waitForFunction(() => (window as unknown as { __wsConnected?: boolean }).__wsConnected === true);

  started.server.broadcast({
    type: "show-background-media",
    payload: { url: backgroundImageDataUrl, mediaType: "image" },
  });

  await page.waitForFunction(() => {
    const img = document.getElementById("image-background") as HTMLImageElement | null;
    return !!img && img.complete && img.naturalWidth > 0 && img.style.display !== "none";
  });

  await expect(page).toHaveScreenshot("background-image.png", {
    mask: [page.locator(".pulse-dot")],
  });
});
