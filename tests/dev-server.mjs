// TEST HARNESS (not used in production). Serves public/ like Netlify would (CSP from netlify.toml,
// 404.html for unknown paths) and runs the REAL Netlify Function code at their /api/* paths.
// Only Supabase is replaced, by the in-memory fake. Used by tests/e2e.py (Playwright).
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { installFakeSupabase, setEnv } from "./fake-supabase.mjs";

const root = new URL("..", import.meta.url).pathname;
const pub = join(root, "public");
const toml = readFileSync(join(root, "netlify.toml"), "utf8");
const CSP = /Content-Security-Policy\s*=\s*"([^"]+)"/.exec(toml)[1];

setEnv(); const fake = installFakeSupabase();
const fnFiles = ["submit-inquiry", "admin-login", "admin-refresh", "admin-logout", "admin-inquiries", "admin-inquiry-status"];
const routes = new Map(); const limiters = [];
for (const f of fnFiles) {
  const m = await import(`../netlify/functions/${f}.mjs`);
  routes.set(m.config.path, m.default); if (m.limiter) limiters.push(m.limiter);
}
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".xml": "application/xml", ".txt": "text/plain" };

const server = http.createServer(async (nreq, nres) => {
  const url = new URL(nreq.url, "http://localhost");
  const chunks = []; for await (const c of nreq) chunks.push(c); const body = Buffer.concat(chunks);

  if (url.pathname === "/__test/state") {
    if (nreq.method === "POST") {
      const o = JSON.parse(body.toString() || "{}");
      if (o.reset) { fake.state.inquiries.length = 0; fake.state.calls.length = 0; fake.state.signedOut.length = 0; fake.state.failInsert = false; fake.state.networkDown = false; fake.state.delayMs = 0; fake.state.admins = new Set(["admin-user-id"]); limiters.forEach((l) => l.reset()); }
      for (const k of ["failInsert", "networkDown", "delayMs"]) if (k in o) fake.state[k] = o[k];
      if (o.seed) for (let i = 1; i <= o.seed; i++) fake.state.inquiries.push({ id: `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`, name: `Seed Person ${i}`, email: `seed${i}@example.test`, project_type: ["residential","hospitality","commercial","other"][i % 4], message: `Seed message ${i}`, status: i % 3 === 0 ? "responded" : "new", created_at: new Date(1700000000000 + i * 60000).toISOString(), updated_at: new Date(1700000000000 + i * 60000).toISOString() });
    }
    nres.writeHead(200, { "Content-Type": "application/json" }); return nres.end(JSON.stringify({ inquiries: fake.state.inquiries, signedOut: fake.state.signedOut, callCount: fake.state.calls.length }));
  }

  const fn = routes.get(url.pathname);
  if (fn) {
    const headers = new Headers(); for (const [k, v] of Object.entries(nreq.headers)) headers.set(k, String(v));
    const init = { method: nreq.method, headers }; if (!["GET", "HEAD"].includes(nreq.method)) init.body = body;
    const res = await fn(new Request(`http://${nreq.headers.host}${nreq.url}`, init), { ip: nreq.headers["x-test-ip"] || "127.0.0.1" });
    const out = {}; res.headers.forEach((v, k) => (out[k] = v)); nres.writeHead(res.status, out); return nres.end(Buffer.from(await res.arrayBuffer()));
  }

  let p; try { p = decodeURIComponent(url.pathname); } catch { nres.writeHead(400); return nres.end("Bad request"); }
  if (p.endsWith("/")) p += "index.html";
  let file = join(pub, p); let status = 200;
  if (!file.startsWith(pub) || !existsSync(file) || !statSync(file).isFile()) { file = join(pub, "404.html"); status = 404; }
  const headers = { "Content-Type": types[extname(file)] || "application/octet-stream", "Content-Security-Policy": CSP, "X-Content-Type-Options": "nosniff" };
  if (url.pathname.startsWith("/admin/")) { headers["X-Robots-Tag"] = "noindex, nofollow, noarchive"; headers["Cache-Control"] = "no-store"; }
  nres.writeHead(status, headers); nres.end(readFileSync(file));
});
server.listen(Number(process.env.PORT || 8790), "127.0.0.1", () => console.log("dev server ready"));
