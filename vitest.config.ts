import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
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
