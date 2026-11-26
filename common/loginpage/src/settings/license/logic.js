/*
 * Settings › WorkSuite Office Pro: pure helpers for the license screen. No DOM, no fetch — the page
 * (LicensePage.jsx) owns the service calls; everything here is a plain function so logic.test.mjs can
 * check it. The service's GET /v1/license shape is in ai-service/docs/license-activation.md:
 *   { plan, active, licenseId?, issuedTo?, expiresAt?, features[], online?, lastOnlineOk?, reason?, proFeatures[] }
 */

/* Pro feature keys the service may report, in the order they are shown. Unknown keys still render,
 * labelled by the key itself, so a feature the service adds later is never hidden. */
export const FEATURE_ORDER = ["assistant", "ocr", "pdf.sign", "convert", "project.edit", "diagram.edit"];

export function isPro(status) {
  return !!status && status.plan === "pro" && status.active === true;
}

/** The feature keys the service treats as Pro, de-duplicated and in a stable order. */
export function proFeatures(status) {
  const list = (status && Array.isArray(status.proFeatures) ? status.proFeatures : []).filter((k) => typeof k === "string" && k);
  const seen = new Set(list);
  const ordered = FEATURE_ORDER.filter((k) => seen.has(k));
  for (const k of list) if (!ordered.includes(k)) ordered.push(k);
  return ordered;
}

/** True when an active Pro license grants `feature` ("*" covers every Pro feature). */
export function grants(status, feature) {
  if (!isPro(status)) return false;
  const f = Array.isArray(status.features) ? status.features : [];
  return f.includes("*") || f.includes(feature);
}

/** One row per Pro feature: { key, granted } — granted meaning the current license unlocks it. */
export function featureRows(status) {
  return proFeatures(status).map((key) => ({ key, granted: grants(status, key) }));
}

/** A machine key for the headline state, so the page can pick a style and the strings table a message. */
export function planState(status) {
  if (!status) return "unknown";
  if (isPro(status)) return "pro";
  // not Pro: either never licensed (free) or a stored license that is no longer valid (reason set)
  return status.reason ? "lapsed" : "free";
}

/** Short reason code → one of the strings-table keys, for the sub-line under a lapsed license. */
export function reasonKey(status) {
  const r = status && status.reason;
  switch (r) {
    case "expired": return "reasonExpired";
    case "revoked": return "reasonRevoked";
    case "grace_expired": return "reasonGraceExpired";
    case "wrong_device": return "reasonWrongDevice";
    case "bad_signature": return "reasonBadSignature";
    default: return r ? "reasonGeneric" : "";
  }
}

/** ISO date → a plain yyyy-mm-dd for display, or "" when absent/unparseable. Perpetual is null. */
export function formatDate(iso) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Trim and sanity-check a pasted key before sending it; returns "" when there is nothing to activate. */
export function cleanKey(text) {
  return typeof text === "string" ? text.trim() : "";
}

/* ---- the activation wizard ---- */

/** True for an activation key as typed: WSO and 20 letters and digits (spaces and dashes aside). */
export function looksLikeKey(text) {
  return /^\s*WS[O0][\s-]*([0-9A-Za-z][\s-]*){20}$/i.test(typeof text === "string" ? text : "");
}

/**
 * What the key box shows as someone types: WSO-XXXXX-XXXXX-XXXXX-XXXXX, upper case, dashes added. Pasted licence text
 * (a .wslicense file, or the signed JSON) is left as it is.
 */
export function formatKeyInput(raw) {
  const t = typeof raw === "string" ? raw : "";
  if (/[{}]|BEGIN WORKSUITE LICENSE/.test(t) || t.length > 64) return t;
  const chars = t.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (!chars) return "";
  if ("WSO".startsWith(chars)) return chars; // still typing the prefix
  const body = chars.startsWith("WSO") || chars.startsWith("WS0") ? chars.slice(3) : chars;
  const groups = body.slice(0, 20).match(/.{1,5}/g) || [];
  return ["WSO", ...groups].join("-");
}

/** True when the box holds something worth sending: a whole key, or pasted licence text. */
export function readyToActivate(text) {
  const t = cleanKey(text);
  return looksLikeKey(t) || /[{}]|BEGIN WORKSUITE LICENSE/.test(t) || t.length > 100;
}

/**
 * Why activation failed, as a strings-table key: the licence server's reason (detail.reason) first, then the kind of
 * error. Unknown reasons show the server's own message.
 */
export function failureKey(err) {
  const reason = err && err.detail && err.detail.reason;
  switch (reason) {
    case "LICENSE_KEY_INVALID": return "failInvalid";
    case "LICENSE_KEY_UNKNOWN": return "failUnknown";
    case "LICENSE_SEATS_FULL": return "failSeats";
    case "LICENSE_REVOKED": case "revoked": return "failRevoked";
    case "LICENSE_EXPIRED": case "expired": return "failExpired";
    case "offline": return "failOffline";
    case "wrong_device": return "reasonWrongDevice";
    case "bad_signature": return "failSignature";
  }
  if (err && err.code === "unreachable") return "failService";
  return "";
}

/** The wizard's steps, in order, for the step strip. */
export const WIZARD_STEPS = ["welcome", "key", "activating", "done"];
