// ==================================================
// MOBILE NAVIGATION TOGGLE
// ==================================================
// querySelector finds the first element matching a CSS selector
// and gives us a reference to it, so we can read or change it.
const navToggle = document.querySelector(".nav-toggle");
const mobileNav = document.querySelector(".mobile-nav");

// addEventListener attaches a function that runs when a specific
// event happens on that element — here, a "click".
navToggle.addEventListener("click", () => {
  // classList.toggle adds a class if it's missing, or removes it
  // if it's already there. It returns true/false for the new state,
  // which is exactly what the mobile-nav.is-open CSS rule needs.
  const isOpen = mobileNav.classList.toggle("is-open");

  // aria-expanded tells screen reader users whether the menu this
  // button controls is currently open. We keep it in sync by hand
  // because toggling a CSS class doesn't update ARIA attributes.
  navToggle.setAttribute("aria-expanded", isOpen);
  navToggle.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
});

// Keyboard users expect Escape to close an open menu — this wasn't
// covered by the click handler above, since Escape doesn't fire a
// "click" event. We only act if the menu is actually open, so
// Escape doesn't do anything unexpected elsewhere on the page.
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && mobileNav.classList.contains("is-open")) {
    mobileNav.classList.remove("is-open");
    navToggle.setAttribute("aria-expanded", "false");
    navToggle.setAttribute("aria-label", "Open menu");
    navToggle.focus();
  }
});

// ==================================================
// CONTACT FORM: validation + submission to our own backend
// ==================================================
// Runs only on contact.html; the guard stops other pages throwing.
// The form posts JSON to /api/submit-inquiry (a Netlify Function).
// Success is shown ONLY when the server answers 201, which the
// function sends after the database confirms the insert.
const form = document.querySelector("#inquiry-form");

if (form) {
  const status = document.querySelector("#form-status");
  const submitButton = form.querySelector('button[type="submit"]');
  const ENDPOINT = form.getAttribute("action");
  let sending = false; // blocks repeated submissions while a request is in flight

  function setStatus(message, kind) {
    status.textContent = message;
    status.classList.toggle("is-success", kind === "success");
    status.classList.toggle("is-error", kind === "error");
  }

  function setSending(isSending) {
    sending = isSending;
    submitButton.disabled = isSending;
    submitButton.setAttribute("aria-disabled", String(isSending));
    submitButton.textContent = isSending ? "Sending…" : "Send Inquiry";
  }

  // checkValidity() uses the browser's own rules: "required" means
  // non-empty, type="email" checks for an email-shaped value.
  function validate() {
    let firstInvalid = null;
    form.querySelectorAll("[required]").forEach((field) => {
      const group = field.closest(".form-group");
      const isValid = field.checkValidity() && field.value.trim() !== "";
      group.classList.toggle("has-error", !isValid);
      field.setAttribute("aria-invalid", String(!isValid));
      if (!isValid && !firstInvalid) firstInvalid = field;
    });
    return firstInvalid;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (sending) return;

    const firstInvalid = validate();
    if (firstInvalid) {
      firstInvalid.focus();
      setStatus("Please fix the highlighted fields.", "error");
      return;
    }

    setSending(true);
    setStatus("Sending…", null);

    // Plain object -> JSON. Field names match what the server expects.
    const payload = {
      name: form.elements["name"].value.trim(),
      email: form.elements["email"].value.trim(),
      project_type: form.elements["project_type"].value,
      message: form.elements["message"].value.trim(),
      website: form.elements["website"].value, // honeypot: real people leave it empty
    };

    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });

      let body = null;
      try { body = await response.json(); } catch (_) { /* non-JSON error page */ }

      if (response.status === 201 && body && body.ok === true) {
        setStatus("Thank you. Your inquiry has been received.", "success");
        form.reset();
        form.querySelectorAll(".has-error").forEach((g) => g.classList.remove("has-error"));
        form.querySelectorAll("[aria-invalid]").forEach((f) => f.removeAttribute("aria-invalid"));
      } else if (response.status === 429) {
        setStatus("Too many attempts. Please wait a few minutes and try again. Your message is still in the form.", "error");
      } else if (response.status === 400 || response.status === 422) {
        setStatus((body && body.error) || "Please check the form and try again.", "error");
      } else {
        setStatus("We could not save your inquiry. Please try again later. Your message is still in the form.", "error");
      }
    } catch (error) {
      // fetch() rejects only for network-level failures (offline, DNS, blocked).
      setStatus("Network problem: your inquiry was not sent. Please check your connection and try again. Your message is still in the form.", "error");
    } finally {
      setSending(false);
    }
  });

  // Clear a field's error as soon as the person starts fixing it.
  form.querySelectorAll("[required]").forEach((field) => {
    const clear = () => {
      field.closest(".form-group").classList.remove("has-error");
      field.removeAttribute("aria-invalid");
    };
    field.addEventListener("input", clear);
    field.addEventListener("change", clear);
  });
}
