# LUMEN: Project Audit (Phase 1)

**Audited:** `lumen-site__1__1.zip` (byte-identical to `lumen-site__1_.zip`, MD5 `66a996eb…`).
**Method:** read every file, scripted checks (tags, links, contrast), and a real Chromium (Playwright) run against a local static server at 375 / 768 / 1280 px.
**Not possible in this environment:** the sandbox has no internet, so Unsplash images, Google Fonts, the real Formspree endpoint and any deployed site were **not tested**. Form tests used a **mocked** Formspree response.
**Status labels:** TESTED (run in a browser), READ (confirmed in source), NOT TESTED.

## 1. Inventory

16 entries: 8 HTML pages, `css/style.css` (1,350 lines, 29 KB), `js/script.js` (129 lines), `README.md`, empty `images/`. No `package.json`, `.gitignore`, `.git`, `netlify.toml`, `robots.txt`, `sitemap.xml`, `404.html`, legal pages, or `.env.example`.

## 2. Existing features that work

| Feature | Evidence |
|---|---|
| All 8 pages load, no JavaScript errors at 3 widths | TESTED |
| All local links and assets resolve, except the favicon (see section 3) | READ (scripted check) |
| Mobile menu: opens on click, `aria-expanded` toggles, Escape closes and returns focus to the button | TESTED |
| Form validation: empty submit shows 4 errors, focuses first field, status message; invalid email flagged | TESTED |
| Form success path (mocked 200): POST sent, message shown, form reset | TESTED (mock only) |
| Form failure path (mocked 500): error shown, input preserved | TESTED (mock only) |
| No horizontal scroll on any page at 375 / 768 / 1280 px when images load at realistic size | TESTED (placeholder images substituted) |
| Semantic landmarks, one `h1` per page, alt text on all 32 images, labelled form fields, focus-visible styles, reduced-motion support | READ |
| Prev/next case-study links form a correct loop (Residence → Coastal → Courtyard → Atelier → Residence) | READ |

## 3. Broken or defective items

| # | Issue | Severity | Evidence |
|---|---|---|---|
| 1 | `images/favicon.svg` referenced on all 8 pages but the file does not exist → 404 on every page | Low | READ |
| 2 | **Case-study pages overflow horizontally (125 px at 768, 184 px at 1280) when images fail to load.** With images present there is no overflow. Because every image is hotlinked, any Unsplash outage or ad-blocker produces a broken layout | Medium | TESTED (both conditions) |
| 3 | CSS rule `.featured-caption h2` never matches; the caption heading is an `<h3>` | Low | READ |
| 4 | Dead CSS: hamburger `span` transition with no transform; `.mobile-nav` opacity/transform transition cannot animate because `display` switches from `none` | Low | READ |
| 5 | Menu button `aria-label` stays "Open menu" when open | Low | TESTED |
| 6 | Same 7 stock photos reused 32 times, with different alt text describing different rooms | Medium (content integrity) | READ |

## 4. Missing features (required by the brief)

No backend, database, admin, rate limiting, or spam protection. Missing pages: Privacy Policy, Terms, Cookie Policy (if applicable), 404. Missing files: `robots.txt`, `sitemap.xml`, `netlify.toml`, `.gitignore`, `.env.example`, `TESTING.md`.

## 5. Navigation and links

Primary, mobile and footer navigation are consistent. Active page is shown only by a hard-coded CSS class; no `aria-current="page"`. No skip link. Project pages have prev/next and "All Projects" links. Header/footer are copy-pasted across 8 files (any footer change, such as adding legal links, needs 8 edits).

## 6. Responsive design

Breakpoints at 900, 700 and 560 px (desktop-first). No overflow at tested widths with images present (TESTED). Tablet 768 px uses the mobile menu. Gallery and grids collapse correctly in source. **Not tested:** real devices, landscape phones, zoom to 200%, long text.

## 7. Accessibility

Strengths listed in section 2. Gaps:

- No skip link; no `aria-current`; static menu label.
- Form errors are not linked with `aria-describedby`/`aria-invalid`; the submit button is not disabled while sending.
- Contrast (computed): muted text on footer background 4.36:1 (fails AA 4.5:1); accent `#9A8064` on page background 3.30:1 (passes only for large text); button hover text on accent 3.30:1 (fails).
- `href="#"` placeholder links are focusable and go nowhere.
- Input `outline: none` on focus (border colour change only).
- Repeated "View project →" link text.

## 8. SEO

Present: unique `title` and meta description on all pages, `lang`, viewport, single `h1`, crawlable static HTML.
Missing: canonical, Open Graph/Twitter tags, JSON-LD, `robots.txt`, `sitemap.xml`, favicon. Case-study titles are 18-24 characters and omit location. Projects-page description is 167 characters (may truncate). No admin pages exist yet, so a `noindex` policy will be needed for `/admin/`.

## 9. Performance

CSS 29 KB unminified; JS 5.4 KB; Google Fonts (6 files across 2 families) with `preconnect` and `display=swap`. 32 hotlinked images, no `srcset`, no `width`/`height`, hero not prioritised. **Lighthouse not run** (no network). External images/fonts are also a privacy and availability dependency (see section 11).

## 10. Placeholder and unverified content

| Item | Where | Status |
|---|---|---|
| `studio@lumen-interiors.com`, `+91 22 6123 4567` | header/footer/contact on every page | Unverified; README says LUMEN is fictional. Domain ownership unknown |
| "4th Floor, Kamala Mills, Lower Parel, Mumbai 400013" | footer, contact | Fictional studio at a real-world location; must be flagged or removed |
| Instagram / Pinterest / LinkedIn | footer, contact (`href="#"`) | Placeholders |
| Formspree `https://formspree.io/f/xrpbbaay` | `contact.html` | README calls it a placeholder; ownership/validity unknown, NOT TESTED |
| "Founded in 2019", areas, "Completed" statuses, project facts | studio, case studies | Fictional; must be labelled as such |
| "we'll be in touch within two business days" | `script.js` | An unverified commitment |

## 11. Security and privacy risks

- Contact form sends personal data to a third party (Formspree); no privacy notice exists.
- Success is reported when Formspree returns 2xx; there is no first-party record, so submissions cannot be audited or retried.
- No spam defence beyond Formspree's own; button not disabled during send (double-submit possible).
- No CSP or security headers (no `netlify.toml`).
- Google Fonts and Unsplash receive visitors' IP addresses and User-Agent; whether they set cookies is **not verified**. Image licensing: Unsplash licence terms must be re-checked per photo before production.
- Positive: no `innerHTML`/`eval`, no cookies or `localStorage` set by LUMEN's own code (READ).

## 12. Form submission problems

(1) Placeholder/unverified endpoint. (2) Success depends on a third party and is not stored by LUMEN. (3) No double-submit guard. (4) No honeypot/rate limit. (5) `form.action` is used directly, so changing the endpoint requires HTML edits. (6) No privacy notice or consent wording. (7) Error text not programmatically tied to fields.

## 13. Backend and database requirements (from the brief)

`inquiries` and `admin_users` tables with RLS; `submit-inquiry` function (validation, honeypot, best-effort rate limit, insert-then-confirm); protected list/detail/update functions that verify the Supabase JWT **and** admin membership server-side; admin login and dashboard; `.env.example`; `netlify.toml`.

## 14. Facts that must be verified before building (cannot be assumed)

1. Current Netlify free-plan limits, Netlify Functions allowances and pricing model.
2. Current Supabase free-tier limits (including project pausing after inactivity).
3. Commencement status of India's Digital Personal Data Protection Act provisions and Rules.
4. Whether Google Fonts / Unsplash set cookies in the deployed site (needs a browser with network access).

## 15. Proposed implementation plan

| Step | Work | Output |
|---|---|---|
| A | Fix defects in section 3; skip link, `aria-current`, contrast; legal links in all 8 footers; local favicon | Edited pages/CSS |
| B | Privacy, Terms, Cookie (facts-checked), 404 pages, marked DRAFT with placeholders | 4 new pages |
| C | `supabase/migrations/001_create_inquiries.sql` with constraints, indexes, `updated_at` trigger, RLS | SQL + policy notes |
| D | `netlify/functions/submit-inquiry.mjs` and shared validation module; unit tests with mocked Supabase | Function + tests |
| E | Connect `contact.html`/`script.js` (disable on send, preserve input, confirm only on server success) | Updated form |
| F | `admin/` login + dashboard; protected list/get/update functions with JWT + admin check | Admin app |
| G | `robots.txt`, `sitemap.xml`, canonical/OG, `netlify.toml` headers and CSP, `.gitignore`, `.env.example` | Config |
| H | Test run, `TESTING.md` (labelling anything needing real Supabase/Netlify as NOT TESTED), `README.md`, `HANDOFF.md` | Docs |

**Dependency note:** the only runtime dependency expected is `@supabase/supabase-js` for the Functions (via a small `package.json`); the public site stays dependency-free.

**Decisions I will make reversibly unless you object:** keep Formspree out entirely once the function is live; add a visible "concept/fictional" notice rather than inventing business facts; self-host images only if you supply them (otherwise keep Unsplash with an explicit fallback and layout fix for failed images).

---

# Status after implementation (2026-11-13)

| Audit item | Status |
|---|---|
| 1 Missing favicon | Fixed (`images/favicon.svg`) |
| 2 Overflow when images fail | Fixed and tested at 360/375/768/1280 px |
| 3 `.featured-caption h2` mismatch | Fixed (selector now `h3`) |
| 4 Dead nav transitions | Fixed: menu fades/slides via `visibility`; hamburger becomes a cross |
| 5 Static menu `aria-label` | Fixed |
| 6 Reused stock photos / alt text | **Open**: disclosed by concept notice; replace with real or distinct images |
| Contrast failures (footer, hover) | Fixed (5.73:1, 5.07:1); verified in browser |
| Skip link, `aria-current`, field focus outline, link names | Fixed |
| Form: placeholder endpoint, no first-party record, double submit, no honeypot, no privacy notice | Fixed (own backend; Formspree removed). **Real Supabase/Netlify still untested** |
| Placeholder contact details / social links | Removed or flagged |
| Legal pages, 404, robots, sitemap, canonical, OG, `.gitignore`, `netlify.toml`, CSP | Added |
| Database, RLS, functions, admin | Built; tested against a fake; real-platform tests are in TESTING.md |
| `aria-describedby` / `aria-invalid` on form errors | Fixed |
| Lighthouse, real devices, screen readers | **Not tested** |
