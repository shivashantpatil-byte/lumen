// In-memory stand-in for the parts of Supabase (PostgREST + GoTrue) the functions use.
// It is NOT Supabase: it cannot test row-level security or real constraints (see TESTING.md).
export const URL_BASE = "https://fake-project.supabase.co";
export const SERVICE_KEY = "svc_TESTKEY_do_not_leak_0123456789";
export const ANON_KEY = "anon_TESTKEY_0123456789";

export function installFakeSupabase() {
  const state = {
    inquiries: [], admins: new Set(["admin-user-id"]),
    tokens: { "tok-admin-aaaaaaaaaaaaaaaaaaaa": { id: "admin-user-id" }, "tok-plain-aaaaaaaaaaaaaaaaaaaa": { id: "plain-user-id" } },
    passwords: { "admin@example.test": { pw: "correct-horse", id: "admin-user-id" }, "plain@example.test": { pw: "correct-horse", id: "plain-user-id" } },
    failInsert: false, networkDown: false, delayMs: 0, calls: [], signedOut: [],
  };
  let n = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const u = new URL(typeof input === "string" ? input : input.url);
    const method = (init.method || "GET").toUpperCase();
    const h = init.headers || {};
    state.calls.push({ method, path: u.pathname, query: u.search, headers: h });
    if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
    if (state.networkDown) throw new TypeError("fetch failed");
    const ok = (status, body, headers = {}) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
    const bearer = (h.Authorization || "").replace("Bearer ", "");
    const isSvc = bearer === SERVICE_KEY && h.apikey === SERVICE_KEY;

    if (u.pathname === "/auth/v1/user") {
      const t = state.tokens[bearer]; return t ? ok(200, { id: t.id, email: "x@example.test" }) : ok(401, { msg: "invalid" });
    }
    if (u.pathname === "/auth/v1/token") {
      const body = JSON.parse(init.body);
      if (u.searchParams.get("grant_type") === "password") {
        const acc = state.passwords[body.email];
        if (!acc || acc.pw !== body.password) return ok(400, { error: "invalid_grant" });
        const tok = `tok-${acc.id}-login-0000000000`; state.tokens[tok] = { id: acc.id };
        return ok(200, { access_token: tok, refresh_token: "refresh-" + acc.id, expires_in: 3600, user: { id: acc.id } });
      }
      const m = /^refresh-(.+)$/.exec(body.refresh_token || "");
      if (!m) return ok(400, { error: "invalid" });
      const rtok = `tok-${m[1]}-refreshed-000000`; state.tokens[rtok] = { id: m[1] };
      return ok(200, { access_token: rtok, refresh_token: "refresh-" + m[1], expires_in: 3600, user: { id: m[1] } });
    }
    if (u.pathname === "/auth/v1/logout") { state.signedOut.push(bearer); return ok(204, null); }

    if (!isSvc) return ok(401, { message: "service key required" });   // REST calls must use the service key
    if (u.pathname === "/rest/v1/admin_users") {
      const uid = (u.searchParams.get("user_id") || "").replace("eq.", "");
      return ok(200, state.admins.has(uid) ? [{ user_id: uid, role: "admin" }] : []);
    }
    if (u.pathname === "/rest/v1/inquiries") {
      if (method === "POST") {
        if (state.failInsert) return ok(500, { message: "db down" });
        const row = { id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, status: "new", created_at: new Date(1700000000000 + n * 1000).toISOString(), updated_at: new Date(1700000000000 + n * 1000).toISOString(), ...JSON.parse(init.body) };
        state.inquiries.push(row); return ok(201, [row]);
      }
      if (method === "GET") {
        let rows = [...state.inquiries]; const idq = u.searchParams.get("id");
        if (idq) rows = rows.filter((r) => r.id === idq.replace("eq.", ""));
        const st = u.searchParams.get("status"); if (st) rows = rows.filter((r) => r.status === st.replace("eq.", ""));
        const asc = (u.searchParams.get("order") || "").endsWith(".asc");
        rows.sort((a, b) => (a.created_at < b.created_at ? -1 : 1) * (asc ? 1 : -1));
        const total = rows.length, off = Number(u.searchParams.get("offset") || 0), lim = Number(u.searchParams.get("limit") || 1000);
        const cols = (u.searchParams.get("select") || "*").split(",");
        rows = rows.slice(off, off + lim).map((r) => cols[0] === "*" ? r : Object.fromEntries(cols.map((c) => [c, r[c]])));
        return ok(200, rows, { "Content-Range": `${off}-${off + rows.length - 1}/${total}` });
      }
      if (method === "PATCH") {
        const id = (u.searchParams.get("id") || "").replace("eq.", ""); const row = state.inquiries.find((r) => r.id === id);
        if (!row) return ok(200, []);
        Object.assign(row, JSON.parse(init.body), { updated_at: new Date().toISOString() });
        return ok(200, [{ id: row.id, status: row.status, updated_at: row.updated_at }]);
      }
    }
    return ok(404, { message: "unhandled in fake" });
  };
  return { state, restore: () => { globalThis.fetch = realFetch; } };
}

export function setEnv() {
  process.env.SUPABASE_URL = URL_BASE; process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY; process.env.SUPABASE_ANON_KEY = ANON_KEY;
}
export const req = (path, { method = "GET", body, headers = {}, raw } = {}) =>
  new Request(`https://lumen.test${path}`, { method, headers: { ...(body !== undefined || raw !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined });
export const valid = (o = {}) => ({ name: "Asha Rao", email: "Asha@Example.com ", project_type: "residential", message: "We would like to renovate our flat.", website: "", ...o });
