import esbuild from "esbuild";
import process from "process";
import fs from "fs";
import path from "path";
import { buildPlayerBundle, buildMapBundle } from "./scripts/build-player.mjs";

const prod = process.argv[2] === "production";
const outDir = process.env.BUILD_OUT;
const mainOutfile = outDir ? path.join(outDir, "main.js") : "main.js";

if (outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of ["manifest.json", "styles.css"]) {
    if (fs.existsSync(f)) fs.copyFileSync(f, path.join(outDir, f));
  }
}

const { css: playerCss, html: playerHtml } = await buildPlayerBundle({ minify: prod });
const { css: mapCss } = await buildMapBundle({ minify: prod });

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: mainOutfile,
  minify: prod,
  define: {
    "PLAYER_HTML": JSON.stringify(playerHtml),
    "PLAYER_CSS": JSON.stringify(playerCss),
    "MAP_CSS": JSON.stringify(mapCss),
  },
  plugins: [
    {
      name: "player-screen-inline",
      setup(build) {
        build.onResolve({ filter: /^player-screen-bundle$/ }, () => ({
          path: "player-screen-bundle",
          namespace: "player-inline",
        }));
        build.onLoad(
          { filter: /.*/, namespace: "player-inline" },
          async () => {
            const { js } = await buildPlayerBundle({ minify: prod });
            return {
              contents: `export default ${JSON.stringify(js)};`,
              loader: "js",
            };
          }
        );
      },
    },
    {
      name: "map-screen-inline",
      setup(build) {
        build.onResolve({ filter: /^map-screen-bundle$/ }, () => ({
          path: "map-screen-bundle",
          namespace: "map-inline",
        }));
        build.onLoad(
          { filter: /.*/, namespace: "map-inline" },
          async () => {
            const { js } = await buildMapBundle({ minify: prod });
            return {
              contents: `export default ${JSON.stringify(js)};`,
              loader: "js",
            };
          }
        );
      },
    },
  ],
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
