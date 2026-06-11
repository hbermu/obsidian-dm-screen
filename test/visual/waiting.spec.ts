import { test, expect } from "@playwright/test";
import { startTestServer, type StartedServer } from "./harness/startServer";

let started: StartedServer;

test.beforeEach(async () => {
  started = await startTestServer({
    waitingTitle: "Player Screen",
    waitingSubtitle: "Waiting for DM to push content...",
  });
});

test.afterEach(async () => {
  await started.stop();
});

test("waiting screen — idle after WS connect", async ({ page }) => {
  await page.goto(started.url);
  await page.waitForFunction(() => (window as unknown as { __wsConnected?: boolean }).__wsConnected === true);
  await page.waitForSelector("#waiting-screen h1");
  await expect(page).toHaveScreenshot("waiting-idle.png", {
    mask: [page.locator(".pulse-dot")],
  });
});
