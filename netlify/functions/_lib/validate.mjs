// Server-side validation. Never trust the browser: these rules mirror (and are stricter than)
// the form's own checks and the database constraints.
export const PROJECT_TYPES = ["residential", "hospitality", "commercial", "other"];
export const STATUSES = ["new", "in_progress", "responded", "archived"];
export const LIMITS = { name: 100, email: 254, message: 5000 };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;          // no tabs/newlines allowed
const MSG_CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;       // newlines/tabs allowed in messages
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** @returns {{ok:true,value:object}|{ok:false,spam?:true,fields:Record<string,string>}} */
export function validateInquiry(body) {
  // Honeypot: a hidden field real visitors never fill in.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return { ok: false, spam: true, fields: {} };
  }
  const fields = {};
  const str = (k) => (typeof body[k] === "string" ? body[k] : null);

  const name = str("name")?.trim() ?? null;
  if (name === null || name.length < 1) fields.name = "Please enter your name.";
  else if (name.length > LIMITS.name) fields.name = `Name must be ${LIMITS.name} characters or fewer.`;
  else if (CONTROL_RE.test(name)) fields.name = "Name contains invalid characters.";

  const email = str("email")?.trim().toLowerCase() ?? null;
  if (email === null || email.length < 1) fields.email = "Please enter your email address.";
  else if (email.length > LIMITS.email || !EMAIL_RE.test(email) || CONTROL_RE.test(email)) {
    fields.email = "Please enter a valid email address.";
  }

  const projectType = str("project_type");
  if (!PROJECT_TYPES.includes(projectType)) fields.project_type = "Please choose a project type.";

  const message = str("message")?.replace(/\r\n/g, "\n").trim() ?? null;
  if (message === null || message.length < 1) fields.message = "Please write a message.";
  else if (message.length > LIMITS.message) fields.message = `Message must be ${LIMITS.message} characters or fewer.`;
  else if (MSG_CONTROL_RE.test(message)) fields.message = "Message contains invalid characters.";

  if (Object.keys(fields).length) return { ok: false, fields };
  return { ok: true, value: { name, email, project_type: projectType, message } };
}

export function validateStatusUpdate(body) {
  const errors = {};
  if (typeof body.id !== "string" || !UUID_RE.test(body.id)) errors.id = "Invalid inquiry id.";
  if (!STATUSES.includes(body.status)) errors.status = "Invalid status.";
  return Object.keys(errors).length ? { ok: false, fields: errors } : { ok: true, value: { id: body.id.toLowerCase(), status: body.status } };
}

export const isUuid = (v) => typeof v === "string" && UUID_RE.test(v);
