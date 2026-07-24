import * as path from "node:path";
import { env } from "node:process";
import { parseObsidianVersions } from "wdio-obsidian-service";

const cacheDir = path.resolve(".obsidian-cache");

// Space-separated app/installer pairs, e.g. "earliest/earliest latest/latest".
// Local default is latest/latest only: Obsidian versions before ~1.12 ship no
// linux-arm64 build, so the earliest leg runs in CI (amd64) via the matrix.
const versions = await parseObsidianVersions(
  env.OBSIDIAN_VERSIONS ?? "latest/latest",
  { cacheDir },
);

export const config: WebdriverIO.Config = {
  runner: "local",
  framework: "mocha",
  specs: ["./test/e2e/specs/**/*.e2e.ts"],
  // One Obsidian at a time: specs bind the plugin server to fixed localhost
  // ports; parallel instances would race on them.
  maxInstances: 1,
  capabilities: versions.map(([appVersion, installerVersion]) => ({
    browserName: "obsidian",
    "wdio:obsidianOptions": {
      appVersion,
      installerVersion,
      plugins: ["."],
      vault: "test/e2e/vault",
    },
    // The container runs as root, so Electron needs --no-sandbox; the shm and
    // gpu flags harden headless Chromium under Docker.
    "goog:chromeOptions": {
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    },
  })),
  services: ["obsidian"],
  reporters: ["obsidian"],
  mochaOpts: { ui: "bdd", timeout: 60_000 },
  waitforInterval: 250,
  waitforTimeout: 10_000,
  cacheDir,
  outputDir: "wdio-logs",
  logLevel: "warn",
  injectGlobals: false,
};
