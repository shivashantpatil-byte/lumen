// Static checks that secrets cannot reach the browser or the repository.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const walk = (d, out = []) => { for (const n of readdirSync(d)) { if (n === "node_modules" || n === ".git") continue; const p = join(d, n); statSync(p).isDirectory() ? walk(p, out) : out.push(p); } return out; };
const root = fileURLToPath(new URL("..", import.meta.url));

test("nothing under public/ references secret env names or contains key-like strings", () => {
  for (const f of walk(join(root, "public"))) {
    if (!/\.(html|js|css|xml|txt|svg|json)$/.test(f)) continue;
    const t = readFileSync(f, "utf8");
    assert.doesNotMatch(t, /SERVICE_ROLE|service_role|SUPABASE_[A-Z_]*KEY/, `${f} mentions a secret name`);
    assert.doesNotMatch(t, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, `${f} contains a JWT-like string`);
    assert.doesNotMatch(t, /sb_secret_[A-Za-z0-9_-]+/, `${f} contains a Supabase secret key`);
    assert.doesNotMatch(t, /supabase\.co/, `${f} should not contain the Supabase URL`);
  }
});
test("no .env file is present, and .env.example holds placeholders only", () => {
  assert.ok(!existsSync(join(root, ".env")));
  const ex = readFileSync(join(root, ".env.example"), "utf8");
  assert.match(ex, /SUPABASE_SERVICE_ROLE_KEY=replace-with/); assert.doesNotMatch(ex, /eyJ/);
});
test(".gitignore excludes env files and node_modules", () => {
  const g = readFileSync(join(root, ".gitignore"), "utf8"); assert.match(g, /^\.env$/m); assert.match(g, /node_modules/);
});
test("Formspree is fully removed from the public site", () => {
  for (const f of walk(join(root, "public"))) { if (/\.(html|js)$/.test(f)) assert.doesNotMatch(readFileSync(f, "utf8"), /formspree/i, f); }
});
test("only the intended environment variable names are used by the functions", () => {
  const names = new Set();
  for (const f of walk(join(root, "netlify"))) for (const m of readFileSync(f, "utf8").matchAll(/env\.([A-Z_]+)/g)) names.add(m[1]);
  assert.deepEqual([...names].sort(), ["SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL"]);
});
