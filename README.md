# LUMEN: concept interior architecture & design studio

A fictional studio website built as a front-end portfolio project: plain HTML, CSS and vanilla JavaScript, with a working inquiry form backed by Supabase and a small protected admin dashboard. **No framework and no runtime npm dependencies.**

> LUMEN is a concept. The studio, people, projects, places and contact details are invented, and the site says so (concept notice on every page; unverified facts are flagged `[placeholder]`).

## Architecture

```
Visitor's browser ──► Netlify (static files in public/)
        │
        └─ POST /api/submit-inquiry ─► Netlify Function ─► Supabase PostgreSQL  (service-role key, server only)

Admin's browser ──► /admin/ (static page) ─► /api/admin/* Netlify Functions
                       each request: Supabase Auth verifies the token  +  server checks admin_users  ─► Supabase
```

- The browser **never** receives a Supabase key or URL. Admin sign-in is proxied through `/api/admin/login`.
- The database blocks the public (`anon`) role entirely (row-level security). Even if the public API key leaks, it cannot read inquiries.
- The service-role key bypasses RLS, so **every** privileged function authenticates the caller and verifies admin membership itself (`netlify/functions/_lib/auth.mjs`).

## Folder structure

```
public/                 published site (HTML, css/, js/, images/, admin/, robots.txt, sitemap.xml, 404.html)
netlify/functions/      serverless API (submit-inquiry, admin-login/refresh/logout/inquiries/inquiry-status) + _lib/
supabase/migrations/    001_create_inquiries.sql
supabase/tests/         rls_tests.sql  (run in the Supabase SQL editor)
scripts/                set-site-url.mjs (build step: fills %%SITE_URL%% in canonical/OG/sitemap/robots)
tests/                  unit tests (node --test), end-to-end tests (Playwright), fake Supabase, results/
netlify.toml            publish dir, functions dir, security headers, CSP, noindex for /admin and /api
.env.example            variable names only
PROJECT_AUDIT.md  TESTING.md  HANDOFF.md
```

**Dependencies:** none at runtime (Functions use Node's built-in `fetch` to call Supabase's REST/Auth endpoints, so there is nothing to install or audit). Development only: Node 20+ for `npm test`; Python 3 + Playwright (Chromium) for the browser suite.

## Setup and deployment

### 1. Create the Supabase project
1. supabase.com -> New project. Choose a region (note it for the Privacy Policy). Save the database password somewhere safe.
2. **Authentication -> Sign In / Providers -> turn OFF "Allow new users to sign up"** (admins are created by you; there is no public registration).

### 2. Apply the migration
Dashboard -> **SQL Editor** -> New query -> paste `supabase/migrations/001_create_inquiries.sql` -> Run. Then run `supabase/tests/rls_tests.sql` and confirm `ALL RLS TESTS PASSED` (see TESTING.md).

### 3. Create the first administrator (securely)
1. **Authentication -> Users -> Add user -> Create new user.** Enter your email and a strong unique password; tick *Auto Confirm User*.
2. In the SQL editor run (replace the email):
```sql
insert into public.admin_users (user_id)
select id from auth.users where email = 'you@example.com';
```
Only someone with access to your Supabase dashboard can do this; the API cannot add admins.

### 4. Collect the keys
Project Settings -> **API** (or API Keys): copy the **Project URL**, the **anon/publishable** key and the **service_role/secret** key. Newer "secret" keys (`sb_secret_...`) can be used in the same variable. Treat the secret key like a password.

### 5. Deploy on Netlify
1. Push this folder to a Git repository (GitHub, GitLab or Bitbucket). `.gitignore` already excludes `.env`.
2. Netlify -> Add new site -> Import from Git. Settings are read from `netlify.toml` (publish `public`, functions `netlify/functions`, build command `node scripts/set-site-url.mjs`).
3. **Site configuration -> Environment variables**, add exactly:

| Name | Value | Notes |
|---|---|---|
| `SUPABASE_URL` | `https://xxxx.supabase.co` | |
| `SUPABASE_SERVICE_ROLE_KEY` | secret key | tick **Contains secret values**; scope to **Functions** |
| `SUPABASE_ANON_KEY` | anon/publishable key | used server-side for admin sign-in |

4. Trigger a deploy; open the **deploy preview** URL and run the checks in TESTING.md (sections B-G).
5. HTTPS: Netlify provisions certificates for its domains and for custom domains you add; confirm the padlock and that `http://` redirects to `https://`.
6. For a custom domain, set `SITE_URL` (otherwise Netlify's `URL` is used) so canonical tags and the sitemap use it.

### 6. Before real use (placeholders you must fill)
Search the repo for `[` placeholders in `privacy-policy.html`, `terms-and-conditions.html`, `cookie-policy.html`: operator name, privacy contact email, retention period, Supabase region, dates, governing-law city. Have the three pages reviewed by a lawyer. Update the cookie policy after inspecting cookies on the live site.

## Security model (summary)

| Concern | Control |
|---|---|
| Public reads/updates/deletes of inquiries | RLS on, all grants revoked from `anon` and `authenticated`; policies only for admins; admins may change only `status` |
| Self-assigning admin | No insert/update/delete grant or policy on `admin_users` |
| Service-role key | Server env var only; never in `public/`, HTML, JS or Git (tests scan for this) |
| Admin API | Bearer token verified by Supabase Auth, then `admin_users` lookup, on **every** call; client "admin" flags ignored |
| Input | Server-side validation, length limits, enum checks, body size cap (16 KB), JSON only |
| Spam | Honeypot + per-IP rate limit. **Not a guarantee** (see below). No CAPTCHA is claimed |
| XSS | Dashboard renders with `textContent`; CSP forbids inline scripts |
| Cross-site requests | Origin check on state-changing endpoints; bearer tokens, no cookies |
| Indexing/caching | `X-Robots-Tag: noindex` and `Cache-Control: no-store` on `/admin/*` and `/api/*` |
| Logging | Request id + event names + status codes only; never message text, names, emails, tokens or keys |

**Rate-limit limitation:** counters live in each serverless instance's memory. They reset on cold starts and are not shared across instances, so a determined attacker can exceed them. For stronger protection add Cloudflare Turnstile/reCAPTCHA, a shared store (Upstash Redis or a Supabase table), or a Netlify plan feature.

**Admin session:** the token is kept in `sessionStorage` (cleared when the tab closes). It is readable by scripts on the same origin, which is why the CSP blocks inline and third-party scripts. For higher assurance enable MFA in Supabase Auth and consider HttpOnly-cookie sessions in a future version.

## Free-tier limits (verify before relying on them; plans change)

Researched November 2026 from third-party summaries; confirm on the providers' pricing pages.
- **Netlify Free:** credit-based. Sources report about 300 credits/month, a hard cap that pauses the site when used up, with credits consumed by production deploys, bandwidth and Function usage (exact per-unit rates differ between sources). Check *netlify.com/pricing*.
- **Supabase Free:** sources report about 500 MB database, 50,000 monthly active users for Auth, and **projects pause after about 7 days of inactivity**. A paused database makes the form show an error (nothing is falsely confirmed). Restore the project in the dashboard, upgrade, or add a keep-alive.
- **Alternatives:** Cloudflare Pages + Workers; a small VPS; Formspree/Basin (reintroduces third-party storage of inquiries); Firebase.

## Data retention and rights requests

The Privacy Policy has a retention placeholder. Example monthly clean-up (adjust the interval to your policy, run in the SQL editor):
```sql
delete from public.inquiries where created_at < now() - interval '12 months';
```
To answer an access/erasure request: `select * from public.inquiries where lower(email) = lower('person@example.com');` then delete the rows.

## Updating secrets if exposed

1. Supabase -> Project Settings -> API: rotate/regenerate the exposed key (legacy JWT-secret rotation invalidates both legacy keys).
2. Update the Netlify environment variable; redeploy.
3. Review Supabase logs and the `inquiries` table for unexpected activity; if the key was ever committed, treat it as compromised permanently (Git history keeps it) and rotate it regardless.

## Local development

```bash
npm test                      # unit/integration tests (no network, no install needed)
bash tests/run-e2e.sh         # browser tests (needs python3 + playwright + chromium)
npx netlify-cli dev           # run the real functions against your real Supabase (needs a .env; not tested by the author)
```
Local note: `%%SITE_URL%%` placeholders in canonical/OG/sitemap/robots are only replaced during a Netlify build, by design.

## Known issues, placeholders and your remaining actions

See the final section of `HANDOFF.md`.
