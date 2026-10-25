/*
 * WorkSuite parts of the app shell: the organisation policy (ADM-01, CLD-02), updates
 * (SHL-08, SHL-09), the Drive preferences of Settings › WorkSuite (SHL-08) and offline
 * editing of Drive documents (DOC-07).
 *
 * Native contract (win-linux CWorkSuite, macos ASCCommonViewController), start page only:
 *   "worksuite:policy"  ""                                   → {"managed","source","policy":{…}}
 *   "worksuite:updates" {"op":"get|set|check|restart","channel","auto"}
 *                                                            → {"available","version","channel","auto",
 *                                                               "lastCheck","host","busy","text"}
 *   native → "worksuite:update-ready" {"version","channel","verified","signer","signatureChecked","notes"}
 *   native → "worksuite:offline" {"state":"offline|online","file":{id,name,ext},"server","uid",
 *                                 "baseVersion","path","changed"}
 *   "worksuite:upload"  {"req","url","token","path","fields":{…},"name"} → {"req","status","body"}
 *   "worksuite:transfer" Clouds › WorkSuite Drive's uploads and downloads (this file:// page cannot send bytes itself):
 *     {"op":"chunk","req","url":"https://<server>/api/uploads/<uuid>/chunk","token","index","data":<base64>}
 *                                                            → {"req","status","body"}
 *     {"op":"download","req","url":"https://<server>/media/<token>?download=1","name"}
 *                                                            → {"req","received","total"} while it runs, then
 *                                                              {"req","status","done":true,"path"} (Downloads)
 *     {"op":"cancel","req"}                                  stops a download
 *     {"op":"reveal","path"}                                 shows a downloaded file in the file manager
 */
import { createSignal } from "solid-js";
import { normalizePolicy, cloudAllowed, aiPolicyOf, reconcileOffline, offlineCopyName } from "./shell-logic.js";

const native = () => window.AscDesktopEditor;

function send(cmd, param) {
  const n = native();
  if (n && n.execCommand) n.execCommand(cmd, typeof param === "string" ? param : JSON.stringify(param ?? ""));
}

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    value === undefined ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

/* ---- policy ---------------------------------------------------------- */

const [policy, setPolicyRaw] = createSignal(normalizePolicy(read("ws:policy", null)));
export { policy };
export const serverLocked = () => !!(policy().lockServer && policy().server);
export const isCloudAllowed = (provider) => cloudAllowed(policy(), provider);

/* oda-platform hook (G-17): ai.js reads window.WorkSuitePolicy.allowExternalAi / allowAi */
function publishAiPolicy(p) {
  const ai = aiPolicyOf(p);
  window.WorkSuitePolicy = Object.assign({}, window.WorkSuitePolicy, ai);
  if (window.WorkSuiteAi && typeof window.WorkSuiteAi.sync === "function") window.WorkSuiteAi.sync();
}
publishAiPolicy(policy());

function applyPolicy(raw) {
  const p = normalizePolicy(raw);
  setPolicyRaw(p);
  write("ws:policy", p.managed ? p : undefined);
  publishAiPolicy(p);
}

/* ---- updates --------------------------------------------------------- */

const [updates, setUpdates] = createSignal({ available: false });
const [updateReady, setUpdateReady] = createSignal(null);
export { updates, updateReady };

export function setUpdateChannel(channel) {
  if (policy().locked.updateChannel) return;
  setUpdates({ ...updates(), channel });
  send("worksuite:updates", { op: "set", channel });
}

export function setUpdateAuto(auto) {
  if (policy().locked.updateAuto) return;
  setUpdates({ ...updates(), auto });
  send("worksuite:updates", { op: "set", auto: !!auto });
}

export const checkForUpdates = () => send("worksuite:updates", { op: "check" });
export const restartToUpdate = () => send("worksuite:updates", { op: "restart" });
export const dismissUpdateReady = () => setUpdateReady({ ...updateReady(), dismissed: true });

/* ---- Drive preferences ----------------------------------------------- */

const [openIn, setOpenInSig] = createSignal(read("ws:pref:openIn", "office"));
const [prefServer, setPrefServerSig] = createSignal(read("ws:pref:server", ""));
export { openIn, prefServer };
export function setOpenIn(v) {
  setOpenInSig(v);
  write("ws:pref:openIn", v);
}
export function setPrefServer(v) {
  setPrefServerSig(v);
  write("ws:pref:server", v || undefined);
}

/* ---- Clouds › WorkSuite Drive: transfers through the app ------------- */

const transfers = {};
const reqId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

/* whether this app carries the transfer command (an older one answers nothing) */
export function canTransfer() {
  const n = native();
  return !!(n && n.execCommand);
}

/* One upload part: a multipart POST made by the app. → {status, body}; status 0 when the app did not answer. */
export function sendChunk(url, token, index, data) {
  return new Promise((resolve) => {
    const req = reqId();
    const timer = setTimeout(() => {
      if (transfers[req]) { delete transfers[req]; resolve({ status: 0, body: "" }); }
    }, 120000);
    transfers[req] = { done: (r) => { clearTimeout(timer); resolve(r); } };
    send("worksuite:transfer", { op: "chunk", req, url, token, index, data });
  });
}

/* A download into the Downloads folder by the app. onProgress(received, total). → {status, path}; cancel() stops it. */
export function download(url, name, onProgress) {
  const req = reqId();
  let stall;
  const p = new Promise((resolve) => {
    const arm = () => {
      clearTimeout(stall);
      stall = setTimeout(() => { if (transfers[req]) { delete transfers[req]; resolve({ status: 0 }); } }, 60000);
    };
    arm();
    transfers[req] = {
      progress: (r) => { arm(); onProgress && onProgress(r.received || 0, r.total || 0); },
      done: (r) => { clearTimeout(stall); resolve(r); },
    };
    send("worksuite:transfer", { op: "download", req, url, name });
  });
  return { done: p, cancel: () => send("worksuite:transfer", { op: "cancel", req }) };
}

export function reveal(path) {
  send("worksuite:transfer", { op: "reveal", path });
}

function onTransfer(param) {
  let r = null;
  try { r = JSON.parse(param); } catch { return; }
  const t = r && transfers[r.req];
  if (!t) return;
  if (r.done || r.status !== undefined && r.received === undefined) {
    delete transfers[r.req];
    t.done(r);
  } else if (t.progress) t.progress(r);
}

/* ---- offline editing (DOC-07) ---------------------------------------- */

const [online, setOnline] = createSignal(typeof navigator === "undefined" ? true : navigator.onLine !== false);
const [offlineChoice, setOfflineChoice] = createSignal(null);
export { online, offlineChoice };

const uploads = {};
function upload(url, token, path, fields) {
  return new Promise((resolve) => {
    const req = Math.random().toString(36).slice(2);
    uploads[req] = resolve;
    setTimeout(() => {
      if (uploads[req]) {
        delete uploads[req];
        resolve({ status: 0 });
      }
    }, 120000);
    send("worksuite:upload", { req, url, token, path, fields });
  });
}

function parseBody(r) {
  try {
    return JSON.parse(r.body || "null");
  } catch {
    return null;
  }
}

function accountFor(edit) {
  const WS = window.WorkSuite;
  if (!WS) return null;
  return WS.accounts().find((a) => a.server === edit.server && (!edit.uid || String(a.user.id) === String(edit.uid)) && !a.signedOut) || null;
}

/* Back online with an offline working copy: save it as a new version on top of the version it
   started from (base_version), or, when someone saved meanwhile, let the person choose */
async function reconcile(edit) {
  const WS = window.WorkSuite;
  const account = accountFor(edit);
  if (!WS || !account || !edit.file || !edit.file.id) return;
  let detail = null;
  try {
    detail = await WS.details(account, edit.file.id);
  } catch {
    return;
  }
  const serverVersion = detail && (detail.version ?? (detail.file && detail.file.version));
  const action = reconcileOffline(edit.baseVersion, serverVersion, edit.changed !== false);
  if (action === "discard-local") return;
  if (action === "upload") {
    const r = await saveVersion(account, edit, false);
    if (r.status === 409) return offerChoice(edit, account, detail, parseBody(r));
    return;
  }
  offerChoice(edit, account, detail, null);
}

async function saveVersion(account, edit, keepBoth) {
  const token = await window.WorkSuite.token(account);
  const fields = { base_version: String(edit.baseVersion ?? ""), note: "Offline changes" };
  if (keepBoth) {
    fields.keep_both = "1";
    fields.name = offlineCopyName(edit.file.name);
  }
  return upload(account.server + "/api/files/" + encodeURIComponent(edit.file.id) + "/versions", token, edit.path, fields);
}

function offerChoice(edit, account, detail, conflict) {
  const f = (detail && (detail.file || detail)) || {};
  setOfflineChoice({
    edit,
    account,
    serverVersion: (conflict && conflict.server_version) ?? f.version,
    savedBy: f.updated_by_name || f.modified_by || f.owner_name || "",
    savedAt: f.updated_at || "",
    copyName: offlineCopyName(edit.file.name),
  });
}

export async function openNewerVersion() {
  const c = offlineChoice();
  if (!c) return;
  setOfflineChoice(null);
  window.WorkSuite.open(c.account, c.edit.file).catch(() => {});
}

export async function keepBoth() {
  const c = offlineChoice();
  if (!c) return { ok: false };
  const r = await saveVersion(c.account, c.edit, true);
  const ok = r.status >= 200 && r.status < 300;
  if (ok) setOfflineChoice(null);
  return { ok };
}

/* ---- wiring ---------------------------------------------------------- */

let started = false;
export function initWorkSuiteShell() {
  if (started) return;
  started = true;
  window.addEventListener("online", () => setOnline(true));
  window.addEventListener("offline", () => setOnline(false));

  const n = native();
  if (n && n.on) {
    n.on("on_native_message", (cmd, param) => {
      if (cmd === "worksuite:policy") {
        let r = null;
        try { r = JSON.parse(param); } catch { return; }
        applyPolicy(r && r.policy);
      } else if (cmd === "worksuite:updates") {
        try { setUpdates({ ...updates(), ...JSON.parse(param) }); } catch {}
      } else if (cmd === "worksuite:update-ready") {
        try { setUpdateReady(JSON.parse(param)); } catch {}
      } else if (cmd === "worksuite:upload") {
        let r = null;
        try { r = JSON.parse(param); } catch { return; }
        const done = r && uploads[r.req];
        if (done) {
          delete uploads[r.req];
          done(r);
        }
      } else if (cmd === "worksuite:transfer") {
        onTransfer(param);
      } else if (cmd === "worksuite:offline") {
        let e = null;
        try { e = JSON.parse(param); } catch { return; }
        if (e && e.state === "online") reconcile(e);
      }
    });
  }
  send("worksuite:policy", "");
  send("worksuite:updates", { op: "get" });
}

/* for tests and the dev server */
export const _test = { applyPolicy, setUpdateReady, setOfflineChoice };
