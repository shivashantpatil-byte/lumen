// LUMEN admin: sign-in page + inquiries dashboard. No libraries.
// The browser never sees a Supabase key or URL: it talks only to /api/admin/* (Netlify Functions),
// which verify the session and the admin allow-list on the server for every request.
// The session token lives in sessionStorage (cleared when the tab closes). All data is rendered
// with textContent, never innerHTML, so inquiry text cannot inject markup.
(() => {
  "use strict";
  const KEY = "lumen_admin_session";
  const LABELS = { new: "New", in_progress: "In progress", responded: "Responded", archived: "Archived" };
  const TYPES = { residential: "Residential", hospitality: "Hospitality", commercial: "Commercial", other: "Other" };
  const $ = (sel) => document.querySelector(sel);

  const getSession = () => { try { return JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; } };
  const setSession = (s) => sessionStorage.setItem(KEY, JSON.stringify(s));
  const clearSession = () => sessionStorage.removeItem(KEY);
  const toLogin = () => { clearSession(); location.replace("/admin/login.html"); };

  async function post(path, body, token) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body || {}),
    });
    let data = null; try { data = await res.json(); } catch { /* not JSON */ }
    return { res, data };
  }

  // ------------------------------------------------------------------ login page
  function initLogin() {
    if (getSession()) { location.replace("/admin/"); return; }
    const form = $("#login-form"), status = $("#login-status"), btn = form.querySelector("button");
    let busy = false;
    const setStatus = (m, err) => { status.textContent = m; status.classList.toggle("is-error", !!err); };
    form.addEventListener("submit", async (e) => {
      e.preventDefault(); if (busy) return;
      let first = null;
      form.querySelectorAll("[required]").forEach((f) => {
        const bad = !f.value.trim(); f.closest(".form-group").classList.toggle("has-error", bad);
        f.setAttribute("aria-invalid", String(bad)); if (bad && !first) first = f;
      });
      if (first) { first.focus(); setStatus("Enter your email and password.", true); return; }
      busy = true; btn.disabled = true; setStatus("Signing in…");
      try {
        const { res, data } = await post("/api/admin/login", { email: form.email.value.trim(), password: form.password.value });
        if (res.ok && data?.access_token) {
          setSession({ access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at });
          location.replace("/admin/"); return;
        }
        form.password.value = "";
        setStatus(res.status === 429 ? "Too many attempts. Try again later." : data?.error || "Sign-in failed.", true);
      } catch { setStatus("Network problem. Check your connection and try again.", true); }
      finally { busy = false; btn.disabled = false; }
    });
  }

  // ---------------------------------------------------------------- dashboard
  async function refreshIfNeeded(force = false) {
    const s = getSession(); if (!s) return null;
    if (!force && s.expires_at - Date.now() > 60_000) return s;
    try {
      const { res, data } = await post("/api/admin/refresh", { refresh_token: s.refresh_token });
      if (!res.ok || !data?.access_token) return null;
      const next = { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at };
      setSession(next); return next;
    } catch { return force ? null : s; }   // offline: keep the old token and let the request fail visibly
  }

  async function api(path, options = {}) {
    let s = await refreshIfNeeded(); if (!s) { toLogin(); throw new Error("signed out"); }
    const run = (token) => fetch(path, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}) } });
    let res = await run(s.access_token);
    if (res.status === 401) {                                  // token rejected: refresh once, then retry
      s = await refreshIfNeeded(true); if (!s) { toLogin(); throw new Error("signed out"); }
      res = await run(s.access_token);
      if (res.status === 401) { toLogin(); throw new Error("signed out"); }
    }
    let data = null; try { data = await res.json(); } catch { /* ignore */ }
    return { res, data };
  }

  function initDashboard() {
    if (!getSession()) { toLogin(); return; }
    const state = { page: 1, total: 0, pageSize: 25 };
    const list = $("#list"), status = $("#list-status"), prev = $("#prev"), next = $("#next"), info = $("#page-info");
    const dlg = $("#detail"), dfb = $("#d-feedback"), dsave = $("#d-save");
    let current = null;
    let lastOpenedId = null;

    const fmt = (iso) => iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";
    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
    const setStatus = (m, kind) => { status.textContent = m; status.classList.toggle("is-error", kind === "error"); };

    async function load() {
      list.replaceChildren(); setStatus("Loading inquiries…");
      const q = new URLSearchParams({ page: String(state.page), sort: $("#sort-order").value });
      if ($("#filter-status").value) q.set("status", $("#filter-status").value);
      try {
        const { res, data } = await api(`/api/admin/inquiries?${q}`);
        if (res.status === 403) { setStatus("This account is not authorised.", "error"); return; }
        if (!res.ok) { setStatus(data?.error || "Could not load inquiries. Press Reload to try again.", "error"); return; }
        state.total = data.total ?? 0; state.pageSize = data.pageSize || 25;
        if (!data.items.length) setStatus("No inquiries match this filter.");
        else setStatus(`${state.total} inquir${state.total === 1 ? "y" : "ies"}`);
        for (const it of data.items) list.append(row(it));
      } catch (e) { if (e.message !== "signed out") setStatus("Network problem. Press Reload to try again.", "error"); }
      const pages = Math.max(1, Math.ceil(state.total / state.pageSize));
      info.textContent = `Page ${state.page} of ${pages}`;
      prev.disabled = state.page <= 1; next.disabled = state.page >= pages;
    }

    function row(it) {
      const li = el("li", "inquiry-item");
      li.append(el("span", "inquiry-name c-name", it.name), el("span", "inquiry-meta c-email", it.email),
        el("span", "inquiry-meta c-type", TYPES[it.project_type] || it.project_type), el("span", "inquiry-meta c-date", fmt(it.created_at)));
      const badge = el("span", `badge badge-${it.status} c-badge`, LABELS[it.status] || it.status);
      const view = el("span", "c-view"); const b = el("button", "btn btn-ghost", "View"); b.type = "button";
      b.setAttribute("aria-label", `View inquiry from ${it.name}`); b.addEventListener("click", () => openDetail(it.id));
      view.append(b); li.append(badge, view); li.dataset.id = it.id; return li;
    }

    async function openDetail(id) {
      lastOpenedId = id; setStatus("Loading inquiry…");
      try {
        const { res, data } = await api(`/api/admin/inquiries?id=${encodeURIComponent(id)}`);
        if (!res.ok) { setStatus(data?.error || "Could not load this inquiry.", "error"); return; }
        current = data.item; const i = current;
        $("#d-name").textContent = i.name;
        const mail = el("a", null, i.email); mail.href = `mailto:${i.email}`; $("#d-email").replaceChildren(mail);
        $("#d-type").textContent = TYPES[i.project_type] || i.project_type;
        $("#d-created").textContent = fmt(i.created_at); $("#d-updated").textContent = fmt(i.updated_at);
        $("#d-message").textContent = i.message; $("#d-status").value = i.status;
        dfb.textContent = ""; dfb.className = "admin-status"; setStatus(`${state.total} inquir${state.total === 1 ? "y" : "ies"}`);
        dlg.showModal();
      } catch (e) { if (e.message !== "signed out") setStatus("Network problem. Try again.", "error"); }
    }

    dsave.addEventListener("click", async () => {
      if (!current || dsave.disabled) return;
      dsave.disabled = true; dfb.className = "admin-status"; dfb.textContent = "Saving…";
      try {
        const { res, data } = await api("/api/admin/inquiries/status", { method: "PATCH", body: JSON.stringify({ id: current.id, status: $("#d-status").value }) });
        if (res.ok) { current.status = data.item.status; dfb.className = "admin-status is-success"; dfb.textContent = "Status saved."; load(); }
        else { dfb.className = "admin-status is-error"; dfb.textContent = data?.error || "Could not save. Try again."; }
      } catch (e) { if (e.message !== "signed out") { dfb.className = "admin-status is-error"; dfb.textContent = "Network problem. Your change was not saved."; } }
      finally { dsave.disabled = false; }
    });
    $("#d-close").addEventListener("click", () => dlg.close());
    // The list is rebuilt after a status save, which would drop keyboard focus. Put it back on
    // the same inquiry's View button when the dialog closes (Escape, Close button or backdrop).
    dlg.addEventListener("close", () => {
      const btn = [...list.children].find((li) => li.dataset.id === lastOpenedId)?.querySelector("button");
      if (btn) btn.focus();
    });

    $("#filter-status").addEventListener("change", () => { state.page = 1; load(); });
    $("#sort-order").addEventListener("change", () => { state.page = 1; load(); });
    $("#reload").addEventListener("click", load);
    prev.addEventListener("click", () => { if (state.page > 1) { state.page--; load(); } });
    next.addEventListener("click", () => { state.page++; load(); });
    $("#logout").addEventListener("click", async () => {
      const s = getSession(); clearSession();
      try { if (s) await post("/api/admin/logout", {}, s.access_token); } catch { /* server-side revoke is best effort */ }
      location.replace("/admin/login.html");
    });
    load();
  }

  const page = document.body.dataset.page;
  if (page === "login") initLogin(); else if (page === "dashboard") initDashboard();
})();
