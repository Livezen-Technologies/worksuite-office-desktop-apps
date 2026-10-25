/*
 * Pure helpers of the home screen (no DOM, no Solid): file type of an extension, filtering and sorting of the
 * WorkSuite Drive and recent-file lists, the Drive account panel's state and its Reconnect state machine,
 * the organisation picker's search, popover placement with viewport collision, paging and multi-select.
 */

const TYPES = {
  word: ["doc", "docm", "docx", "docxf", "dot", "dotm", "dotx", "epub", "fb2", "fodt", "htm", "html", "md", "mht", "odt", "ott", "rtf", "txt", "xml", "djvu", "oform"],
  cell: ["csv", "fods", "ods", "ots", "xls", "xlsb", "xlsm", "xlsx", "xlt", "xltm", "xltx"],
  slide: ["dps", "dpt", "fodp", "odp", "otp", "pot", "potm", "potx", "pps", "ppsm", "ppsx", "ppt", "pptm", "pptx"],
  pdf: ["pdf", "xps", "oxps"],
};

/* "docx" / ".DOCX" → "word" | "cell" | "slide" | "pdf" | "other" */
export function typeOfExt(ext) {
  const e = String(ext || "").replace(/^\./, "").toLowerCase();
  for (const t of Object.keys(TYPES)) if (TYPES[t].includes(e)) return t;
  return "other";
}

/* "2026-10-20 10:00", ISO, epoch seconds or ms → ms; unknown → 0 */
export function whenMs(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  const s = String(value).trim();
  if (/^\d+$/.test(s)) return whenMs(Number(s));
  const t = Date.parse(s.replace(" ", "T"));
  if (!isNaN(t)) return t;
  /* the native recents' "dd.mm.yyyy hh:mm" */
  const m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(s);
  return m ? new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)).getTime() : 0;
}

/*
 * Drive items ({kind, name, ext, owner, modified}) or recents ({name, ext, date, islocal}) by text, type and
 * source. Folders stay under a type filter (they lead to files of that type) but not under a text query
 * that they do not match.
 */
export function filterFiles(items, opts) {
  opts = opts || {};
  const q = String(opts.query || "").trim().toLowerCase();
  const type = opts.type || "all";
  const source = opts.source || "all";
  return (items || []).filter((i) => {
    if (q && !String(i.fullName || i.name || "").toLowerCase().includes(q)) return false;
    if (source === "local" && i.islocal === false) return false;
    if (source === "cloud" && i.islocal !== false) return false;
    if (type === "all" || i.kind === "folder") return true;
    return typeOfExt(i.ext) === type;
  });
}

const SORT_VALUE = {
  name: (i) => String(i.name || "").toLowerCase(),
  modified: (i) => whenMs(i.modified !== undefined ? i.modified : i.date),
  opened: (i) => whenMs(i.date !== undefined ? i.date : i.modified),
  owner: (i) => String(i.owner || "").toLowerCase(),
  type: (i) => typeOfExt(i.ext) + ":" + String(i.ext || "").toLowerCase(),
};

/* Folders first, then by key; ties keep the server's order. sort: {key, dir: "asc" | "desc"} */
export function sortFiles(items, sort) {
  const key = (sort && SORT_VALUE[sort.key] && sort.key) || "modified";
  const dir = sort && sort.dir === "asc" ? 1 : -1;
  const value = SORT_VALUE[key];
  return (items || [])
    .map((item, index) => ({ item, index, v: value(item) }))
    .sort((a, b) => {
      const fa = a.item.kind === "folder" ? 0 : 1, fb = b.item.kind === "folder" ? 0 : 1;
      if (fa !== fb) return fa - fb;
      if (a.v < b.v) return -dir;
      if (a.v > b.v) return dir;
      return a.index - b.index;
    })
    .map((x) => x.item);
}

/* the sort a column header click gives: same key flips, a new key starts with its natural direction */
export function nextSort(current, key) {
  if (current && current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: key === "name" || key === "owner" || key === "type" ? "asc" : "desc" };
}

/*
 * The Drive account panel: "connected" (a live default account), "expired" (the default account's session
 * ended by itself: refresh refused), "signed-out" (signed out by the person; the account is kept), "none".
 * An expired or signed-out account is never "connected", whatever else is known.
 */
export function accountPanelState(account) {
  if (!account) return "none";
  if (account.desktopOnly) return "none";
  if (!account.signedOut) return "connected";
  return account.signedOutBy === "user" ? "signed-out" : "expired";
}

/*
 * Reconnect, as a state machine, so a second click (or a second window) cannot start a second sign-in:
 *   idle --start--> refreshing --ok--> idle (done)
 *                              --signin--> signing-in --signedin--> idle (done) | --cancel--> idle
 *                              --unreachable--> error --start--> refreshing
 * Events that do not apply leave the state as it is.
 */
export function reconnectStep(state, event) {
  const s = state || { phase: "idle" };
  const e = event || {};
  switch (e.type) {
    case "start":
      return s.phase === "idle" || s.phase === "error" ? { phase: "refreshing", id: e.id } : s;
    case "ok":
      return s.phase === "refreshing" ? { phase: "idle", done: true, id: s.id } : s;
    case "signin":
      return s.phase === "refreshing" ? { phase: "signing-in", id: s.id } : s;
    case "unreachable":
      return s.phase === "refreshing" ? { phase: "error", id: s.id, message: e.message || "" } : s;
    case "signedin":
      return s.phase === "signing-in" || s.phase === "refreshing" ? { phase: "idle", done: true, id: s.id } : s;
    case "cancel":
      return s.phase === "signing-in" ? { phase: "idle", id: s.id } : s;
    default:
      return s;
  }
}

export const reconnectBusy = (state) => !!state && (state.phase === "refreshing" || state.phase === "signing-in");

/* Only the organisations the account is authorised for (the server's list), searched by name */
export function filterCompanies(list, query) {
  const q = String(query || "").trim().toLowerCase();
  const all = (list || []).filter((c) => c && c.id !== undefined && c.id !== null);
  return q ? all.filter((c) => String(c.name || "").toLowerCase().includes(q)) : all;
}

/*
 * Where a popover goes: below its anchor (or above, when below does not fit and above has more room),
 * aligned to the anchor's start edge, kept inside the viewport with a margin.
 * anchor {top, left, bottom, right, width}, size {width, height}, viewport {width, height}
 */
export function placePopover(anchor, size, viewport, opts) {
  const gap = (opts && opts.gap) ?? 4;
  const margin = (opts && opts.margin) ?? 8;
  const rtl = !!(opts && opts.rtl);
  const below = viewport.height - anchor.bottom - gap - margin;
  const above = anchor.top - gap - margin;
  const placement = size.height <= below || below >= above ? "bottom" : "top";
  let top = placement === "bottom" ? anchor.bottom + gap : anchor.top - gap - size.height;
  top = Math.max(margin, Math.min(top, viewport.height - margin - size.height));
  let left = rtl ? anchor.right - size.width : anchor.left;
  left = Math.max(margin, Math.min(left, viewport.width - margin - size.width));
  const maxHeight = Math.max(120, placement === "bottom" ? below : above);
  return { top: Math.round(top), left: Math.round(left), placement, maxHeight: Math.round(maxHeight) };
}

/* incremental rendering: how many rows to show after "more" */
export function nextPage(shown, total, size) {
  return Math.min(total, Math.max(shown, 0) + (size || 50));
}

/*
 * Multi-select: plain click selects one, Ctrl/Cmd toggles, Shift selects the range from the anchor.
 * selected: array of ids; order: ids as listed. → {selected, anchor}
 */
export function selectWith(selected, id, mods, order, anchor) {
  mods = mods || {};
  const sel = selected || [];
  if (mods.shift && anchor !== undefined && anchor !== null && order.includes(anchor)) {
    const a = order.indexOf(anchor), b = order.indexOf(id);
    const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
    const base = mods.toggle ? sel.filter((x) => !range.includes(x)) : [];
    return { selected: base.concat(range), anchor };
  }
  if (mods.toggle) return { selected: sel.includes(id) ? sel.filter((x) => x !== id) : sel.concat([id]), anchor: id };
  return { selected: [id], anchor: id };
}

/* Which file actions a Drive item offers: the server's features (has) and the item's access level */
export function driveActions(item, has) {
  const can = (f) => (typeof has === "function" ? has(f) : true);
  if (!item || item.kind !== "file") return item && item.kind === "folder" ? ["open"] : [];
  const edit = item.level !== "view";
  const out = ["open"];
  if (edit && can("files.rename")) out.push("rename");
  if (edit && can("files.move")) out.push("move");
  if (can("files.copy")) out.push("copy");
  if (can("files.versions")) out.push("versions");
  if (can("files.share")) out.push("share");
  if (item.level === "view" && can("files.request_edit")) out.push("request-edit");
  out.push("star", "browser");
  if (edit && can("files.trash")) out.push("trash");
  return out;
}
