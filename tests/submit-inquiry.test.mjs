import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import handler, { limiter } from "../netlify/functions/submit-inquiry.mjs";
import { installFakeSupabase, setEnv, req, valid, SERVICE_KEY } from "./fake-supabase.mjs";

let fake, logs;
const realLog = console.log, realErr = console.error;
beforeEach(() => { setEnv(); fake = installFakeSupabase(); limiter.reset(); logs = [];
  console.log = (...a) => logs.push(a.join(" ")); console.error = (...a) => logs.push(a.join(" ")); });
afterEach(() => { fake.restore(); console.log = realLog; console.error = realErr; });
const call = (r, ip = "9.9.9.9") => handler(r, { ip });

test("valid submission is stored and confirmed with 201", async () => {
  const res = await call(req("/api/submit-inquiry", { method: "POST", body: valid() }));
  assert.equal(res.status, 201); assert.deepEqual(await res.json(), { ok: true });
  assert.equal(fake.state.inquiries.length, 1);
  assert.equal(fake.state.inquiries[0].email, "asha@example.com", "email normalised (trim + lowercase)");
  assert.equal(fake.state.inquiries[0].website, undefined, "honeypot field is never stored");
});
test("missing required fields -> 422 with field errors, nothing stored", async () => {
  const res = await call(req("/api/submit-inquiry", { method: "POST", body: { name: "", email: "", project_type: "", message: "" } }));
  assert.equal(res.status, 422); const b = await res.json();
  assert.deepEqual(Object.keys(b.fields).sort(), ["email", "message", "name", "project_type"]);
  assert.equal(fake.state.inquiries.length, 0);
});
test("whitespace-only name/message rejected", async () => {
  const res = await call(req("/api/submit-inquiry", { method: "POST", body: valid({ name: "   ", message: "  \n " }) }));
  assert.equal(res.status, 422);
});
for (const bad of ["plainaddress", "a@b", "a b@c.de", "@x.com", "a@@b.com"]) {
  test(`invalid email "${bad}" -> 422`, async () => {
    const res = await call(req("/api/submit-inquiry", { method: "POST", body: valid({ email: bad }) }));
    assert.equal(res.status, 422); assert.ok((await res.json()).fields.email);
  });
}
test("invalid project type -> 422", async () => {
  const res = await call(req("/api/submit-inquiry", { method: "POST", body: valid({ project_type: "spaceship" }) }));
  assert.equal(res.status, 422); assert.ok((await res.json()).fields.project_type);
});
test("non-string field types rejected (no coercion)", async () => {
  const res = await call(req("/api/submit-inquiry", { method: "POST", body: valid({ name: { $ne: null }, message: 123 }) }));
  assert.equal(res.status, 422);
});
test("over-long fields -> 422", async () => {
  assert.equal((await call(req("/api/submit-inquiry", { method: "POST", body: valid({ message: "x".repeat(5001) }) }))).status, 422);
  assert.equal((await call(req("/api/submit-inquiry", { method: "POST", body: valid({ name: "n".repeat(101) }) }))).status, 422);
});
test("message at exactly 5000 chars is accepted", async () => {
  assert.equal((await call(req("/api/submit-inquiry", { method: "POST", body: valid({ message: "x".repeat(5000) }) }))).status, 201);
});
test("oversized payload -> 413 (declared and actual)", async () => {
  const big = JSON.stringify(valid({ message: "x".repeat(40000) }));
  assert.equal((await call(req("/api/submit-inquiry", { method: "POST", raw: big, headers: { "Content-Length": String(big.length) } }))).status, 413);
  assert.equal((await call(req("/api/submit-inquiry", { method: "POST", raw: big }))).status, 413);
  assert.equal(fake.state.inquiries.length, 0);
});
test("wrong content type -> 415; malformed JSON -> 400; array body -> 400", async () => {
  assert.equal((await call(new Request("https://lumen.test/api/submit-inquiry", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "x" }))).status, 415);
  assert.equal((await call(req("/api/submit-inquiry", { method: "POST", raw: "{not json" }))).status, 400);
  assert.equal((await call(req("/api/submit-inquiry", { method: "POST", raw: "[1,2]" }))).status, 400);
});
test("non-POST methods -> 405", async () => {
  for (const m of ["GET", "PUT", "DELETE"]) assert.equal((await call(req("/api/submit-inquiry", { method: m }))).status, 405);
});
test("honeypot filled -> rejected (400), NOT reported as success, nothing stored", async () => {
  const res = await call(req("/api/submit-inquiry", { method: "POST", body: valid({ website: "http://spam.example" }) }));
  assert.equal(res.status, 400); assert.notEqual((await res.json()).ok, true);
  assert.equal(fake.state.inquiries.length, 0);
});
test("cross-origin browser request -> 403", async () => {
  const res = await call(req("/api/submit-inquiry", { method: "POST", body: valid(), headers: { Origin: "https://evil.example" } }));
  assert.equal(res.status, 403); assert.equal(fake.state.inquiries.length, 0);
});
test("same-origin request allowed", async () => {
  assert.equal((await call(req("/api/submit-inquiry", { method: "POST", body: valid(), headers: { Origin: "https://lumen.test" } }))).status, 201);
});
test("database failure -> 502, never a success response", async () => {
  fake.state.failInsert = true;
  const res = await call(req("/api/submit-inquiry", { method: "POST", body: valid() }));
  assert.equal(res.status, 502); const b = await res.json(); assert.notEqual(b.ok, true); assert.equal(fake.state.inquiries.length, 0);
});
test("network failure reaching Supabase -> 502, never success", async () => {
  fake.state.networkDown = true;
  const res = await call(req("/api/submit-inquiry", { method: "POST", body: valid() }));
  assert.equal(res.status, 502);
});
test("missing environment variables -> 500 with safe message", async () => {
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await call(req("/api/submit-inquiry", { method: "POST", body: valid() }));
  assert.equal(res.status, 500); assert.doesNotMatch(JSON.stringify(await res.json()), /supabase|key/i);
});
test("rate limit: 6th attempt from one IP -> 429 with Retry-After; other IP unaffected", async () => {
  for (let i = 0; i < 5; i++) assert.equal((await call(req("/api/submit-inquiry", { method: "POST", body: valid() }), "7.7.7.7")).status, 201);
  const res = await call(req("/api/submit-inquiry", { method: "POST", body: valid() }), "7.7.7.7");
  assert.equal(res.status, 429); assert.ok(Number(res.headers.get("Retry-After")) > 0);
  assert.equal((await call(req("/api/submit-inquiry", { method: "POST", body: valid() }), "8.8.8.8")).status, 201);
});
test("responses and logs never contain the message, email, name or secret key", async () => {
  const msg = "SECRET-MESSAGE-BODY-12345";
  const res = await call(req("/api/submit-inquiry", { method: "POST", body: valid({ message: msg, name: "Uniquename Person", email: "unique.person@example.org" }) }));
  const text = await res.text() + logs.join("\n");
  for (const s of [msg, "Uniquename", "unique.person", SERVICE_KEY]) assert.ok(!text.includes(s), `leaked ${s}`);
  fake.state.failInsert = true;
  await call(req("/api/submit-inquiry", { method: "POST", body: valid({ message: msg }) }));
  assert.ok(!logs.join("\n").includes(msg));
});
test("response carries no-store and a request id", async () => {
  const res = await call(req("/api/submit-inquiry", { method: "POST", body: valid() }));
  assert.equal(res.headers.get("Cache-Control"), "no-store"); assert.ok(res.headers.get("X-Request-Id"));
});
