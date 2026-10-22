/*
 * Pure helpers for Settings › WorkSuite, the organisation policy, updates and offline editing
 * (SHL-08, ADM-01, CLD-02, DOC-07). No Solid, no bridge: tested with `npm test` (node --test).
 */

/* The cloud providers bundled from upstream that WorkSuite Drive replaces (CLD-02, G-05) */
export const THIRD_PARTY_CLOUDS = ["box", "dropbox", "kdrive", "liferay", "moodle", "nextcloud", "owncloud", "seafile", "odoo"];

export const UPDATE_CHANNELS = ["stable", "beta"];
export const AI_MODES = ["all", "worksuite", "off"];

/* Registry values come as strings or DWORDs, plists and JSON as booleans: "1", 1, "true", true */
export function policyBool(v) {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return undefined;
}

function policyString(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
}

function policyEnum(v, allowed) {
  const s = policyString(v);
  return s && allowed.includes(s.toLowerCase()) ? s.toLowerCase() : undefined;
}

/*
 * The policy schema (docs: win-linux/../README "Managed configuration"): the same value names
 * in the Windows registry, the macOS configuration profile and /etc/worksuite-office/policy.json.
 * A value that is set is locked; anything unset stays the person's choice.
 * allowOtherClouds is false unless the organisation turns it on (CLD-02 off by default).
 */
export function normalizePolicy(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const p = {
    organization: policyString(r.organization),
    server: policyString(r.server),
    lockServer: policyBool(r.lockServer),
    allowOtherClouds: policyBool(r.allowOtherClouds),
    updateChannel: policyEnum(r.updateChannel, UPDATE_CHANNELS),
    updateAuto: policyBool(r.updateAuto),
    usageReports: policyBool(r.usageReports),
    aiFunctions: policyEnum(r.aiFunctions, AI_MODES),
  };
  if (p.server && !/^https?:\/\//i.test(p.server)) p.server = "https://" + p.server;
  if (p.server) p.server = p.server.replace(/\/+$/, "").toLowerCase();
  if (p.lockServer === undefined && p.server) p.lockServer = true;
  const keys = ["server", "allowOtherClouds", "updateChannel", "updateAuto", "usageReports", "aiFunctions"];
  p.managed = keys.some((k) => p[k] !== undefined);
  p.locked = Object.fromEntries(keys.map((k) => [k, p[k] !== undefined]));
  return p;
}

/* oda-shell → oda-platform (ADM-01, G-17): what the AI policy means for ai.js. "worksuite": WorkSuite AI only,
 * external providers off; "off": no AI at all; not set or "all": everything allowed. */
export function aiPolicyOf(policy) {
  const mode = policy && policy.aiFunctions;
  return { allowAi: mode !== "off", allowExternalAi: !mode || mode === "all" };
}

export function cloudAllowed(policy, provider) {
  if (!THIRD_PARTY_CLOUDS.includes(String(provider || "").toLowerCase())) return true;
  return !!(policy && policy.allowOtherClouds);
}

/* "Q4 sales forecast.xlsx" → "Q4 sales forecast (your offline copy).xlsx" (DOC-07) */
export function offlineCopyName(name, suffix) {
  const s = String(name || "");
  const dot = s.lastIndexOf(".");
  const tag = " (" + (suffix || "your offline copy") + ")";
  return dot > 0 ? s.slice(0, dot) + tag + s.slice(dot) : s + tag;
}

/*
 * What to do with an offline working copy once back online (DOC-07, NFR-13).
 * Never overwrites: a newer version on the server means the person chooses.
 */
export function reconcileOffline(baseVersion, serverVersion, localChanged) {
  if (!localChanged) return "discard-local";
  if (serverVersion == null || Number(serverVersion) === Number(baseVersion)) return "upload";
  return "choose";
}

/* Release notes (build/release-notes/<v>.md) → [{title, items[]}] for the update dialog */
export function parseReleaseNotes(md) {
  const sections = [];
  let cur = null;
  String(md || "").split(/\r?\n/).forEach((line) => {
    const h = /^#{2,3}\s+(.*)$/.exec(line);
    if (h) {
      cur = { title: h[1].trim(), items: [] };
      sections.push(cur);
      return;
    }
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (li) {
      if (!cur) sections.push((cur = { title: "", items: [] }));
      cur.items.push(li[1].replace(/\*\*|`/g, "").trim());
    } else if (line.trim() && cur && !cur.items.length && !/^#/.test(line)) {
      cur.items.push(line.trim());
    }
  });
  return sections.filter((s) => s.items.length);
}
