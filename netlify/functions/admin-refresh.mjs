// POST /api/admin/refresh : renews an admin session. Admin membership is re-checked every time,
// so removing someone from admin_users ends their access at the next refresh.
import { json, log, requestId, sameOrigin, readJson, methodNotAllowed } from "./_lib/http.mjs";
import { config as supabaseConfig, refreshSession, isAdmin, signOut } from "./_lib/supabase.mjs";

export default async (req) => {
  const reqId = requestId();
  const idHeader = { "X-Request-Id": reqId };
  if (req.method !== "POST") return methodNotAllowed("POST");
  if (!sameOrigin(req)) return json(403, { error: "Request not allowed." }, idHeader);
  const parsed = await readJson(req, 4 * 1024);
  if (!parsed.ok) return json(parsed.status, { error: parsed.error }, idHeader);
  const rt = parsed.data.refresh_token;
  if (typeof rt !== "string" || rt.length < 6 || rt.length > 512) return json(400, { error: "Invalid session." }, idHeader);

  let cfg;
  try { cfg = supabaseConfig(); } catch { return json(500, { error: "Service unavailable." }, idHeader); }
  try {
    const s = await refreshSession(cfg, rt);
    if (!s?.access_token || !s?.user?.id) return json(401, { error: "Session expired. Please sign in again." }, idHeader);
    if (!(await isAdmin(cfg, s.user.id))) {
      await signOut(cfg, s.access_token).catch(() => {});
      return json(403, { error: "Not authorised." }, idHeader);
    }
    return json(200, { ok: true, access_token: s.access_token, refresh_token: s.refresh_token,
      expires_at: Date.now() + (Number(s.expires_in) || 3600) * 1000 }, idHeader);
  } catch (err) {
    log("error", reqId, "refresh_error", { upstreamStatus: err.upstreamStatus ?? null });
    return json(502, { error: "Service unavailable." }, idHeader);
  }
};
export const config = { path: "/api/admin/refresh" };
