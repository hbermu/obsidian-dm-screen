import { defineConfig } from "vitest/config";

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
      obsidian: new URL("./test/stubs/obsidian.ts", import.meta.url).pathname,
      "player-screen-bundle": new URL("./test/stubs/player-screen-bundle.ts", import.meta.url).pathname,
    },
  },
});
