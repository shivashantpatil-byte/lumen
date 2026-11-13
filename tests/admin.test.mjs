import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import inquiries from "../netlify/functions/admin-inquiries.mjs";
import statusFn from "../netlify/functions/admin-inquiry-status.mjs";
import login, { limiter as loginLimiter } from "../netlify/functions/admin-login.mjs";
import refresh from "../netlify/functions/admin-refresh.mjs";
import logout from "../netlify/functions/admin-logout.mjs";
import { installFakeSupabase, setEnv, req } from "./fake-supabase.mjs";

const ADMIN = { Authorization: "Bearer tok-admin-aaaaaaaaaaaaaaaaaaaa" };
const PLAIN = { Authorization: "Bearer tok-plain-aaaaaaaaaaaaaaaaaaaa" };
let fake;
const seed = () => { for (let i = 1; i <= 30; i++) fake.state.inquiries.push({
  id: `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`, name: `Person ${i}`, email: `p${i}@example.test`, project_type: "other",
  message: `Message body ${i}`, status: i % 3 === 0 ? "responded" : "new", created_at: new Date(1700000000000 + i * 1000).toISOString(), updated_at: "x" }); };
beforeEach(() => { setEnv(); fake = installFakeSupabase(); loginLimiter.reset(); seed(); });
afterEach(() => fake.restore());

test("no token -> 401; garbage token -> 401; valid non-admin -> 403 (list)", async () => {
  assert.equal((await inquiries(req("/api/admin/inquiries"))).status, 401);
  assert.equal((await inquiries(req("/api/admin/inquiries", { headers: { Authorization: "Bearer not-a-real-token-xxxxxxxxxxxxxx" } }))).status, 401);
  assert.equal((await inquiries(req("/api/admin/inquiries", { headers: PLAIN }))).status, 403);
});
test("non-admin cannot read detail or update; data unchanged", async () => {
  const id = fake.state.inquiries[0].id;
  assert.equal((await inquiries(req(`/api/admin/inquiries?id=${id}`, { headers: PLAIN }))).status, 403);
  const before = fake.state.inquiries[0].status;
  const res = await statusFn(req("/api/admin/inquiries/status", { method: "PATCH", headers: PLAIN, body: { id, status: "archived" } }));
  assert.equal(res.status, 403); assert.equal(fake.state.inquiries[0].status, before);
});
test("a client-side 'admin' flag is ignored (header/body/query)", async () => {
  const res = await inquiries(req("/api/admin/inquiries?admin=true&role=admin", { headers: { ...PLAIN, "X-Admin": "true" } }));
  assert.equal(res.status, 403);
});
test("admin list: 200, newest first, 25 per page, total, and NO message bodies", async () => {
  const res = await inquiries(req("/api/admin/inquiries", { headers: ADMIN })); const b = await res.json();
  assert.equal(res.status, 200); assert.equal(b.items.length, 25); assert.equal(b.total, 30); assert.equal(b.page, 1);
  assert.ok(b.items[0].created_at > b.items[1].created_at);
  assert.ok(b.items.every((i) => !("message" in i)), "list must not include message bodies");
  assert.equal((await (await inquiries(req("/api/admin/inquiries?page=2", { headers: ADMIN }))).json()).items.length, 5);
});
test("admin list: sort asc, status filter, invalid filter rejected", async () => {
  const asc = await (await inquiries(req("/api/admin/inquiries?sort=asc", { headers: ADMIN }))).json();
  assert.ok(asc.items[0].created_at < asc.items[1].created_at);
  const f = await (await inquiries(req("/api/admin/inquiries?status=responded", { headers: ADMIN }))).json();
  assert.equal(f.total, 10); assert.ok(f.items.every((i) => i.status === "responded"));
  assert.equal((await inquiries(req("/api/admin/inquiries?status=bogus", { headers: ADMIN }))).status, 400);
});
test("admin detail: full record; unknown id 404; malformed id 400", async () => {
  const id = fake.state.inquiries[4].id;
  const res = await inquiries(req(`/api/admin/inquiries?id=${id}`, { headers: ADMIN })); const b = await res.json();
  assert.equal(res.status, 200); assert.equal(b.item.message, "Message body 5");
  assert.equal((await inquiries(req("/api/admin/inquiries?id=20000000-0000-4000-8000-000000000000", { headers: ADMIN }))).status, 404);
  assert.equal((await inquiries(req("/api/admin/inquiries?id=1;drop table", { headers: ADMIN }))).status, 400);
});
test("admin can update status; response has only id/status/updated_at", async () => {
  const id = fake.state.inquiries[0].id;
  const res = await statusFn(req("/api/admin/inquiries/status", { method: "PATCH", headers: ADMIN, body: { id, status: "in_progress" } }));
  const b = await res.json(); assert.equal(res.status, 200); assert.deepEqual(Object.keys(b.item).sort(), ["id", "status", "updated_at"]);
  assert.equal(fake.state.inquiries[0].status, "in_progress");
});
test("invalid status / malformed id / extra fields are rejected or ignored", async () => {
  const id = fake.state.inquiries[0].id;
  assert.equal((await statusFn(req("/api/admin/inquiries/status", { method: "PATCH", headers: ADMIN, body: { id, status: "deleted" } }))).status, 422);
  assert.equal((await statusFn(req("/api/admin/inquiries/status", { method: "PATCH", headers: ADMIN, body: { id: "nope", status: "new" } }))).status, 422);
  await statusFn(req("/api/admin/inquiries/status", { method: "PATCH", headers: ADMIN, body: { id, status: "archived", message: "tampered", email: "x@y.zz" } }));
  assert.equal(fake.state.inquiries[0].message, "Message body 1", "only status may change");
  assert.equal((await statusFn(req("/api/admin/inquiries/status", { method: "PATCH", headers: ADMIN, body: { id: "30000000-0000-4000-8000-000000000000", status: "new" } }))).status, 404);
});
test("status endpoint: wrong method 405; cross-origin 403; authorisation precedes body parsing", async () => {
  assert.equal((await statusFn(req("/api/admin/inquiries/status", { method: "POST", headers: ADMIN, body: {} }))).status, 405);
  assert.equal((await statusFn(req("/api/admin/inquiries/status", { method: "PATCH", headers: { ...ADMIN, Origin: "https://evil.example" }, body: {} }))).status, 403);
  assert.equal((await statusFn(req("/api/admin/inquiries/status", { method: "PATCH", raw: "{broken" }))).status, 401);
});
test("login: admin succeeds and receives tokens; wrong password 401; non-admin 403 and session revoked", async () => {
  const ok = await login(req("/api/admin/login", { method: "POST", body: { email: "Admin@Example.test", password: "correct-horse" } }), { ip: "1.1.1.1" });
  const b = await ok.json(); assert.equal(ok.status, 200); assert.ok(b.access_token && b.refresh_token && b.expires_at > Date.now());
  const bad = await login(req("/api/admin/login", { method: "POST", body: { email: "admin@example.test", password: "wrong" } }), { ip: "1.1.1.1" });
  assert.equal(bad.status, 401); assert.equal((await bad.json()).error, "Incorrect email or password.");
  const plain = await login(req("/api/admin/login", { method: "POST", body: { email: "plain@example.test", password: "correct-horse" } }), { ip: "1.1.1.1" });
  assert.equal(plain.status, 403); assert.ok(!(await plain.text()).includes("access_token")); assert.equal(fake.state.signedOut.length, 1);
});
test("login: bad input 400; rate-limited after 8 attempts", async () => {
  assert.equal((await login(req("/api/admin/login", { method: "POST", body: { email: "", password: "" } }), { ip: "2.2.2.2" })).status, 400);
  for (let i = 0; i < 8; i++) assert.equal((await login(req("/api/admin/login", { method: "POST", body: { email: "a@b.cc", password: "x" } }), { ip: "3.3.3.3" })).status, 401);
  assert.equal((await login(req("/api/admin/login", { method: "POST", body: { email: "a@b.cc", password: "x" } }), { ip: "3.3.3.3" })).status, 429);
});
test("refresh re-checks admin membership; logout revokes", async () => {
  assert.equal((await refresh(req("/api/admin/refresh", { method: "POST", body: { refresh_token: "refresh-admin-user-id" } }))).status, 200);
  assert.equal((await refresh(req("/api/admin/refresh", { method: "POST", body: { refresh_token: "refresh-plain-user-id" } }))).status, 403);
  fake.state.admins.delete("admin-user-id");
  assert.equal((await refresh(req("/api/admin/refresh", { method: "POST", body: { refresh_token: "refresh-admin-user-id" } }))).status, 403, "removed admin loses access");
  assert.equal((await logout(req("/api/admin/logout", { method: "POST", headers: ADMIN, body: {} }))).status, 200);
  assert.equal(fake.state.signedOut.at(-1), "tok-admin-aaaaaaaaaaaaaaaaaaaa");
});
test("upstream outage -> 502, not a crash or false success", async () => {
  fake.state.networkDown = true;
  assert.equal((await inquiries(req("/api/admin/inquiries", { headers: ADMIN }))).status, 502);
});
test("service-role key is never sent to Supabase Auth user lookup, and never returned", async () => {
  const res = await inquiries(req("/api/admin/inquiries", { headers: ADMIN })); const text = await res.text();
  assert.ok(!text.includes("svc_TESTKEY"));
  const authCall = fake.state.calls.find((c) => c.path === "/auth/v1/user");
  assert.ok(!JSON.stringify(authCall.headers).includes("svc_TESTKEY"), "user lookup must use the anon key + user token");
});
