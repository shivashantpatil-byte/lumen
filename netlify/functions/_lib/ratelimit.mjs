// Best-effort, in-memory sliding-window rate limiter.
//
// HONEST LIMITATION: serverless functions run in many short-lived instances. This counter lives in
// one instance's memory, so it (a) resets on cold starts, and (b) is not shared between concurrent
// instances. It slows down casual abuse and accidental double-posts but is NOT a hard guarantee.
// For stronger protection add a shared store (e.g. a Supabase table or Upstash Redis free tier),
// Netlify's platform rate limiting if your plan offers it, or a CAPTCHA such as Cloudflare Turnstile.
export function createLimiter({ limit, windowMs, maxKeys = 5000 }) {
  const hits = new Map();
  return {
    check(key, now = Date.now()) {
      const cutoff = now - windowMs;
      const recent = (hits.get(key) || []).filter((t) => t > cutoff);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return { allowed: false, retryAfter: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)) };
      }
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > maxKeys) {
        for (const [k, v] of hits) if (!v.some((t) => t > cutoff)) hits.delete(k);
      }
      return { allowed: true, retryAfter: 0 };
    },
    reset() { hits.clear(); },
  };
}
