// Minimal Supabase client using plain fetch (PostgREST + GoTrue). No npm dependency.
// The SERVICE-ROLE key bypasses row-level security, so it must only ever be used here,
// on the server, and only after the caller has been authorised.

export function config(env = process.env) {
  const url = (env.SUPABASE_URL || "").replace(/\/+$/, "");
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const anonKey = env.SUPABASE_ANON_KEY || "";
  if (!/^https:\/\/[^\s/]+$/.test(url) || !serviceKey) {
    const err = new Error("Supabase is not configured");
    err.code = "CONFIG_MISSING";
    throw err;
  }
  return { url, serviceKey, anonKey };
}

async function call(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
  return res;
}

const svcHeaders = (cfg, extra = {}) => ({
  apikey: cfg.serviceKey,
  Authorization: `Bearer ${cfg.serviceKey}`,
  "Content-Type": "application/json",
  ...extra,
});

/** Inserts one inquiry. Resolves only if the database confirms the row. */
export async function insertInquiry(cfg, row) {
  const res = await call(`${cfg.url}/rest/v1/inquiries`, {
    method: "POST",
    headers: svcHeaders(cfg, { Prefer: "return=representation" }),
    body: JSON.stringify(row),
  });
  if (res.status !== 201) {
    const err = new Error("insert failed");
    err.upstreamStatus = res.status;
    throw err;
  }
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]?.id) {
    const err = new Error("insert not confirmed");
    err.upstreamStatus = 201;
    throw err;
  }
  return { id: rows[0].id };
}

export async function listInquiries(cfg, { status, ascending = false, limit = 25, offset = 0 }) {
  const q = new URLSearchParams({
    select: "id,name,email,project_type,status,created_at",
    order: `created_at.${ascending ? "asc" : "desc"}`,
    limit: String(limit),
    offset: String(offset),
  });
  if (status) q.set("status", `eq.${status}`);
  const res = await call(`${cfg.url}/rest/v1/inquiries?${q}`, {
    headers: svcHeaders(cfg, { Prefer: "count=exact" }),
  });
  if (!res.ok) throw Object.assign(new Error("list failed"), { upstreamStatus: res.status });
  const range = res.headers.get("content-range") || ""; // e.g. "0-24/137"
  const total = Number(range.split("/")[1]);
  return { items: await res.json(), total: Number.isFinite(total) ? total : null };
}

export async function getInquiry(cfg, id) {
  const q = new URLSearchParams({
    select: "id,name,email,project_type,message,status,created_at,updated_at",
    id: `eq.${id}`,
    limit: "1",
  });
  const res = await call(`${cfg.url}/rest/v1/inquiries?${q}`, { headers: svcHeaders(cfg) });
  if (!res.ok) throw Object.assign(new Error("get failed"), { upstreamStatus: res.status });
  const rows = await res.json();
  return rows[0] || null;
}

export async function updateInquiryStatus(cfg, id, status) {
  const q = new URLSearchParams({ id: `eq.${id}`, select: "id,status,updated_at" });
  const res = await call(`${cfg.url}/rest/v1/inquiries?${q}`, {
    method: "PATCH",
    headers: svcHeaders(cfg, { Prefer: "return=representation" }),
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw Object.assign(new Error("update failed"), { upstreamStatus: res.status });
  const rows = await res.json();
  return rows[0] || null;
}

/** Asks Supabase Auth who owns this access token. Returns the user or null. */
export async function getUser(cfg, accessToken) {
  const res = await call(`${cfg.url}/auth/v1/user`, {
    headers: { apikey: cfg.anonKey || cfg.serviceKey, Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw Object.assign(new Error("auth lookup failed"), { upstreamStatus: res.status });
  const user = await res.json();
  return user?.id ? user : null;
}

/** Trusted server-side admin check against the allow-list table. */
export async function isAdmin(cfg, userId) {
  const q = new URLSearchParams({ user_id: `eq.${userId}`, select: "user_id,role", limit: "1" });
  const res = await call(`${cfg.url}/rest/v1/admin_users?${q}`, { headers: svcHeaders(cfg) });
  if (!res.ok) throw Object.assign(new Error("admin lookup failed"), { upstreamStatus: res.status });
  const rows = await res.json();
  return Array.isArray(rows) && rows.length === 1 && rows[0].role === "admin";
}

async function tokenCall(cfg, grant, body) {
  const res = await call(`${cfg.url}/auth/v1/token?grant_type=${grant}`, {
    method: "POST",
    headers: { apikey: cfg.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 400 || res.status === 401 || res.status === 422) return null; // bad credentials / token
  if (!res.ok) throw Object.assign(new Error("token call failed"), { upstreamStatus: res.status });
  return res.json();
}
export const passwordLogin = (cfg, email, password) => tokenCall(cfg, "password", { email, password });
export const refreshSession = (cfg, refresh_token) => tokenCall(cfg, "refresh_token", { refresh_token });

export async function signOut(cfg, accessToken) {
  const res = await call(`${cfg.url}/auth/v1/logout`, {
    method: "POST",
    headers: { apikey: cfg.anonKey, Authorization: `Bearer ${accessToken}` },
  });
  return res.ok;
}
