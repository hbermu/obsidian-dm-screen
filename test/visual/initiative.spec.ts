import { test, expect } from "@playwright/test";
import { startTestServer, type StartedServer } from "./harness/startServer";
import { initiativePayload } from "./harness/fixtures";

let started: StartedServer;

test.beforeEach(async () => {
  started = await startTestServer({ ddbInspirationPulse: true });
});

test.afterEach(async () => {
  await started.stop();
});

test("initiative tracker — combatants, conditions, hidden HP, inspiration, active turn, round 3", async ({ page }) => {
  await page.goto(started.url);
  await page.waitForFunction(() => (window as unknown as { __wsConnected?: boolean }).__wsConnected === true);

  started.server.broadcast({
    type: "inspiration-style",
    payload: { pulse: true },
  });
  started.server.broadcast({
    type: "initiative-update",
    payload: initiativePayload,
  });

  await page.waitForFunction((expected) => {
    const rows = document.querySelectorAll("#initiative-list li.init-entry");
    return rows.length === expected;
  }, initiativePayload.combatants.length);

  await page.waitForFunction(() => {
    const heading = document.querySelector("#initiative-tracker h2");
    return !!heading && /Round\s+3/.test(heading.textContent ?? "");
  });

  await expect(page).toHaveScreenshot("initiative-tracker.png", {
    mask: [page.locator(".pulse-dot")],
  });
});
