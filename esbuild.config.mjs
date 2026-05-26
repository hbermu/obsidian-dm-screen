import esbuild from "esbuild";
import process from "process";
import fs from "fs";
import path from "path";

const prod = process.argv[2] === "production";
const outDir = process.env.BUILD_OUT;
const mainOutfile = outDir ? path.join(outDir, "main.js") : "main.js";

if (outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of ["manifest.json", "styles.css"]) {
    if (fs.existsSync(f)) fs.copyFileSync(f, path.join(outDir, f));
  }
}

// Build the player screen separately (bundled as a string to serve via HTTP)
const playerScreenBuild = async () => {
  const result = await esbuild.build({
    entryPoints: ["src/player/player.ts"],
    bundle: true,
    write: false,
    format: "iife",
    target: "es2020",
    minify: prod,
  });
  return result.outputFiles[0].text;
};

const playerCss = fs.existsSync("src/player/player.css")
  ? fs.readFileSync("src/player/player.css", "utf-8")
  : "";

const playerHtml = fs.existsSync("src/player/index.html")
  ? fs.readFileSync("src/player/index.html", "utf-8")
  : "";

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
            const js = await playerScreenBuild();
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
