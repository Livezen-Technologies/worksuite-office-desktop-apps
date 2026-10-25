/*
 * Pure helpers of Clouds › WorkSuite Drive (no DOM, no Solid): the breadcrumb trail, the cache key that keeps
 * accounts, servers and organisations apart, which actions an item offers (the server's capabilities, the
 * server's features, the view and the connection), the upload queue, column widths, rows refreshed in place,
 * sizes and the browser's state.
 */

/* ------------------------------------------------------------------ views */

export const VIEWS = ["drive", "recent", "shared", "starred", "trash"];

/* The browser's state: what the page shows instead of (or over) the list */
export function browserState(o) {
  o = o || {};
  if (!o.account) return o.connecting ? "connecting" : "not-connected";
  if (o.connecting) return "connecting";
  if (o.expired) return "expired";
  if (o.needsOrg) return "choose-org";
  if (o.error === "denied") return "denied";
  if (!o.online) return o.hasData ? "offline" : "offline-empty";
  if (o.error) return o.hasData ? "stale" : "error";
  if (!o.hasData) return "loading";
  return o.empty ? "empty" : "list";
}

/* ------------------------------------------------------------------ breadcrumbs */

/*
 * The trail above the list: the view's root, then the server's breadcrumb ([{id, name}]) in My Drive.
 * A long trail keeps its first and last `keep` folders with "…" between (its hidden folders in `hidden`).
 * → [{id, name, view, current, ellipsis?, hidden?}]
 */
export function breadcrumbs(view, trail, labels, keep) {
  labels = labels || {};
  keep = keep || 2;
  const root = { id: null, name: labels[view] || view, view };
  const path = view === "drive" ? (trail || []).filter((c) => c && c.id !== undefined && c.id !== null).map((c) => ({ id: c.id, name: String(c.name || ""), view })) : [];
  let all = [root].concat(path);
  if (path.length > keep * 2) {
    const hidden = path.slice(keep - 1, path.length - keep);
    all = [root].concat(path.slice(0, keep - 1), [{ id: "…", name: "…", view, ellipsis: true, hidden }], path.slice(path.length - keep));
  }
  return all.map((c, i) => ({ ...c, current: i === all.length - 1 }));
}

/* ------------------------------------------------------------------ cache */

/*
 * One key per account, server, organisation and place, so nothing listed for one organisation (or one account,
 * or one server) is ever shown for another. org null is "all organisations".
 */
export function driveCacheKey(o) {
  const enc = (v) => encodeURIComponent(v === null || v === undefined || v === "" ? "-" : String(v));
  const place = o.view === "drive" ? "drive:" + enc(o.folder || "root") : o.view === "search" ? "search:" + enc(String(o.q || "").toLowerCase()) : enc(o.view);
  return ["ws:drive", enc(o.server), enc(o.user), "org=" + enc(o.org), place, "p" + (o.page || 1)].join("|");
}

/* the keys of one account (all its organisations), to forget them when it is removed */
export function isKeyOf(key, server, user) {
  return String(key).startsWith(["ws:drive", encodeURIComponent(server), encodeURIComponent(String(user))].join("|") + "|");
}

/* ------------------------------------------------------------------ permissions */

/*
 * What the reader may do with an item, from the server's own answer: `access.capabilities` (DriveRules: open, preview,
 * download, edit, rename, share, move, delete, restore, add_files…), which already counts the organisation's
 * permissions (files.download, files.share…). An item without that answer falls back to its access level.
 */
export function capsOf(item) {
  const a = item && item.access;
  if (a && Array.isArray(a.capabilities)) return a.capabilities;
  const level = (a && a.level) || (item && item.level) || null;
  if (!level) return ["open", "preview", "download"];
  const view = ["open", "preview", "download"];
  if (level === "view" || level === "comment") return view;
  if (level === "edit") return view.concat(["edit", "rename", "add_files"]);
  return view.concat(["edit", "rename", "add_files", "share", "move", "delete", "restore"]);
}

const OFFICE_OPEN = ["docx", "xlsx", "pptx", "pdf", "doc", "xls", "ppt", "odt", "ods", "odp", "rtf", "txt", "csv", "docm", "xlsm", "pptm", "ppsx", "dotx", "xltx", "potx", "md"];

/*
 * The actions of one item. ctx: {has(feature), view, online, folderCaps}.
 * Online-only actions are left out offline; the trash offers only Restore and Delete forever.
 */
export function itemActions(item, ctx) {
  ctx = ctx || {};
  const has = typeof ctx.has === "function" ? ctx.has : () => true;
  if (!item) return [];
  const caps = capsOf(item);
  const can = (c) => caps.includes(c);
  const out = [];
  if (ctx.view === "trash") {
    if (ctx.online !== false && can("restore")) out.push("restore");
    if (ctx.online !== false && can("delete")) out.push("purge");
    return out;
  }
  const folder = item.kind === "folder";
  const office = !folder && OFFICE_OPEN.includes(String(item.ext || "").toLowerCase());
  if (folder || (office && can("open"))) out.push("open");
  if (ctx.online === false) return out.concat(folder ? [] : ["details"]);
  if (!folder && item.ext === "pdf" && can("preview")) out.push("preview");
  if (!folder && can("download")) out.push("download");
  if (can("rename") && has("files.rename")) out.push("rename");
  if (can("move") && has("files.move")) out.push("move");
  if (can("open") && has("files.copy")) out.push("copy");
  if (!folder && can("share") && has("files.share")) out.push("share");
  if (!folder && !can("edit") && has("files.request_edit")) out.push("request-edit");
  out.push("star");
  if (!folder && has("files.versions")) out.push("versions");
  out.push("details");
  if (!folder) out.push("browser");
  if (can("delete") && has("files.trash")) out.push("trash");
  return out;
}

/* Whether a folder (or the place shown) takes new files: upload, new folder, new document, drop */
export function canAddTo(access, view) {
  if (view !== "drive") return false;
  if (!access) return true;
  const caps = Array.isArray(access.capabilities) ? access.capabilities : null;
  return caps ? caps.includes("add_files") : access.level !== "view" && access.level !== "comment";
}

/* The actions every selected item offers (bulk actions) */
export function commonActions(items, ctx) {
  if (!items || !items.length) return [];
  const lists = items.map((i) => itemActions(i, ctx));
  return lists[0].filter((a) => lists.every((l) => l.includes(a)) && ["star", "trash", "move", "download", "restore", "purge"].includes(a));
}

/* Rows dropped on a folder may move there unless one of them is that folder, or one may not be moved */
export function canDropOn(items, target, ctx) {
  if (!target || target.kind !== "folder" || !items || !items.length) return false;
  if (items.some((i) => i.kind === "folder" && String(i.id) === String(target.id))) return false;
  if (!canAddTo(target.access, "drive")) return false;
  return items.every((i) => itemActions(i, ctx).includes("move"));
}

/* ------------------------------------------------------------------ rows */

/* After an action: the changed rows replaced where they are, removed ones dropped, new ones added; nothing else moves */
export function patchRows(items, change) {
  change = change || {};
  const key = (i) => i.kind + ":" + i.id;
  const removed = new Set((change.removed || []).map(key));
  const updated = new Map((change.updated || []).map((i) => [key(i), i]));
  const rows = (items || []).filter((i) => !removed.has(key(i))).map((i) => (updated.has(key(i)) ? { ...i, ...updated.get(key(i)) } : i));
  const have = new Set(rows.map(key));
  return rows.concat((change.added || []).filter((i) => !have.has(key(i))));
}

/* "Shared" / "Private" / "Shared with you" for the sharing column */
export function sharingOf(item, me) {
  if (!item) return "";
  const a = item.access || {};
  if (a.owner === false || (item.ownerId !== undefined && me !== undefined && String(item.ownerId) !== String(me))) return "with-me";
  return item.shared ? "shared" : "private";
}

export function formatBytes(n) {
  n = Number(n);
  if (!isFinite(n) || n < 0) return "";
  if (n < 1024) return n + " B";
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024, u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10) + " " + units[u];
}

/* ------------------------------------------------------------------ columns */

export const COLUMNS = [
  { key: "name", min: 180, width: 360 },
  { key: "type", min: 64, width: 110 },
  { key: "location", min: 80, width: 170 },
  { key: "owner", min: 80, width: 150 },
  { key: "size", min: 60, width: 90 },
  { key: "modified", min: 90, width: 130 },
  { key: "sharing", min: 72, width: 130 },
];

/* A column dragged by dx pixels, within its minimum and 900px */
export function resizeColumn(widths, key, dx) {
  const col = COLUMNS.find((c) => c.key === key);
  if (!col) return widths;
  const now = (widths && widths[key]) || col.width;
  return { ...widths, [key]: Math.round(Math.max(col.min, Math.min(900, now + dx))) };
}

/* widths kept for the session: only known columns, only numbers in range */
export function readWidths(raw) {
  let v = raw;
  if (typeof raw === "string") { try { v = JSON.parse(raw); } catch { v = null; } }
  const out = {};
  COLUMNS.forEach((c) => {
    const w = v && Number(v[c.key]);
    out[c.key] = isFinite(w) && w >= c.min && w <= 900 ? Math.round(w) : c.width;
  });
  return out;
}

/* ------------------------------------------------------------------ uploads */

export const CHUNK = 1024 * 1024;
export const UPLOADS_AT_ONCE = 2;

/*
 * The upload queue as a reducer. Each item {id, name, size, folder, state: queued | sending | finishing | done |
 * failed | cancelled, sent, error}. Events: add {files: [{id, name, size, folder}]}, start {id}, progress {id, sent},
 * finishing {id}, done {id, file}, fail {id, error}, cancel {id}, retry {id}, clear (drops the finished).
 */
export function uploadStep(queue, e) {
  const q = queue || [];
  const set = (id, patch) => q.map((u) => (u.id === id ? { ...u, ...patch } : u));
  const at = (id) => q.find((u) => u.id === id);
  switch (e && e.type) {
    case "add":
      return q.concat((e.files || []).filter((f) => !at(f.id)).map((f) => ({ id: f.id, name: f.name, size: f.size || 0, folder: f.folder ?? null, state: "queued", sent: 0, error: "" })));
    case "start":
      return at(e.id) && at(e.id).state === "queued" ? set(e.id, { state: "sending" }) : q;
    case "progress": {
      const u = at(e.id);
      return u && u.state === "sending" ? set(e.id, { sent: Math.max(u.sent, Math.min(u.size, e.sent)) }) : q;
    }
    case "finishing":
      return at(e.id) && at(e.id).state === "sending" ? set(e.id, { state: "finishing", sent: at(e.id).size }) : q;
    case "done":
      return at(e.id) && !["cancelled", "failed"].includes(at(e.id).state) ? set(e.id, { state: "done", sent: at(e.id).size, file: e.file || null }) : q;
    case "fail":
      return at(e.id) && at(e.id).state !== "cancelled" ? set(e.id, { state: "failed", error: e.error || "" }) : q;
    case "cancel":
      return at(e.id) && !["done"].includes(at(e.id).state) ? set(e.id, { state: "cancelled" }) : q;
    case "retry":
      return at(e.id) && ["failed", "cancelled"].includes(at(e.id).state) ? set(e.id, { state: "queued", sent: 0, error: "" }) : q;
    case "clear":
      return q.filter((u) => !["done", "cancelled"].includes(u.state));
    default:
      return q;
  }
}

/* Which queued uploads to start now, keeping at most `limit` running */
export function nextUploads(queue, limit) {
  const running = (queue || []).filter((u) => u.state === "sending" || u.state === "finishing").length;
  return (queue || []).filter((u) => u.state === "queued").slice(0, Math.max(0, (limit || UPLOADS_AT_ONCE) - running)).map((u) => u.id);
}

/* {done, total, percent, active, failed} across the queue (finished cancelled ones not counted) */
export function uploadSummary(queue) {
  const live = (queue || []).filter((u) => u.state !== "cancelled");
  const total = live.reduce((s, u) => s + (u.size || 0), 0);
  const sent = live.reduce((s, u) => s + (u.sent || 0), 0);
  return {
    files: live.length,
    done: live.filter((u) => u.state === "done").length,
    failed: live.filter((u) => u.state === "failed").length,
    active: live.filter((u) => ["queued", "sending", "finishing"].includes(u.state)).length,
    percent: total ? Math.min(100, Math.round((sent / total) * 100)) : live.length && live.every((u) => u.state === "done") ? 100 : 0,
  };
}

/* the parts of a file of `size` bytes: [{index, start, end}] */
export function chunksOf(size, chunk) {
  chunk = chunk || CHUNK;
  const n = Math.max(1, Math.ceil(size / chunk));
  return Array.from({ length: n }, (_, i) => ({ index: i, start: i * chunk, end: Math.min(size, (i + 1) * chunk) }));
}
