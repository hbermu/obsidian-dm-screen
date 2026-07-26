import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["src/**/*.ts"],
      // The player and map screens are browser bundles that vitest cannot run;
      // they are covered by the Playwright visual suite and the real-Obsidian
      // e2e suite, so they are excluded from the vitest coverage denominator.
      exclude: ["src/player/player.ts", "src/map/map.ts"],
    },
  },
  resolve: {
    alias: {
      obsidian: resolve(__dirname, "test/stubs/obsidian.ts"),
      "player-screen-bundle": resolve(__dirname, "test/stubs/player-screen-bundle.ts"),
      "map-screen-bundle": resolve(__dirname, "test/stubs/map-screen-bundle.ts"),
    },
  },
});
