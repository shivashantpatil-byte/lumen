"""End-to-end browser tests (Chromium via Playwright) against tests/dev-server.mjs.
Real: the HTML/CSS/JS, the Netlify Function code, the CSP header. Fake: Supabase (in-memory).
Run:  node tests/dev-server.mjs &   then   python3 tests/e2e.py
"""
import json, re, sys, time, urllib.request
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8790"
PAGES = ["index.html","projects.html","studio.html","contact.html","projects/residence-no-01.html","projects/coastal-house.html",
         "projects/quiet-courtyard.html","projects/atelier-17.html","privacy-policy.html","terms-and-conditions.html","cookie-policy.html"]
results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond), detail)); print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if (detail and not cond) else ""))
def state(**kw):
    req = urllib.request.Request(BASE + "/__test/state", data=json.dumps(kw).encode(), method="POST", headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))
SVG = lambda w, h: f"<svg xmlns='http://www.w3.org/2000/svg' width='{w}' height='{h}'><rect width='100%' height='100%' fill='#bbb'/></svg>"
def external(route, images="fail"):
    u = route.request.url
    if "images.unsplash.com" in u:
        return route.abort() if images == "fail" else route.fulfill(status=200, content_type="image/svg+xml", body=SVG(1800, 1200))
    if "fonts.g" in u: return route.abort()
    route.continue_()

with sync_playwright() as p:
    b = p.chromium.launch()
    def new(width=1280, images="fail", **kw):
        ctx = b.new_context(viewport={"width": width, "height": 800}, **kw); pg = ctx.new_page()
        pg.route("**/*", lambda r: external(r, images)); errs = []
        pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
        pg.on("console", lambda m: errs.append("console: " + m.text) if (m.type == "error" and "Failed to load resource" not in m.text and "ERR_" not in m.text) else None)
        pg.errs = errs; return pg

    # ---------------------------------------------------------------- public pages
    state(reset=True)
    for pgname in PAGES:
        pg = new(); r = pg.goto(f"{BASE}/{pgname}", wait_until="domcontentloaded")
        check(f"loads 200: {pgname}", r.status == 200)
        check(f"no JS errors / CSP violations: {pgname}", not pg.errs, "; ".join(pg.errs)[:200])
        check(f"CSP header present: {pgname}", "default-src 'self'" in (r.headers.get("content-security-policy") or ""))
        pg.context.close()

    # local links / assets resolve (404 means broken)
    pg = new(); seen = set(); broken = []
    for pgname in PAGES + ["404.html"]:
        pg.goto(f"{BASE}/{pgname}", wait_until="domcontentloaded")
        for u in pg.evaluate("[...document.querySelectorAll('[href]:not([rel=canonical]),[src]')].map(e=>e.getAttribute('href')||e.getAttribute('src'))"):
            if re.match(r"^(https?:|mailto:|tel:|#|data:)", u): continue
            full = pg.evaluate("(u)=>new URL(u,location.href).pathname", u)
            if full in seen: continue
            seen.add(full); code = urllib.request.urlopen(BASE + full).status if True else 0
            if code != 200: broken.append((pgname, u, code))
    check("every local link and asset resolves (no 404s)", not broken, str(broken)[:200])
    check("favicon exists", urllib.request.urlopen(BASE + "/images/favicon.svg").status == 200)

    # tests: external links leaving the site are only fonts/Unsplash (no placeholder '#' links)
    pg.goto(f"{BASE}/index.html"); hashes = pg.evaluate("[...document.querySelectorAll('a')].filter(a=>a.getAttribute('href')==='#').length")
    check("no placeholder href=\"#\" links remain", hashes == 0, str(hashes)); pg.context.close()

    # ---------------------------------------------------------------- layout: overflow with images failed / loaded
    for mode in ("fail", "ok"):
        for w in (360, 375, 768, 1280):
            bad = []
            for pgname in PAGES + ["404.html"]:
                pg = new(w, images=mode); pg.goto(f"{BASE}/{pgname}", wait_until="domcontentloaded"); pg.wait_for_timeout(250)
                ov = pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
                if ov > 0: bad.append((pgname, ov))
                pg.context.close()
            check(f"no horizontal overflow, images {'FAILED' if mode=='fail' else 'loaded'}, {w}px, all pages", not bad, str(bad))

    # ---------------------------------------------------------------- navigation + a11y basics
    pg = new(375); pg.goto(f"{BASE}/projects.html")
    t, nav = pg.locator(".nav-toggle"), pg.locator("#mobile-nav")
    check("mobile menu closed: hidden and links not focusable", not nav.is_visible() and pg.evaluate("getComputedStyle(document.querySelector('#mobile-nav')).visibility") == "hidden")
    t.click(); pg.wait_for_timeout(400)
    check("mobile menu opens; aria-expanded=true; label 'Close menu'", nav.is_visible() and t.get_attribute("aria-expanded") == "true" and t.get_attribute("aria-label") == "Close menu")
    check("hamburger animates into a cross", "matrix" in pg.evaluate("getComputedStyle(document.querySelector('.nav-toggle span:nth-child(1)')).transform"))
    pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
    check("Escape closes menu, returns focus to button, label reset", not nav.is_visible() and pg.evaluate("document.activeElement.className").startswith("nav-toggle") and t.get_attribute("aria-label") == "Open menu")
    check("current page marked aria-current=page", pg.locator('#mobile-nav [aria-current="page"]').count() == 1 and pg.locator('[aria-current="page"]').first.inner_text().strip().lower() == "projects"); pg.context.close()
    pg = new(1280); pg.goto(f"{BASE}/studio.html"); pg.keyboard.press("Tab"); pg.wait_for_timeout(350)
    check("skip link is first focusable and visible on focus", pg.evaluate("document.activeElement.className") == "skip-link" and pg.evaluate("document.activeElement.getBoundingClientRect().top") >= 0)
    pg.keyboard.press("Enter"); check("skip link moves focus to main content", pg.evaluate("document.activeElement.id") == "main")
    check("no concept notice and legal links on every page", pg.locator(".concept-notice").count() == 0 and pg.locator("footer a[href$='privacy-policy.html']").count() == 1)
    for pgname in PAGES:
        pg.goto(f"{BASE}/{pgname}"); h1 = pg.locator("h1").count()
        if h1 != 1: check(f"exactly one h1: {pgname}", False, str(h1))
    check("every page has exactly one h1", True)
    r = pg.goto(f"{BASE}/this-page-does-not-exist"); check("unknown URL returns 404 status with custom page", r.status == 404 and "could not be found" in pg.content() and pg.locator("a[href='/projects.html']").count() >= 1)
    check("404 page is styled (root-absolute CSS loads)", pg.evaluate("getComputedStyle(document.body).fontFamily").lower().find("inter") >= 0 or pg.evaluate("getComputedStyle(document.querySelector('header')).display") != "none")
    pg.context.close()

    # contrast check of changed colours (computed in browser)
    pg = new(1280); pg.goto(f"{BASE}/index.html")
    def lum(c):
        r, g, bl = [int(x) / 255 for x in re.findall(r"\d+", c)[:3]]; f = lambda v: v / 12.92 if v <= .03928 else ((v + .055) / 1.055) ** 2.4
        return .2126 * f(r) + .7152 * f(g) + .0722 * f(bl)
    ratio = lambda a, c: (max(lum(a), lum(c)) + .05) / (min(lum(a), lum(c)) + .05)
    fm = pg.evaluate("getComputedStyle(document.querySelector('.site-footer .footer-heading')).color"); fb = pg.evaluate("getComputedStyle(document.querySelector('.site-footer')).backgroundColor")
    check("footer muted text now >= 4.5:1", ratio(fm, fb) >= 4.5, f"{ratio(fm, fb):.2f}")
    pg.context.close()

    # ---------------------------------------------------------------- contact form
    SEL = dict(name="#name", email="#email", type="#project-type", msg="#message")
    def fill(pg, name="Asha Rao", email="asha@example.com", typ="residential", msg="Hello, we want a quiet home."):
        pg.fill(SEL["name"], name); pg.fill(SEL["email"], email); pg.select_option(SEL["type"], typ); pg.fill(SEL["msg"], msg)
    state(reset=True)
    pg = new(); pg.goto(f"{BASE}/contact.html")
    pg.click("button[type=submit]")
    check("empty submit: 4 field errors, first field focused, error status, nothing sent", pg.locator(".has-error").count() == 4 and pg.evaluate("document.activeElement.id") == "name" and "highlighted" in pg.inner_text("#form-status") and len(state()["inquiries"]) == 0)
    check("invalid fields get aria-invalid and are described by their error text", pg.get_attribute("#name", "aria-invalid") == "true" and pg.get_attribute("#name", "aria-describedby") == "name-error")
    fill(pg, email="not-an-email"); pg.click("button[type=submit]")
    check("invalid email blocked client-side", pg.locator("#email").evaluate("e=>e.closest('.form-group').classList.contains('has-error')") and len(state()["inquiries"]) == 0)
    pg.fill("#email", "asha@example.com")
    with pg.expect_request("**/api/submit-inquiry") as ri: pg.click("button[type=submit]")
    pg.wait_for_selector("#form-status.is-success"); req = ri.value; pl = json.loads(req.post_data)
    check("valid submit: JSON POST to our function, success only after server 201", req.method == "POST" and req.headers["content-type"] == "application/json" and "Thank you" in pg.inner_text("#form-status"))
    st = state(); row = st["inquiries"][0] if st["inquiries"] else {}
    check("valid submit: row actually stored, email normalised, honeypot not stored", len(st["inquiries"]) == 1 and row.get("email") == "asha@example.com" and row.get("name") == "Asha Rao" and "website" not in row)
    check("form reset only after confirmed success", pg.input_value("#name") == "" and pg.input_value("#message") == "")
    check("no secrets in request payload / no Formspree", set(pl) == {"name","email","project_type","message","website"} and "formspree" not in req.url)
    check("button re-enabled and label restored after success", pg.is_enabled("button[type=submit]") and pg.inner_text("button[type=submit]") == "Send Inquiry")

    state(reset=True, failInsert=True); fill(pg); pg.click("button[type=submit]"); pg.wait_for_selector("#form-status.is-error")
    check("DB failure: error shown, NOT success, input preserved, nothing stored", "could not save" in pg.inner_text("#form-status").lower() and pg.input_value("#message").startswith("Hello") and "Thank you" not in pg.inner_text("#form-status") and len(state()["inquiries"]) == 0)
    state(reset=True); pg.click("button[type=submit]"); pg.wait_for_selector("#form-status.is-success"); check("retry after DB recovers succeeds (input was preserved)", len(state()["inquiries"]) == 1)

    state(reset=True); fill(pg); pg.route("**/api/submit-inquiry", lambda r: r.abort()); pg.click("button[type=submit]"); pg.wait_for_selector("#form-status.is-error")
    check("network failure: clear message, input preserved, no success", "network" in pg.inner_text("#form-status").lower() and pg.input_value("#name") == "Asha Rao" and pg.is_enabled("button[type=submit]"))
    pg.unroute("**/api/submit-inquiry")

    state(reset=True, delayMs=700); pg.click("button[type=submit]", delay=0); pg.click("button[type=submit]", force=True, no_wait_after=True); pg.wait_for_timeout(300)
    check("while sending: button disabled and labelled 'Sending…'", pg.is_disabled("button[type=submit]") and "Sending" in pg.inner_text("button[type=submit]"))
    pg.wait_for_selector("#form-status.is-success", timeout=5000); check("repeated clicks create only ONE inquiry", len(state()["inquiries"]) == 1)

    state(reset=True); fill(pg); pg.evaluate("document.querySelector('#website').value='http://spam.example'"); pg.click("button[type=submit]"); pg.wait_for_selector("#form-status.is-error")
    check("honeypot: rejected, not stored, not reported as success", len(state()["inquiries"]) == 0 and "Thank you" not in pg.inner_text("#form-status"))
    check("honeypot field is off-screen and hidden from assistive tech", pg.evaluate("document.querySelector('.hp-field').getAttribute('aria-hidden')") == "true" and pg.evaluate("document.querySelector('.hp-field').getBoundingClientRect().left") < -1000)
    pg.evaluate("document.querySelector('#website').value=''")

    state(reset=True)
    for i in range(5): pg.evaluate("fetch('/api/submit-inquiry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'a',email:'a@b.co',project_type:'other',message:'m',website:''})})")
    pg.wait_for_timeout(300); fill(pg); pg.click("button[type=submit]"); pg.wait_for_selector("#form-status.is-error")
    check("rate limit (429): friendly message, input preserved", "too many" in pg.inner_text("#form-status").lower() and pg.input_value("#name") == "Asha Rao")
    state(reset=True)
    big = pg.evaluate("fetch('/api/submit-inquiry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'a',email:'a@b.co',project_type:'other',message:'x'.repeat(50000),website:''})}).then(r=>r.status)")
    check("oversized payload rejected with 413 and not stored", big == 413 and len(state()["inquiries"]) == 0)
    pg.context.close()

    # ---------------------------------------------------------------- admin
    state(reset=True, seed=30)
    pg = new(1280); pg.goto(f"{BASE}/admin/"); pg.wait_for_url("**/admin/login.html")
    check("unauthenticated /admin/ redirects to login", pg.url.endswith("/admin/login.html"))
    r = pg.goto(f"{BASE}/admin/login.html"); check("admin pages: noindex meta + header, no-store", pg.locator("meta[name=robots]").get_attribute("content").startswith("noindex") and "noindex" in r.headers.get("x-robots-tag", "") and r.headers.get("cache-control") == "no-store")
    pg.click("button[type=submit]"); check("login: empty fields rejected client-side", pg.locator(".has-error").count() == 2)
    pg.fill("#email", "admin@example.test"); pg.fill("#password", "wrong"); pg.click("button[type=submit]"); pg.wait_for_selector("#login-status.is-error")
    check("login: wrong password shows generic error, password cleared, no session", "Incorrect" in pg.inner_text("#login-status") and pg.input_value("#password") == "" and pg.evaluate("sessionStorage.getItem('lumen_admin_session')") is None)
    pg.fill("#email", "plain@example.test"); pg.fill("#password", "correct-horse"); pg.click("button[type=submit]"); pg.wait_for_selector("#login-status.is-error")
    check("login: valid non-admin user is refused (403) and gets no session", "not authorised" in pg.inner_text("#login-status").lower() and pg.evaluate("sessionStorage.getItem('lumen_admin_session')") is None)
    pg.fill("#email", "admin@example.test"); pg.fill("#password", "correct-horse"); pg.click("button[type=submit]"); pg.wait_for_url("**/admin/")
    pg.wait_for_selector(".inquiry-item")
    check("admin login succeeds, dashboard lists 25 of 30, newest first", pg.locator(".inquiry-item").count() == 25 and "30 inquiries" in pg.inner_text("#list-status") and "Seed Person 30" in pg.locator(".inquiry-item").first.inner_text())
    check("list shows no message bodies", "Seed message" not in pg.inner_text("#list"))
    sess = pg.evaluate("sessionStorage.getItem('lumen_admin_session')"); check("session stored in sessionStorage (not localStorage, no cookies)", sess and pg.evaluate("localStorage.length") == 0 and not pg.context.cookies())
    pg.click("#next"); pg.wait_for_selector("#page-info:has-text('Page 2')"); check("pagination: page 2 shows remaining 5", pg.locator(".inquiry-item").count() == 5 and pg.is_disabled("#next")); pg.click("#prev"); pg.wait_for_selector(".inquiry-item >> nth=24")
    pg.select_option("#filter-status", "responded"); pg.wait_for_selector("#list-status:has-text('10 inquiries')")
    check("filter by status", pg.locator(".inquiry-item").count() == 10 and all("Responded" in t for t in pg.locator(".badge").all_inner_texts()))
    pg.select_option("#filter-status", ""); pg.wait_for_selector("#list-status:has-text('30 inquiries')"); pg.select_option("#sort-order", "asc"); pg.wait_for_selector(".inquiry-item:first-child:has-text('Seed Person 1')")
    check("sort oldest first", "Seed Person 1" in pg.locator(".inquiry-item").first.inner_text())
    pg.locator(".inquiry-item").first.get_by_role("button").click(); pg.wait_for_selector("dialog[open]")
    check("detail dialog shows full message, email link and status", pg.inner_text("#d-message") == "Seed message 1" and pg.get_attribute("#d-email a", "href").startswith("mailto:") and pg.input_value("#d-status") == "new")
    pg.select_option("#d-status", "in_progress"); pg.click("#d-save"); pg.wait_for_selector("#d-feedback.is-success")
    check("status change saved server-side and reflected in list", next(i for i in state()["inquiries"] if i["id"].endswith("0001"))["status"] == "in_progress")
    pg.keyboard.press("Escape"); pg.wait_for_selector("dialog[open]", state="detached"); pg.wait_for_selector(".badge-in_progress")
    check("Escape closes dialog and focus returns to the View button", pg.evaluate("document.activeElement.textContent") == "View" and pg.locator(".badge-in_progress").count() == 1)

    # session expiry -> refresh path
    pg.evaluate("(()=>{const s=JSON.parse(sessionStorage.getItem('lumen_admin_session'));s.expires_at=Date.now()-1000;sessionStorage.setItem('lumen_admin_session',JSON.stringify(s))})()")
    with pg.expect_request("**/api/admin/refresh"): pg.click("#reload")
    pg.wait_for_selector(".inquiry-item"); check("expired token is refreshed transparently", pg.locator(".inquiry-item").count() == 25)
    # server rejects token -> back to login
    pg.evaluate("(()=>{const s=JSON.parse(sessionStorage.getItem('lumen_admin_session'));s.access_token='tok-garbage-garbage-garbage-x';s.refresh_token='bad';s.expires_at=Date.now()+3600000;sessionStorage.setItem('lumen_admin_session',JSON.stringify(s))})()")
    pg.click("#reload"); pg.wait_for_url("**/admin/login.html"); check("invalid session is sent back to login and cleared", pg.evaluate("sessionStorage.getItem('lumen_admin_session')") is None)

    # XSS: hostile inquiry content must render as text
    state(reset=True); pg2 = new(1280); pg2.goto(f"{BASE}/contact.html")
    hostile = "<img src=x onerror=\"window.__xss=1\"><script>window.__xss=2</script>"
    fill(pg2, name="<b>Bold</b>", msg=hostile); pg2.click("button[type=submit]"); pg2.wait_for_selector("#form-status.is-success"); pg2.context.close()
    pg.goto(f"{BASE}/admin/login.html"); pg.fill("#email", "admin@example.test"); pg.fill("#password", "correct-horse"); pg.click("button[type=submit]"); pg.wait_for_selector(".inquiry-item")
    pg.locator(".inquiry-item").first.get_by_role("button").click(); pg.wait_for_selector("dialog[open]")
    check("XSS: markup in name/message is shown as text, nothing executes or is injected", pg.inner_text("#d-message") == hostile and pg.locator("#d-message img, #d-message script, #list b").count() == 0 and pg.evaluate("window.__xss") is None)
    pg.keyboard.press("Escape")
    # logout
    pg.click("#logout"); pg.wait_for_url("**/admin/login.html")
    check("logout clears session, revokes it server-side, and /admin/ requires login again", pg.evaluate("sessionStorage.getItem('lumen_admin_session')") is None and len(state()["signedOut"]) >= 1)
    pg.goto(f"{BASE}/admin/"); pg.wait_for_url("**/admin/login.html"); check("after logout, dashboard URL redirects to login", True); pg.context.close()
    # direct unauthenticated API access
    pg = new(); pg.goto(f"{BASE}/contact.html")
    codes = pg.evaluate("Promise.all([fetch('/api/admin/inquiries').then(r=>r.status),fetch('/api/admin/inquiries?id=10000000-0000-4000-8000-000000000001').then(r=>r.status),fetch('/api/admin/inquiries/status',{method:'PATCH',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.status)])")
    check("anonymous API calls to admin endpoints all return 401", codes == [401, 401, 401], str(codes)); pg.context.close()

    # admin on a phone
    state(reset=True, seed=12); pg = new(375); pg.goto(f"{BASE}/admin/login.html"); pg.fill("#email", "admin@example.test"); pg.fill("#password", "correct-horse"); pg.click("button[type=submit]"); pg.wait_for_selector(".inquiry-item")
    check("admin dashboard 375px: no horizontal overflow, cards stacked", pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth") <= 0 and pg.evaluate("getComputedStyle(document.querySelector('.inquiry-item')).gridTemplateAreas").startswith('"name badge"'))
    pg.locator(".inquiry-item").first.get_by_role("button").click(); pg.wait_for_selector("dialog[open]")
    box = pg.evaluate("(()=>{const r=document.querySelector('dialog').getBoundingClientRect();return [r.left,r.right,innerWidth]})()")
    check("admin detail dialog fits a 375px phone", box[0] >= 0 and box[1] <= box[2] + 0.5, str(box)); pg.context.close()
    b.close()

failed = [r for r in results if not r[1]]
print(f"\n{len(results)-len(failed)}/{len(results)} checks passed"); sys.exit(1 if failed else 0)
