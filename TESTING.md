# LUMEN: Testing Report

Run on 2026-11-13 (Node v22.23.4, Chromium via Playwright). Logs: `tests/results/unit-run.txt`, `tests/results/e2e-run.txt`.

## What was and was not tested (read this first)

| Layer | Status |
|---|---|
| Public HTML/CSS/JS in real Chromium | **TESTED** (95 checks) |
| Netlify Function code (all 6 functions) | **TESTED** (43 automated tests + exercised by the browser suite) |
| Supabase | **NOT TESTED against a real project.** Tests use an in-memory fake of Supabase's REST/Auth API (`tests/fake-supabase.mjs`). It proves our code sends the right requests and handles responses and failures correctly. It does **not** prove Supabase accepts them. |
| SQL migration and row-level security | **NOT TESTED.** No Postgres in the authoring sandbox. `supabase/tests/rls_tests.sql` is a ready-made script: run it in the Supabase SQL editor (instructions below). |
| Netlify deployment, real `/api/*` routing, env vars, HTTPS, response headers | **NOT TESTED.** Nothing was deployed. The local harness applies the CSP from `netlify.toml`, but Netlify's own header handling is unverified. |
| Unsplash images, Google Fonts | **NOT TESTED** (sandbox has no internet). Layout was tested with images *failing* and with stand-in images at realistic size. |
| Lighthouse / Core Web Vitals | **NOT TESTED.** |
| Real phones, Safari/Firefox, screen readers (NVDA/VoiceOver) | **NOT TESTED.** Only Chromium at 360 / 375 / 768 / 1280 px. |
| Email notification | **Not implemented**, so nothing to test. You will not be emailed about new inquiries; check the dashboard. |
| Cookies set by Netlify/Google/Unsplash on the live site | **NOT VERIFIED** (see cookie policy placeholder). |
| Legal text | **Not reviewed by a lawyer.** |

## Automated results

- `npm test` (Node built-in runner): **43 / 43 passed**.
- `bash tests/run-e2e.sh` (Playwright, 11 public pages + 404 + admin): **95 / 95 passed**.

### Contact form (requested cases)

| Case | Result |
|---|---|
| Valid submission stored, 201 only after the (fake) DB confirms | PASS |
| Missing required fields (client and server) | PASS |
| Invalid email (5 malformed variants) | PASS |
| Invalid project type | PASS |
| Non-string / injected field types | PASS |
| Over-long name and message; message of exactly 5,000 accepted | PASS |
| Oversized payload (declared and actual size) -> 413 | PASS |
| Wrong content type -> 415; malformed JSON -> 400 | PASS |
| Honeypot: rejected with 400, **not** reported as success, not stored | PASS |
| Database failure -> error shown, input preserved, nothing reported as sent | PASS |
| Network failure -> error shown, input preserved | PASS |
| Repeated clicks while sending -> one record, button disabled | PASS |
| Rate limit: 6th request in 10 min -> 429 and friendly message | PASS |
| Cross-origin browser request -> 403 | PASS |
| Logs and responses never contain message text, name, email or keys | PASS |
| Missing env vars -> safe 500 message that names no secrets | PASS |

### Authorisation (against the fake)

| Case | Result |
|---|---|
| No token / garbage token -> 401 on every admin endpoint | PASS |
| Valid user who is not in `admin_users` -> 403 on list, detail, update; data unchanged | PASS |
| Client-sent "admin" flags (header, query, body) ignored | PASS |
| Admin list/detail/filter/sort/pagination; list omits message bodies | PASS |
| Invalid status or malformed id rejected; only `status` can change | PASS |
| Login refuses non-admins and revokes their session; wrong password -> generic 401; login rate-limited | PASS |
| Refresh re-checks admin membership (a removed admin loses access) | PASS |
| Service-role key never sent to Auth lookup, never in a response or log | PASS |
| Secrets scan: nothing under `public/` mentions keys, JWTs, Supabase URL or Formspree | PASS |

### Public site

| Case | Result |
|---|---|
| All 11 pages load (200), no JS errors, **no CSP violations** | PASS |
| Every local link and asset resolves; no `href="#"` placeholders left | PASS |
| No horizontal overflow at 360/375/768/1280 px, with images **failed** and **loaded**, on all pages | PASS (after fix) |
| Mobile menu: opens, closes, Escape, focus return, `aria-expanded`/label, links unfocusable when closed | PASS |
| Skip link, `aria-current`, one `h1` per page, 404 status + styled custom page | PASS |
| Footer text contrast >= 4.5:1 | PASS (5.73:1) |
| Admin: login/logout, session refresh, bad-session redirect, dialog, focus return, 375 px layout | PASS |
| XSS: `<img onerror>` / `<script>` / `<b>` in a submission render as plain text in the dashboard | PASS |

## Defects found by testing, and fixed

1. **Cookie Policy overflowed on phones** (long domain names in a table). Fixed with wrapping.
2. **Focus was lost after saving an inquiry's status** (list re-render destroyed the focused button). Fixed: focus returns to that inquiry's "View" button when the dialog closes.
3. Earlier audit finding: **layout overflowed when images failed** (grid tracks could not shrink). Fixed with `minmax(0, ...)` tracks and a placeholder background.
4. Test-harness issues (not site bugs): an off-by-one in a rate-limit test; the fake did not register refreshed tokens; the dev server crashed on a malformed URL; the link checker followed the `%%SITE_URL%%` placeholder.

## Tests YOU must run (cannot be done from here)

**A. Database security (10 minutes).** After applying the migration: Supabase dashboard -> SQL Editor -> paste `supabase/tests/rls_tests.sql` -> Run. Expect `NOTICE: ALL RLS TESTS PASSED`. Any failure raises an exception naming the broken rule. The script rolls back, leaving no data.

**B. Deployed contact flow.** On the deploy preview:
1. Submit the form. Expect the green confirmation, and a new row in Supabase -> Table Editor -> `inquiries`.
2. `curl -i https://YOUR-SITE/api/admin/inquiries` -> expect `401`.
3. `curl -i -X POST https://YOUR-SITE/api/submit-inquiry -H 'Content-Type: application/json' -d '{}'` -> expect `422`.
4. In the Supabase SQL editor run `select * from inquiries;` -> your test row. Then in a browser console on any public page: `fetch('https://YOUR-PROJECT.supabase.co/rest/v1/inquiries', {headers:{apikey:'YOUR_ANON_KEY'}}).then(r=>r.status)` -> expect `401` or `403` (anonymous read denied).

**C. Admin.** Sign in at `/admin/login.html` with the account you added to `admin_users`. Create a second Supabase user **not** in `admin_users` and confirm sign-in is refused.

**D. Headers.** `curl -I https://YOUR-SITE/` -> check `content-security-policy`, `strict-transport-security`; `curl -I https://YOUR-SITE/admin/` -> `x-robots-tag: noindex`, `cache-control: no-store`. Open the browser console on every page and look for CSP errors.

**E. Cookies.** Private window -> DevTools -> Application -> Cookies on the live site; update `cookie-policy.html` with what you see.

**F. Performance and accessibility.** Run Lighthouse (mobile) on `/`, `/projects.html`, one case study, and `/contact.html`; test the menu and form with a screen reader and keyboard only.

**G. Failure handling.** Temporarily set a wrong `SUPABASE_SERVICE_ROLE_KEY` on the preview, submit the form, and confirm the visitor sees an error (never success). Restore the key.

## Known limitations

- Rate limiting is in-memory per function instance (see README); it is a speed bump, not a guarantee.
- No CAPTCHA (deliberately not faked). Add Cloudflare Turnstile or similar if spam appears.
- A paused Supabase free project would make submissions fail with a visible error (they would not be silently lost, but they would not be stored either).
