// PATCH /api/admin/inquiries/status  body: {id, status}
import { json, log, requestId, sameOrigin, readJson, methodNotAllowed } from "./_lib/http.mjs";
import { requireAdmin } from "./_lib/auth.mjs";
import { config as supabaseConfig, updateInquiryStatus } from "./_lib/supabase.mjs";
import { validateStatusUpdate } from "./_lib/validate.mjs";

export default async (req) => {
  const reqId = requestId();
  const idHeader = { "X-Request-Id": reqId };
  if (req.method !== "PATCH") return methodNotAllowed("PATCH");
  if (!sameOrigin(req)) return json(403, { error: "Request not allowed." }, idHeader);

  let cfg;
  try { cfg = supabaseConfig(); } catch { return json(500, { error: "Service unavailable." }, idHeader); }

  try {
    // Authorise BEFORE reading or acting on the body.
    const auth = await requireAdmin(req, cfg);
    if (!auth.ok) {
      log("warn", reqId, "admin_denied", { status: auth.status });
      return json(auth.status, { error: auth.status === 401 ? "Please sign in." : "Not authorised." }, idHeader);
    }
    const parsed = await readJson(req, 2 * 1024);
    if (!parsed.ok) return json(parsed.status, { error: parsed.error }, idHeader);
    const v = validateStatusUpdate(parsed.data);
    if (!v.ok) return json(422, { error: "Invalid request.", fields: v.fields }, idHeader);

    const row = await updateInquiryStatus(cfg, v.value.id, v.value.status);
    if (!row) return json(404, { error: "Inquiry not found." }, idHeader);
    log("info", reqId, "status_updated", { inquiryId: row.id, status: row.status, adminId: auth.user.id });
    return json(200, { item: row }, idHeader);
  } catch (err) {
    log("error", reqId, "status_update_error", { upstreamStatus: err.upstreamStatus ?? null });
    return json(502, { error: "Could not update the inquiry." }, idHeader);
  }
};
export const config = { path: "/api/admin/inquiries/status" };
