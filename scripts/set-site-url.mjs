// Replaces the %%SITE_URL%% placeholder in public/ files with the real site URL.
// Runs as the Netlify build command. Refuses to rewrite files on a developer machine
// unless --force is given, so the placeholders stay in the committed source.
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const TOKEN = "%%SITE_URL%%";
const force = process.argv.includes("--force");
const dry = process.argv.includes("--dry");

if (!process.env.NETLIFY && !force) {
  console.log("Not running on Netlify; leaving %%SITE_URL%% placeholders untouched (use --force to override).");
  process.exit(0);
}

const raw = (process.env.SITE_URL || process.env.URL || "").trim().replace(/\/+$/, "");
if (!/^https:\/\/[^\s/]+$/.test(raw) && !/^http:\/\/localhost(:\d+)?$/.test(raw)) {
  console.error(`SITE_URL/URL must be an origin like https://example.netlify.app (got "${raw}").`);
  process.exit(1);
}

const exts = new Set([".html", ".xml", ".txt"]);
let files = 0, replaced = 0;
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!exts.has(extname(p))) continue;
    const text = readFileSync(p, "utf8");
    if (!text.includes(TOKEN)) continue;
    const n = text.split(TOKEN).length - 1;
    if (!dry) writeFileSync(p, text.split(TOKEN).join(raw));
    files++; replaced += n;
  }
})("public");
console.log(`${dry ? "[dry run] " : ""}Replaced ${replaced} placeholder(s) in ${files} file(s) with ${raw}`);
