import { defineConfig, devices } from "@playwright/test";

// The mcr.microsoft.com/playwright image tag in docker-compose.yml MUST match
// the @playwright/test version in package.json. Bump them together.
export default defineConfig({
  testDir: "./test/visual",
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : [["list"]],
  globalSetup: "./test/visual/harness/build-host.mjs",
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.002,
      animations: "disabled",
    },
  },
  use: {
    headless: true,
    ...devices["Desktop Chrome"],
  },
  projects: [
    {
      name: "desktop",
      testIgnore: /[\\/]tablet\.spec\.ts$/,
      use: {
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: "tablet",
      testMatch: /[\\/]tablet\.spec\.ts$/,
      use: {
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
      },
    },
  ],
});
