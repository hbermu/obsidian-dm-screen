import esbuild from "esbuild";
import fs from "fs";

export async function buildPlayerBundle({ minify = false } = {}) {
  const result = await esbuild.build({
    entryPoints: ["src/player/player.ts"],
    bundle: true,
    write: false,
    format: "iife",
    target: "es2020",
    minify,
  });
  const js = result.outputFiles[0].text;
  const css = fs.existsSync("src/player/player.css")
    ? fs.readFileSync("src/player/player.css", "utf-8")
    : "";
  const html = fs.existsSync("src/player/index.html")
    ? fs.readFileSync("src/player/index.html", "utf-8")
    : "";
  return { js, css, html };
}
