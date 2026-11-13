// GET /api/admin/inquiries            -> paginated list (no message bodies)
// GET /api/admin/inquiries?id=<uuid>  -> one inquiry with full details
// Protected: valid Supabase token AND membership in admin_users, both checked server-side.
import { json, log, requestId, methodNotAllowed } from "./_lib/http.mjs";
import { requireAdmin } from "./_lib/auth.mjs";
import { config as supabaseConfig, listInquiries, getInquiry } from "./_lib/supabase.mjs";
import { STATUSES, isUuid } from "./_lib/validate.mjs";

const PAGE_SIZE = 25;

export default async (req) => {
  const reqId = requestId();
  const idHeader = { "X-Request-Id": reqId };
  if (req.method !== "GET") return methodNotAllowed("GET");

  let cfg;
  try { cfg = supabaseConfig(); } catch { log("error", reqId, "config_missing"); return json(500, { error: "Service unavailable." }, idHeader); }

  try {
    const auth = await requireAdmin(req, cfg);
    if (!auth.ok) {
      log("warn", reqId, "admin_denied", { status: auth.status });
      return json(auth.status, { error: auth.status === 401 ? "Please sign in." : "Not authorised." }, idHeader);
    }

    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (id !== null) {
      if (!isUuid(id)) return json(400, { error: "Invalid inquiry id." }, idHeader);
      const item = await getInquiry(cfg, id.toLowerCase());
      return item ? json(200, { item }, idHeader) : json(404, { error: "Inquiry not found." }, idHeader);
    }

    const status = url.searchParams.get("status") || "";
    if (status && !STATUSES.includes(status)) return json(400, { error: "Invalid status filter." }, idHeader);
    const sort = url.searchParams.get("sort") === "asc" ? "asc" : "desc";
    const page = Math.min(Math.max(parseInt(url.searchParams.get("page") || "1", 10) || 1, 1), 10000);
    const { items, total } = await listInquiries(cfg, {
      status: status || undefined, ascending: sort === "asc", limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE,
    });
    return json(200, { items, total, page, pageSize: PAGE_SIZE }, idHeader);
  } catch (err) {
    log("error", reqId, "admin_list_error", { upstreamStatus: err.upstreamStatus ?? null });
    return json(502, { error: "Could not load inquiries." }, idHeader);
  }
};
export const config = { path: "/api/admin/inquiries" };
