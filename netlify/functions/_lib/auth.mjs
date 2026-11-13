// Authorisation gate for every protected function.
// 1. Take the bearer token from the request.  2. Ask Supabase Auth to verify it (never decode it
// ourselves, never trust a client-side flag).  3. Check the user's membership in admin_users.
import { getUser, isAdmin } from "./supabase.mjs";

export function bearerToken(req) {
  const h = req.headers.get("authorization") || "";
  const m = /^Bearer ([A-Za-z0-9._~+/=-]{20,4096})$/.exec(h);
  return m ? m[1] : null;
}

/** @returns {{ok:true,user:object,token:string}|{ok:false,status:401|403}} */
export async function requireAdmin(req, cfg) {
  const token = bearerToken(req);
  if (!token) return { ok: false, status: 401 };
  const user = await getUser(cfg, token);
  if (!user) return { ok: false, status: 401 };
  if (!(await isAdmin(cfg, user.id))) return { ok: false, status: 403 };
  return { ok: true, user, token };
}
