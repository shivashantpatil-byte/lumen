// POST /api/admin/login : exchanges email + password for a Supabase session, but ONLY for users on
// the admin allow-list. The browser never needs a Supabase key or the Supabase URL.
import { json, log, requestId, clientIp, sameOrigin, readJson, methodNotAllowed } from "./_lib/http.mjs";
import { createLimiter } from "./_lib/ratelimit.mjs";
import { config as supabaseConfig, passwordLogin, isAdmin, signOut } from "./_lib/supabase.mjs";

// 8 attempts per IP per 15 minutes (best effort; Supabase Auth also applies its own limits).
export const limiter = createLimiter({ limit: 8, windowMs: 15 * 60 * 1000 });

export default async (req, context) => {
  const reqId = requestId();
  const idHeader = { "X-Request-Id": reqId };
  if (req.method !== "POST") return methodNotAllowed("POST");
  if (!sameOrigin(req)) return json(403, { error: "Request not allowed." }, idHeader);

  const rl = limiter.check(clientIp(req, context));
  if (!rl.allowed) {
    log("warn", reqId, "login_rate_limited");
    return json(429, { error: "Too many attempts. Try again later." }, { ...idHeader, "Retry-After": String(rl.retryAfter) });
  }

  const parsed = await readJson(req, 4 * 1024);
  if (!parsed.ok) return json(parsed.status, { error: parsed.error }, idHeader);
  const { email, password } = parsed.data;
  if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password ||
      email.length > 254 || password.length > 256) {
    return json(400, { error: "Enter your email and password." }, idHeader);
  }

  let cfg;
  try { cfg = supabaseConfig(); if (!cfg.anonKey) throw new Error("anon"); }
  catch { log("error", reqId, "config_missing"); return json(500, { error: "Sign-in is not available right now." }, idHeader); }

  try {
    const session = await passwordLogin(cfg, email.trim().toLowerCase(), password);
    if (!session?.access_token || !session?.user?.id) {
      log("info", reqId, "login_failed");
      return json(401, { error: "Incorrect email or password." }, idHeader);
    }
    if (!(await isAdmin(cfg, session.user.id))) {
      log("warn", reqId, "login_not_admin");
      await signOut(cfg, session.access_token).catch(() => {});   // do not leave a live session behind
      return json(403, { error: "This account is not authorised for the admin area." }, idHeader);
    }
    log("info", reqId, "login_ok");
    return json(200, {
      ok: true,
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: Date.now() + (Number(session.expires_in) || 3600) * 1000,
    }, idHeader);
  } catch (err) {
    log("error", reqId, "login_error", { upstreamStatus: err.upstreamStatus ?? null });
    return json(502, { error: "Sign-in is temporarily unavailable." }, idHeader);
  }
};
export const config = { path: "/api/admin/login" };
