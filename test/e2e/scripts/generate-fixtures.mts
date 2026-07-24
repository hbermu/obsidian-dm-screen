import * as fs from "node:fs";
import * as path from "node:path";
import { gridPng } from "../../visual/harness/pngEncoder";

const out = path.resolve(import.meta.dirname, "../vault/attachments/map.png");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, gridPng(560, 420, 70, [214, 196, 158, 255], [96, 76, 56, 255]));
console.log("wrote", out, `${fs.statSync(out).size} bytes`);
