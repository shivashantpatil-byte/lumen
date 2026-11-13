// POST /api/admin/logout : revokes the Supabase session server-side (best effort).
import { json, requestId, sameOrigin, methodNotAllowed } from "./_lib/http.mjs";
import { config as supabaseConfig, signOut } from "./_lib/supabase.mjs";
import { bearerToken } from "./_lib/auth.mjs";

export default async (req) => {
  const reqId = requestId();
  if (req.method !== "POST") return methodNotAllowed("POST");
  if (!sameOrigin(req)) return json(403, { error: "Request not allowed." }, { "X-Request-Id": reqId });
  const token = bearerToken(req);
  if (token) { try { await signOut(supabaseConfig(), token); } catch { /* token may already be invalid */ } }
  return json(200, { ok: true }, { "X-Request-Id": reqId });
};
export const config = { path: "/api/admin/logout" };
