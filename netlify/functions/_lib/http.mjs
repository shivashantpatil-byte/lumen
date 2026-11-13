// Small HTTP helpers shared by every function. No dependencies.
import { randomUUID } from "node:crypto";

export const requestId = () => randomUUID();

/** JSON response. Never cached; never sniffed. */
export function json(status, body, extra = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
      ...extra,
    },
  });
}

/**
 * Structured operational log. Callers pass ONLY non-sensitive fields
 * (ids, status codes, event names). Message bodies, emails, names,
 * tokens and keys must never be passed in.
 */
export function log(level, reqId, event, fields = {}) {
  console[level === "error" ? "error" : "log"](JSON.stringify({ level, reqId, event, ...fields }));
}

export function clientIp(req, context) {
  return (
    context?.ip ||
    req.headers.get("x-nf-client-connection-ip") ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown"
  );
}

/**
 * Cross-site request defence for state-changing endpoints: if the browser sent an Origin
 * header it must be this site. Requests without Origin (curl, server-to-server) are allowed;
 * they carry no ambient browser credentials because we use bearer tokens, not cookies.
 */
export function sameOrigin(req) {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

/** Reads a JSON body with a hard size cap. Returns {ok:true,data} or {ok:false,status,error}. */
export async function readJson(req, maxBytes = 16 * 1024) {
  const type = (req.headers.get("content-type") || "").toLowerCase();
  if (!type.startsWith("application/json")) {
    return { ok: false, status: 415, error: "Content-Type must be application/json." };
  }
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, status: 413, error: "Request is too large." };
  }
  let text;
  try {
    text = await req.text();
  } catch {
    return { ok: false, status: 400, error: "Could not read the request." };
  }
  if (new TextEncoder().encode(text).length > maxBytes) {
    return { ok: false, status: 413, error: "Request is too large." };
  }
  try {
    const data = JSON.parse(text);
    if (data === null || typeof data !== "object" || Array.isArray(data)) throw new Error("not object");
    return { ok: true, data };
  } catch {
    return { ok: false, status: 400, error: "Request body must be a JSON object." };
  }
}

export function methodNotAllowed(allowed) {
  return json(405, { error: "Method not allowed." }, { Allow: allowed });
}
