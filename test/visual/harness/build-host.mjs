import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlayerBundle, buildMapBundle } from "../../../scripts/build-player.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const harnessOutDir = path.join(repoRoot, "test/visual/.harness");
const cjsOut = path.join(harnessOutDir, "server-host.cjs");

export default async function globalSetup() {
  const cwd = process.cwd();
  process.chdir(repoRoot);
  try {
    fs.mkdirSync(harnessOutDir, { recursive: true });
    const { js, css, html } = await buildPlayerBundle({ minify: true });
    const { js: mapJs, css: mapCss } = await buildMapBundle({ minify: true });

    await esbuild.build({
      entryPoints: [path.join(repoRoot, "test/visual/harness/server-entry.ts")],
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node20",
      outfile: cjsOut,
      external: ["ws"],
      alias: {
        obsidian: path.join(repoRoot, "test/stubs/obsidian.ts"),
      },
      define: {
        PLAYER_HTML: JSON.stringify(html),
        PLAYER_CSS: JSON.stringify(css),
        MAP_CSS: JSON.stringify(mapCss),
      },
      plugins: [
        {
          name: "player-screen-inline",
          setup(build) {
            build.onResolve({ filter: /^player-screen-bundle$/ }, () => ({
              path: "player-screen-bundle",
              namespace: "player-inline",
            }));
            build.onLoad({ filter: /.*/, namespace: "player-inline" }, () => ({
              contents: `module.exports = ${JSON.stringify(js)};`,
              loader: "js",
            }));
          },
        },
        {
          name: "map-screen-inline",
          setup(build) {
            build.onResolve({ filter: /^map-screen-bundle$/ }, () => ({
              path: "map-screen-bundle",
              namespace: "map-inline",
            }));
            build.onLoad({ filter: /.*/, namespace: "map-inline" }, () => ({
              contents: `module.exports = ${JSON.stringify(mapJs)};`,
              loader: "js",
            }));
          },
        },
      ],
      logLevel: "warning",
    });

    process.env.HARNESS_CJS = cjsOut;
  } finally {
    process.chdir(cwd);
  }
}
