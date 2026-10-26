/*
 * Settings › AI Models (Local AI, W1, W2, W10): the page's rules, free of Solid and of the network so
 * node:test can run them (logic.test.mjs). The service (worksuite-ai, /v1) is authoritative: what it
 * says about fit, approval and policy wins; these helpers only fill in when a field is missing and
 * turn its answers into what the page shows.
 */

export const TASKS = ["stt", "correction", "suggestions", "translation", "tts", "assistant"];
export const PROFILES = ["lite", "standard", "advanced"];

/* PUT /v1/defaults keys → GET /v1/policy `features` keys (the policy says "translate") */
const POLICY_FEATURE = { stt: "stt", correction: "correction", suggestions: "suggestions", translation: "translate", tts: "tts", assistant: "assistant" };

/* catalog `tasks` may name a task the way the API's other parts do */
const TASK_ALIASES = { translate: "translation", "read-aloud": "tts", speech: "stt", chat: "assistant", completion: "suggestions", complete: "suggestions", check: "correction", transform: "correction" };

export function taskOf(name) {
  const n = String(name || "").toLowerCase();
  return TASK_ALIASES[n] || n;
}

export function tasksOf(model) {
  return [...new Set((model && model.tasks ? model.tasks : []).map(taskOf))];
}

/* ---- hardware --------------------------------------------------------- */

/* the service says which profile; this is only for an answer without one */
export function recommendedProfile(hw) {
  if (!hw) return "lite";
  if (PROFILES.includes(hw.recommendedProfile)) return hw.recommendedProfile;
  const ram = Number(hw.ramMB) || 0;
  const vram = Math.max(0, ...(hw.gpus || []).map((g) => Number(g.vramMB) || 0));
  if (ram >= 32768 || (ram >= 16384 && (vram >= 8192 || hw.appleSilicon))) return "advanced";
  if (ram >= 8192) return "standard";
  return "lite";
}

/*
 * "yes" | "tight" | "no" for a catalog card. The catalog's own `fits` comes first (the service knows
 * the backends); the organisation's memory cap (policy.maxMemMB) can only make it worse.
 */
export function fitOf(model, hw, policy) {
  const ram = Number(model && model.ramMB) || 0;
  let fit = ["yes", "tight", "no"].includes(model && model.fits) ? model.fits : null;
  if (!fit) {
    const total = Number(hw && hw.ramMB) || 0;
    if (!total || !ram) fit = "yes";
    else if (ram <= total * 0.5) fit = "yes";
    else if (ram <= total * 0.75) fit = "tight";
    else fit = "no";
  }
  const cap = Number(policy && policy.maxMemMB) || 0;
  if (cap && ram > cap) fit = "no";
  return fit;
}

export function overMemoryCap(model, policy) {
  const cap = Number(policy && policy.maxMemMB) || 0;
  return !!cap && (Number(model && model.ramMB) || 0) > cap;
}

/* ---- policy ----------------------------------------------------------- */

/*
 * GET /v1/policy → what the page locks. Feature switches left out are allowed. The desktop's own
 * managed configuration (aiFunctions "off", see docs/managed-configuration.md) turns everything off
 * even when the service has not read it yet.
 */
export function normalizeAiPolicy(raw, desktop) {
  const r = raw && typeof raw === "object" ? raw : {};
  const f = r.features && typeof r.features === "object" ? r.features : {};
  const off = desktop && desktop.aiFunctions === "off";
  const features = {};
  for (const task of TASKS) {
    const v = f[POLICY_FEATURE[task]];
    features[task] = off ? false : v !== false;
  }
  const approved = Array.isArray(r.approvedModels) ? r.approvedModels.map(String) : null;
  return {
    managed: !!r.managed || !!off,
    features,
    cloudAllowed: off ? false : r.cloudAllowed !== false,
    approvedModels: approved && approved.length ? approved : null,
    maxMemMB: Number(r.maxMemMB) > 0 ? Number(r.maxMemMB) : 0,
    gpuAllowed: r.gpuAllowed !== false,
    orgDictionaryUrl: typeof r.orgDictionaryUrl === "string" ? r.orgDictionaryUrl : "",
    allOff: !!off || TASKS.every((t) => features[t] === false),
  };
}

export function isApproved(model, policy) {
  if (model && model.approved === false) return false;
  if (policy && policy.approvedModels) return policy.approvedModels.includes(String(model && model.id));
  return true;
}

/* why Install is not offered for a card, or null */
export function installBlock(model, policy, freeDiskMB) {
  if (!isApproved(model, policy)) return "notApproved";
  const tasks = tasksOf(model);
  if (policy && tasks.length && tasks.every((t) => policy.features[t] === false)) return "featureOff";
  if (overMemoryCap(model, policy)) return "memoryCap";
  if (freeDiskMB != null && Number(model && model.sizeMB) > Number(freeDiskMB)) return "disk";
  return null;
}

/* the defaults picker for a task: Automatic, the installed models declaring it, Cloud when allowed */
export function defaultOptions(task, installed, policy, offlineOnly) {
  const opts = [{ value: "auto", kind: "auto" }];
  for (const m of installed || []) {
    if (tasksOf(m).includes(task) && m.state !== "failed") opts.push({ value: m.id, kind: "model", model: m });
  }
  if (policy && policy.cloudAllowed && !offlineOnly) opts.push({ value: "cloud", kind: "cloud" });
  return opts;
}

/* GET /v1/models → {task: id|"auto"|"cloud"}; the service has no GET /v1/defaults, isDefaultFor says it */
export function currentDefaults(installed, stored) {
  const out = {};
  for (const task of TASKS) {
    const m = (installed || []).find((x) => (x.isDefaultFor || []).map(taskOf).includes(task));
    out[task] = m ? m.id : stored && (stored[task] === "cloud" || stored[task] === "auto") ? stored[task] : "auto";
  }
  return out;
}

/* Offline only, or cloud not allowed: no default may stay on "cloud" */
export function withoutCloud(defaults) {
  const out = {};
  for (const k of Object.keys(defaults || {})) out[k] = defaults[k] === "cloud" ? "auto" : defaults[k];
  return out;
}

export function offlineOnlyLocked(policy) {
  return !!policy && !policy.cloudAllowed;
}

/* ---- installs: one entry per model id, driven by job and model events ---- */

/*
 * UI states (W1): available · queued · downloading · paused · verifying · unpacking · installed ·
 * active · update · failed. `reduceInstall(entry, event)` takes one /v1/events message (or a
 * GET /v1/jobs/{id} answer wrapped as {type:"job", data}) and returns the new entry; unknown
 * events leave it as it was, and a finished job never goes back to downloading.
 */
const PHASES = { downloading: "downloading", download: "downloading", verifying: "verifying", verify: "verifying", unpacking: "unpacking", unpack: "unpacking", ready: "installed", done: "installed", installed: "installed" };
const TERMINAL = ["installed", "active", "failed", "available"];

export function newInstall(modelId, jobId) {
  return { modelId, jobId, state: "queued", progress: 0, bytesDone: 0, bytesTotal: 0, error: null };
}

export function reduceInstall(entry, event) {
  if (!entry || !event) return entry;
  const data = event.data || {};
  const type = String(event.type || "");
  if (event.jobId && entry.jobId && event.jobId !== entry.jobId) return entry;
  const about = data.modelId || data.id;
  if (!event.jobId && about && about !== entry.modelId) return entry;

  if (type === "job" || type.startsWith("job.") || type === "progress") {
    const next = { ...entry };
    if (data.bytesTotal != null) next.bytesTotal = Number(data.bytesTotal) || 0;
    if (data.bytesDone != null) next.bytesDone = Number(data.bytesDone) || 0;
    if (data.progress != null) next.progress = clamp01(Number(data.progress) > 1 ? Number(data.progress) / 100 : Number(data.progress));
    else if (next.bytesTotal) next.progress = clamp01(next.bytesDone / next.bytesTotal);

    const s = String(data.state || "").toLowerCase();
    const phase = PHASES[String(data.phase || "").toLowerCase()];
    if (s === "failed" || s === "error") {
      next.state = "failed";
      next.error = (data.error && (data.error.code || data.error)) || "internal";
      return next;
    }
    if (s === "cancelled" || s === "canceled") return { ...next, state: "available", progress: 0, error: null };
    if (s === "paused") return TERMINAL.includes(entry.state) ? entry : { ...next, state: "paused" };
    if (s === "done" || s === "succeeded" || s === "completed") return { ...next, state: "installed", progress: 1, error: null };
    if (TERMINAL.includes(entry.state) && entry.state !== "available") return entry;
    if (phase) next.state = phase;
    else if (s === "queued") next.state = "queued";
    else if (s === "running" && (entry.state === "queued" || entry.state === "paused")) next.state = "downloading";
    if (next.state === "installed") next.progress = 1;
    return next;
  }

  if (type === "model" || type.startsWith("model.")) {
    const s = String(data.state || "").toLowerCase();
    if (s === "active") return { ...entry, state: "active", progress: 1, error: null };
    if (s === "installed") return { ...entry, state: "installed", progress: 1, error: null };
    if (s === "failed") return { ...entry, state: "failed", error: data.error || entry.error || "internal" };
    if (s === "removed" || s === "uninstalled") return { ...entry, state: "available", progress: 0 };
  }
  return entry;
}

/* what the card of a model shows, from the catalog entry, the installed list and an install in flight */
export function cardState(catalogModel, installedModel, install) {
  if (install && !["installed", "active", "available"].includes(install.state)) return install.state;
  if (installedModel) {
    if (installedModel.state === "failed") return "failed";
    if (installedModel.state === "updating") return "downloading";
    if (catalogModel && installedModel.version && catalogModel.version && compareVersions(catalogModel.version, installedModel.version) > 0) return "update";
    return installedModel.state === "active" ? "active" : "installed";
  }
  return "available";
}

export function actionsFor(state) {
  switch (state) {
    case "available": return ["install"];
    case "queued": return ["cancel"];
    case "downloading": return ["pause", "cancel"];
    case "paused": return ["resume", "cancel"];
    case "verifying":
    case "unpacking": return [];
    case "failed": return ["retry", "uninstall"];
    case "update": return ["update", "uninstall"];
    case "installed": return ["activate", "uninstall"];
    case "active": return ["deactivate", "uninstall"];
    default: return [];
  }
}

export function compareVersions(a, b) {
  const pa = String(a || "").split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b || "").split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/* ---- storage, formatting, diagnostics ---------------------------------- */

/* <storage>/models/<id>/<version>/… → <storage>; the service has no GET /v1/storage */
export function storageOf(installed) {
  const list = installed || [];
  const usedMB = list.reduce((s, m) => s + (Number(m.sizeMB) || 0), 0);
  let path = "";
  for (const m of list) {
    const p = String(m.path || "").replace(/\\/g, "/");
    const i = p.lastIndexOf("/models/");
    if (i > 0) {
      path = String(m.path).slice(0, i);
      break;
    }
  }
  return { path, usedMB };
}

export function formatMB(mb, locale) {
  const n = Number(mb) || 0;
  const fmt = (v, d) => {
    try {
      return new Intl.NumberFormat(String(locale || "en").replace(/_/g, "-"), { maximumFractionDigits: d }).format(v);
    } catch {
      return new Intl.NumberFormat("en", { maximumFractionDigits: d }).format(v);
    }
  };
  if (n >= 1024) return fmt(n / 1024, n >= 10240 ? 0 : 1) + " GB";
  return fmt(n, 0) + " MB";
}

export function evaluatedSi(model) {
  const e = model && model.evaluated && model.evaluated.si;
  if (!e || typeof e !== "object") return null;
  if (e.wer != null) return { metric: "wer", value: Number(e.wer) };
  if (e.mos != null) return { metric: "mos", value: Number(e.mos) };
  if (e.accuracy != null) return { metric: "accuracy", value: Number(e.accuracy) };
  return null;
}

/* the report "Copy report" puts on the clipboard: never document text or audio (the service promises the same) */
export function diagnosticsReport(parts) {
  const p = parts || {};
  const lines = ["WorkSuite Office — Local AI diagnostics", "Generated: " + (p.now || new Date().toISOString())];
  if (p.app) lines.push("App: " + p.app);
  if (p.info) lines.push("Service: " + (p.info.serviceVersion || "?") + " (API " + (p.info.apiVersion || "?") + "), profile " + (p.info.profile || "?"));
  else lines.push("Service: not running");
  if (p.hardware) {
    const h = p.hardware;
    lines.push("Hardware: " + [h.os, h.arch, h.cpu && h.cpu.model, h.cpu && h.cpu.cores + " cores", h.ramMB + " MB RAM"].filter(Boolean).join(", "));
    for (const g of h.gpus || []) lines.push("GPU: " + g.name + " (" + (g.vramMB || 0) + " MB, " + g.backend + ")");
  }
  for (const m of p.installed || []) lines.push("Model: " + m.id + " " + (m.version || "") + " " + m.state);
  if (p.diagnostics) lines.push("", "Service diagnostics:", JSON.stringify(p.diagnostics, null, 2));
  return lines.join("\n");
}

function clamp01(x) {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
}
