// POST /api/submit-inquiry : public contact-form endpoint.
// Order of checks: method -> origin -> rate limit -> content type/size -> validation -> honeypot
// -> database insert. Success (201) is returned ONLY after Supabase confirms the stored row.
import { json, log, requestId, clientIp, sameOrigin, readJson, methodNotAllowed } from "./_lib/http.mjs";
import { validateInquiry } from "./_lib/validate.mjs";
import { createLimiter } from "./_lib/ratelimit.mjs";
import { config as supabaseConfig, insertInquiry } from "./_lib/supabase.mjs";

// 5 attempts per IP per 10 minutes (best effort, per function instance; see ratelimit.mjs).
export const limiter = createLimiter({ limit: 5, windowMs: 10 * 60 * 1000 });

export default async (req, context) => {
  const reqId = requestId();
  const idHeader = { "X-Request-Id": reqId };

  if (req.method !== "POST") return methodNotAllowed("POST");
  if (!sameOrigin(req)) {
    log("warn", reqId, "origin_rejected");
    return json(403, { error: "Request not allowed." }, idHeader);
  }

  const rl = limiter.check(clientIp(req, context));
  if (!rl.allowed) {
    log("warn", reqId, "rate_limited");
    return json(429, { error: "Too many submissions. Please try again later." }, { ...idHeader, "Retry-After": String(rl.retryAfter) });
  }

  const parsed = await readJson(req, 16 * 1024);
  if (!parsed.ok) {
    log("warn", reqId, "bad_request", { status: parsed.status });
    return json(parsed.status, { error: parsed.error }, idHeader);
  }

  const result = validateInquiry(parsed.data);
  if (!result.ok && result.spam) {
    // Real visitors never fill the hidden field. We do NOT pretend success.
    log("warn", reqId, "honeypot_triggered");
    return json(400, { error: "Submission rejected." }, idHeader);
  }
  if (!result.ok) {
    log("info", reqId, "validation_failed", { fields: Object.keys(result.fields) });
    return json(422, { error: "Please check the form and try again.", fields: result.fields }, idHeader);
  }

  let cfg;
  try {
    cfg = supabaseConfig();
  } catch {
    log("error", reqId, "config_missing");
    return json(500, { error: "The inquiry service is not available right now." }, idHeader);
  }

  try {
    const { id } = await insertInquiry(cfg, result.value);
    log("info", reqId, "inquiry_stored", { inquiryId: id });
    return json(201, { ok: true }, idHeader);
  } catch (err) {
    log("error", reqId, "insert_failed", { upstreamStatus: err.upstreamStatus ?? null, kind: err.name });
    return json(502, { error: "We could not save your inquiry. Please try again later." }, idHeader);
  }
};

export const config = { path: "/api/submit-inquiry" };
