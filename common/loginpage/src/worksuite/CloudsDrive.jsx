/*
 * Clouds › WorkSuite Drive: the whole Drive once an account is connected, laid out as WorkSuite Desktop's Drive
 * module (a 240px rail of places, a header with the breadcrumb and the toolbar, a table with a sticky header on
 * the ground colour, or a grid). Not connected, it is the connect card (Continue as, another account, the
 * account wizard); connecting, a progress card; expired, the account panel's Reconnect over the cached list.
 *
 * Everything is the server's: each action is offered only when the item's own capabilities (Drive's rules, which
 * count the organisation's permissions) and the server's features allow it (clouds-logic.js itemActions), and
 * lists are cached per account, server and organisation. Opening a document is WorkSuite.open (core.js), the
 * same authenticated hand-off as Home: the editor tab saves into the same Drive file, as a new version.
 */
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { L } from "./lang.js";
import "./core.js";
import { SignInDialog, NewDialog, Frame } from "./dialogs.jsx";
import { MoveDialog, VersionsDialog, ShareDialog } from "./drive.jsx";
import { hostOf, when } from "./cards.jsx";
import { AccountPanel, ConnectCard } from "./connect.jsx";
import { mergeAccounts } from "./settings-logic.js";
import { accountPanelState, filterFiles, nextPage, nextSort, reconnectBusy, reconnectStep, selectWith, sortFiles, typeOfExt } from "./home-logic.js";
import {
  COLUMNS, CHUNK, UPLOADS_AT_ONCE, breadcrumbs, browserState, canAddTo, canDropOn, commonActions, formatBytes, itemActions, nextUploads,
  patchRows, readWidths, resizeColumn, sharingOf, uploadStep, uploadSummary,
} from "./clouds-logic.js";
import {
  Checkbox, ConfirmDialog, ConnectionWarning, EmptyState, Icon, IconButton, InfoBanner, LayoutToggle, Menu, SearchBox, SkeletonRows,
  Spinner, SyncButton, WsButton,
} from "./ui/components.jsx";
import { online, sendChunk, download as nativeDownload, reveal, canTransfer } from "./shell.js";
import { PlatformNotices } from "./notices.jsx";
import "./worksuite.css";
import "./home.css";
import "./clouds-drive.css";

const WS = () => window.WorkSuite;
const PAGE = 100;
const PICTURE_ROUNDS = 8;
const LS_SESSION = "ws:clouds:session";
const LS_COLS = "ws:clouds:cols";

const FORMAT_ICONS = ["csv", "djvu", "doc", "docm", "docx", "docxf", "dotm", "dotx", "epub", "fb2", "fodp", "fods", "fodt", "html", "md",
  "odp", "ods", "odt", "otp", "ots", "ott", "pdf", "potm", "potx", "pps", "ppsm", "ppsx", "ppt", "pptm", "pptx", "rtf", "txt", "xls",
  "xlsb", "xlsm", "xlsx", "xltm", "xltx"];

const ss = {
  get(key, fallback) { try { const v = sessionStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
  set(key, v) { try { sessionStorage.setItem(key, JSON.stringify(v)); } catch { /* private window */ } },
};

/* No exception text, no addresses with tokens: the server's own sentence, or a friendly one */
function friendly(e) {
  const m = e && typeof e.message === "string" ? e.message : "";
  if (!m || (e.status || 0) >= 500 || /exception|sqlstate|stack|trace|\bat\s+\S+\(|#\d+\s|\/var\/|\.php|bearer|token/i.test(m) || m.length > 240) return L.wsdServerError;
  return m;
}

function FileIcon(props) {
  const icon = () => (props.item.kind === "folder" ? "folder-small" : FORMAT_ICONS.includes(props.item.ext) ? props.item.ext : "neutral");
  const [broken, setBroken] = createSignal(false);
  const thumb = () => props.item.kind === "file" && !broken() && props.thumb;
  return (
    <span class="wsd-fileicon" classList={{ "has-thumb": !!thumb() }}>
      <Show when={props.item.kind === "folder"} fallback={<svg class="icon"><use href={`#${icon()}`} /></svg>}>
        <Icon name="folder" class="wsd-foldericon" />
      </Show>
      <Show when={thumb()}>
        <img class="wsd-thumb" src={thumb()} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setBroken(true)} />
      </Show>
    </span>
  );
}

const TYPE_LABEL = () => ({ word: L.wsdTypeDocument, cell: L.wsdTypeSpreadsheet, slide: L.wsdTypePresentation, pdf: "PDF" });
const typeName = (item) => (item.kind === "folder" ? L.wsdTypeFolder : TYPE_LABEL()[typeOfExt(item.ext)] || String(item.ext || "").toUpperCase() || L.wsdTypeFile);
const SHARING = () => ({ shared: L.wsdShared, private: L.wsdPrivate, "with-me": L.wsdSharedWithYou });

export default function CloudsDrive() {
  /* ---- account and connection ---- */
  const [account, setAccount] = createSignal(null);
  const [accounts, setAccounts] = createSignal([]);
  const [companies, setCompanies] = createSignal([]);
  const [desktopList, setDesktopList] = createSignal([]);
  const [os, setOs] = createSignal(null);
  const [osBusy, setOsBusy] = createSignal(false);
  const [connectError, setConnectError] = createSignal("");
  const [picked, setPicked] = createSignal(null);
  const [phase, setPhase] = createSignal(null); // connecting: "signin" | "validate" | "orgs" | "load"
  const [rc, setRc] = createSignal({ phase: "idle" });
  const [disconnecting, setDisconnecting] = createSignal(false);

  /* ---- place, list, view options (kept for the session) ---- */
  const saved = ss.get(LS_SESSION, {});
  const [view, setView] = createSignal(saved.view || "drive");
  const [folder, setFolder] = createSignal(saved.folder || null);
  const [query, setQuery] = createSignal("");
  const [layout, setLayout] = createSignal(saved.layout === "grid" ? "grid" : "list");
  const [density, setDensity] = createSignal(saved.density === "compact" ? "compact" : "comfortable");
  const [sort, setSort] = createSignal(saved.sort || { key: "name", dir: "asc" });
  const [widths, setWidths] = createSignal(readWidths(ss.get(LS_COLS, null)));
  const [data, setData] = createSignal(null);
  const [loading, setLoading] = createSignal(false);
  const [loadError, setLoadError] = createSignal(null); // {kind: "denied" | "error", message}
  const [shownCount, setShownCount] = createSignal(PAGE);
  const [thumbs, setThumbs] = createSignal({});
  const [selected, setSelected] = createSignal([]);
  const [renaming, setRenaming] = createSignal(null);
  const [dialog, setDialog] = createSignal(null);
  const [menu, setMenu] = createSignal(null); // {point|anchor, items, item}
  const [details, setDetails] = createSignal(null); // the item in the drawer
  const [note, setNote] = createSignal(null); // {text, error, undo}
  const [dropTarget, setDropTarget] = createSignal(null); // "here" or a folder id
  const [uploads, setUploads] = createSignal([]);
  const [downloads, setDownloads] = createSignal([]);

  let seq = 0, anchor = null, lastOpen = 0, osTried = false, sentinel, scroller;
  const blobs = new Map();
  const cancelled = new Set();

  createEffect(() => ss.set(LS_SESSION, { view: view() === "search" ? "drive" : view(), folder: folder(), layout: layout(), density: density(), sort: sort() }));
  createEffect(() => ss.set(LS_COLS, widths()));

  const live = () => account() && !account().signedOut;
  const panel = () => accountPanelState(account());
  const rc$ = (event) => setRc(reconnectStep(rc(), event));
  const has = (f) => WS().has(account(), f);
  const actx = () => ({ has, view: view(), online: online() && !!live() });
  const say = (text, error, undo) => setNote(text ? { text, error: !!error, undo: undo || null } : null);
  const failed = (e) => !e.signedOut && say(friendly(e), true);
  const place = () => (query() ? "search" : view());
  const known = createMemo(() => mergeAccounts(accounts(), desktopList()));
  const panelAccount = () => known().find((a) => account() && a.id === account().id) || account();
  const needsOrg = () => {
    const a = live() && WS().accounts().find((x) => x.id === account().id);
    return !!a && companies().length > 1 && !("org" in a);
  };

  const visible = createMemo(() => {
    const items = (data() && data().items) || [];
    const org = account() ? WS().companyOf(account()) : null;
    const listed = items.filter((i) => WS().inCompany(org, i));
    const sorted = place() === "recent" ? listed : sortFiles(filterFiles(listed, {}), sort());
    return sorted;
  });
  const shown = () => visible().slice(0, shownCount());
  const selectedItems = () => visible().filter((i) => selected().includes(key(i)));
  const key = (i) => i.kind + ":" + i.id;
  const isSelected = (i) => selected().includes(key(i));
  const canAdd = () => live() && online() && place() === "drive" && canAddTo(data() && data().access, "drive") && !loadError() && !(data() && data().access && data().access.locked);

  const state = () => browserState({
    account: account() && !account().desktopOnly ? account() : null,
    connecting: !!phase() && phase() !== "load",
    expired: panel() === "expired" && !data(),
    needsOrg: needsOrg(),
    error: loadError() ? (loadError().kind === "denied" ? "denied" : "error") : null,
    online: online(),
    hasData: !!data(),
    empty: !visible().length,
  });
  const showAccount = () => panel() === "connected" || panel() === "expired";

  /* ---- connecting ---- */
  function refresh() {
    setAccounts(WS().accounts());
    const a = WS().active();
    setAccount(a);
    setCompanies((a && a.companies) || []);
    if (a && !a.signedOut) {
      if (!a.companies) {
        setPhase((p) => p || (data() ? null : "orgs"));
        WS().companies(a).then((list) => { setCompanies(list); afterOrgs(); }, () => afterOrgs());
      } else afterOrgs();
    } else {
      findDesktop();
      if (a && a.signedOut) load(); // the cached list stays visible
    }
  }

  function afterOrgs() {
    if (needsOrg()) return setPhase(null);
    if (phase() && phase() !== "load") setPhase("load");
    load();
  }

  function findDesktop() {
    WS().desktopAccounts().then((list) => setDesktopList(list || []), () => {});
    WS().osBroker().then((o) => {
      setOs(o);
      if (o.available && o.account && o.account.state === "signed_in" && !osTried) {
        osTried = true;
        signInOs();
      }
    }, () => {});
  }

  async function signInOs() {
    setOsBusy(true);
    setConnectError("");
    setPhase("signin");
    try {
      await WS().signInWithBroker();
    } catch (e) {
      setConnectError(friendly(e));
      setPhase(null);
    } finally {
      setOsBusy(false);
    }
  }

  function signIn(desktopAccount, other, server) {
    if (dialog() || osBusy()) return;
    setConnectError("");
    if (!desktopAccount && !other && !server && os() && os().available) return signInOs();
    setPhase("signin");
    setDialog({ kind: "signin", desktopAccount: desktopAccount || null, server: server || null });
  }

  const connectAccount = () => {
    const o = os();
    if (o && o.available) {
      const b = o.account;
      return { id: "os", os: true, server: b ? b.server : "", user: { name: (b && b.state === "signed_in" && b.name) || (b ? hostOf(b.server) : L.wsOsSignIn) } };
    }
    const list = known();
    return list.find((a) => a.id === picked()) || list.find((a) => a.desktopOnly || a.desktop) || (account() && list.find((a) => a.id === account().id)) || list[0] || null;
  };
  function chooseInCard(a) {
    if (!a.desktopOnly && !a.signedOut) {
      setPicked(null);
      WS().setActive(a.id);
    } else setPicked(a.id);
  }
  function continueAs() {
    const a = connectAccount();
    if (!a) return signIn();
    if (a.os) return signInOs();
    if (a.signedOut && !a.desktop) return signIn(null, true, a.server);
    signIn(a.desktop || null);
  }
  function chooseAccount(a) {
    if (a.desktopOnly) return signIn(a.desktop);
    setPicked(null);
    resetPlace();
    WS().setActive(a.id);
  }

  async function reconnect() {
    const a = panelAccount();
    if (!a || reconnectBusy(rc()) || dialog()) return;
    rc$({ type: "start", id: a.id });
    const r = await WS().reconnect(a).catch(() => ({ signIn: true }));
    if (r.ok) {
      rc$({ type: "ok" });
      return refresh();
    }
    if (r.unreachable) return rc$({ type: "unreachable", message: L.wsxUnreachableMsg.replace("$1", hostOf(a.server)) });
    rc$({ type: "signin" });
    setDialog({ kind: "signin", desktopAccount: a.desktop || null, server: a.desktop ? null : a.server, reconnect: true });
  }

  function closeDialog() {
    const d = dialog();
    if (d && d.kind === "signin") {
      if (d.reconnect) rc$({ type: "cancel" });
      else if (!live()) setPhase(null);
    }
    setDialog(null);
  }

  async function disconnect() {
    setDisconnecting(true);
    try {
      await WS().signOutOnly(account());
      setDialog(null);
      setData(null);
    } catch (e) {
      failed(e);
    } finally {
      setDisconnecting(false);
    }
  }

  function chooseOrg(id) {
    resetPlace();
    WS().setCompany(account(), id);
  }

  function resetPlace() {
    setFolder(null);
    setSelected([]);
    setDetails(null);
    setData(null);
    if (view() === "search") setView("drive");
    setQuery("");
  }

  /* ---- loading ---- */
  async function load(opts) {
    opts = opts || {};
    const acc = account();
    if (!acc || acc.desktopOnly) return;
    const where = place();
    const args = { folder: where === "drive" ? folder() : null, q: query(), all: true, page: opts.page || 1 };
    const mine = ++seq;
    setLoadError(null);
    if (!opts.page) {
      setShownCount(PAGE);
      const cached = WS().cached(acc, where, args);
      setThumbs(WS().cachedThumbs(acc) || {});
      setData(cached);
    }
    if (acc.signedOut || !online()) return;
    setLoading(true);
    try {
      const fresh = await WS().list(acc, where, args);
      if (mine !== seq) return;
      if (opts.page && data()) setData({ ...fresh, items: patchRows(data().items, { added: fresh.items }) });
      else setData(fresh);
      setSelected((s) => s.filter((k) => fresh.items.some((i) => key(i) === k) || (opts.page && data().items.some((i) => key(i) === k))));
      if (phase() === "load") setPhase(null);
      pictures(acc, mine);
    } catch (e) {
      if (mine !== seq) return;
      if (phase() === "load") setPhase(null);
      if (e.signedOut) return;
      const denied = e.status === 403 || (e.status === 404 && where === "drive" && !!folder());
      setLoadError({ kind: denied ? "denied" : "error", message: friendly(e) });
    } finally {
      if (mine === seq) setLoading(false);
    }
  }

  const asked = new Set();
  async function pictures(acc, mine) {
    let ids = shown().filter((i) => i.kind === "file" && FORMAT_ICONS.includes(i.ext) && !asked.has(acc.id + ":" + i.id)).map((i) => i.id).slice(0, 100);
    ids.forEach((id) => asked.add(acc.id + ":" + id));
    for (let round = 0; ids.length && round < PICTURE_ROUNDS; round++) {
      let answer;
      try { answer = await WS().thumbs(acc, ids, layout() === "grid"); } catch { return; }
      if (mine !== seq) return;
      const next = { ...thumbs() };
      Object.keys(answer.thumbs).forEach((id) => { if (answer.thumbs[id]) next[id] = answer.thumbs[id]; else delete next[id]; });
      setThumbs(next);
      ids = answer.pending.filter((id) => ids.includes(id));
      if (ids.length) await new Promise((ok) => setTimeout(ok, 1500));
    }
  }

  function showMore() {
    if (shownCount() < visible().length) {
      setShownCount(nextPage(shownCount(), visible().length, PAGE));
      if (live()) pictures(account(), seq);
    } else if (data() && data().more && !loading()) load({ page: (data().page || 1) + 1 });
  }
  createEffect(() => {
    if (!sentinel || !(shownCount() < visible().length || (data() && data().more))) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && showMore(), { rootMargin: "400px" });
    io.observe(sentinel);
    onCleanup(() => io.disconnect());
  });

  function go(v, f) {
    setView(v);
    setFolder(v === "drive" ? f || null : null);
    setQuery("");
    setSelected([]);
    setRenaming(null);
    load();
  }

  function search(q) {
    const next = q.length >= 2 ? q : "";
    if (next === query()) return;
    setQuery(next);
    setSelected([]);
    load();
  }

  /* ---- opening ---- */
  async function open(item) {
    if (item.kind === "folder") return go("drive", item.id);
    if (!itemActions(item, actx()).includes("open")) return setDetails(item);
    if (performance.now() - lastOpen < 1000) return;
    lastOpen = performance.now();
    try {
      await WS().open(account(), item);
    } catch (e) {
      failed(e);
    }
  }

  /* ---- actions; each refreshes only its own rows ---- */
  const patch = (change) => data() && setData({ ...data(), items: patchRows(data().items, change) });

  async function commitRename(item, value) {
    setRenaming(null);
    const dot = item.kind === "file" ? item.name.lastIndexOf(".") : -1;
    const ext = dot > 0 ? item.name.substring(dot) : "";
    const base = String(value || "").trim();
    if (!base || base + ext === item.name) return;
    try {
      const after = await WS().rename(account(), item, base + ext);
      patch({ updated: [{ ...item, ...pick(after), name: (after && after.name) || base + ext }] });
      say(L.wsRenamed);
    } catch (e) {
      failed(e);
    }
  }
  const pick = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k, v]) => v !== undefined && v !== "" && k !== "kind" && k !== "id"));

  async function copyOf(item) {
    try {
      const made = await WS().copy(account(), item);
      if (made && made.id && String(made.folder ?? "") === String(folder() ?? "") && place() === "drive") patch({ added: [made] });
      say(L.wsCopied.replace("$1", (made && made.name) || item.name));
    } catch (e) {
      failed(e);
    }
  }

  async function toTrash(list) {
    const acc = account(), done = [];
    for (const item of list) {
      try { await WS().trash(acc, item); done.push(item); } catch (e) { failed(e); break; }
    }
    if (!done.length) return;
    patch({ removed: done });
    setSelected([]);
    say(done.length === 1 ? L.wsMovedToBin.replace("$1", done[0].name) : L.wshMovedManyToBin.replace("$1", done.length), false, {
      label: L.wsUndo,
      run: async () => {
        try {
          for (const item of done) await WS().untrash(acc, item);
          patch({ added: done });
          say("");
        } catch (e) { failed(e); }
      },
    });
  }

  async function restore(list) {
    const done = [];
    for (const item of list) {
      try { await WS().untrash(account(), item); done.push(item); } catch (e) { failed(e); break; }
    }
    if (done.length) {
      patch({ removed: done });
      setSelected([]);
      say(done.length === 1 ? L.wsdRestoredOne.replace("$1", done[0].name) : L.wsdRestoredMany.replace("$1", done.length));
    }
  }

  async function purge(list) {
    setDialog(null);
    const done = [];
    for (const item of list) {
      try { await WS().purge(account(), item); done.push(item); } catch (e) { failed(e); break; }
    }
    if (done.length) {
      patch({ removed: done });
      setSelected([]);
      say(L.wsdPurged.replace("$1", done.length));
    }
  }

  async function star(list, on) {
    for (const item of list) {
      try {
        await WS().star(account(), item, on);
        if (place() === "starred" && !on) patch({ removed: [item] });
        else patch({ updated: [{ ...item, starred: on }] });
      } catch (e) { failed(e); break; }
    }
  }

  async function moveItems(list, target) {
    const done = [];
    for (const item of list) {
      try { await WS().move(account(), item, target); done.push(item); } catch (e) { failed(e); break; }
    }
    if (done.length) {
      if (place() === "drive" && String(target ?? "") !== String(folder() ?? "")) patch({ removed: done });
      setSelected([]);
      say(L.wsMoved);
    }
  }

  async function newFolder(name) {
    try {
      const made = await WS().createFolder(account(), name, folder());
      setDialog(null);
      patch({ added: [made] });
      say(L.wsdFolderMade.replace("$1", made.name || name));
    } catch (e) {
      setDialog({ ...dialog(), error: friendly(e) });
    }
  }

  /* downloads: the server's signed address, saved by the app into Downloads with progress */
  async function downloadItems(list) {
    for (const item of list.filter((i) => i.kind === "file")) {
      const id = "d" + item.id + ":" + Date.now();
      const row = { id, name: item.name, received: 0, total: item.size || 0, state: "starting" };
      setDownloads((d) => d.concat([row]));
      const upd = (p) => setDownloads((d) => d.map((x) => (x.id === id ? { ...x, ...p } : x)));
      try {
        const p = await WS().preview(account(), item);
        if (!p.download) throw Object.assign(new Error(L.wsdNoDownload), { status: 403 });
        const t = nativeDownload(p.download, item.name, (received, total) => upd({ received, total: total || item.size || 0, state: "running" }));
        upd({ state: "running", cancel: t.cancel });
        const r = await t.done;
        if (r.status === 499) upd({ state: "cancelled" });
        else if (r.path) upd({ state: "done", path: r.path, received: row.total || r.received || 0 });
        else upd({ state: "failed", error: r.status === 0 ? L.wsdNoTransfer : L.wsdServerError });
      } catch (e) {
        upd({ state: "failed", error: friendly(e) });
      }
    }
  }

  /* uploads: Drive's resumable uploads, a part at a time through the app; a few at once */
  function addUploads(files, target) {
    if (!files || !files.length) return;
    if (!canTransfer()) return say(L.wsdNoTransfer, true);
    const add = [...files].filter((f) => f && f.size !== undefined).map((f) => {
      const id = "u" + Math.random().toString(36).slice(2);
      blobs.set(id, f);
      return { id, name: f.name, size: f.size, folder: target === undefined ? folder() : target };
    });
    setUploads((q) => uploadStep(q, { type: "add", files: add }));
    pump();
  }

  function pump() {
    for (const id of nextUploads(uploads(), UPLOADS_AT_ONCE)) runUpload(id);
  }

  async function runUpload(id) {
    const u = uploads().find((x) => x.id === id);
    const blob = blobs.get(id);
    if (!u || !blob) return;
    const acc = account();
    setUploads((q) => uploadStep(q, { type: "start", id }));
    try {
      const made = await WS().upload(acc, blob, u.folder, {
        chunk: CHUNK, key: id,
        send: sendChunk,
        cancelled: () => cancelled.has(id),
        onProgress: (sent) => setUploads((q) => uploadStep(q, { type: "progress", id, sent })),
        onFinishing: () => setUploads((q) => uploadStep(q, { type: "finishing", id })),
      });
      setUploads((q) => uploadStep(q, { type: "done", id, file: made }));
      blobs.delete(id);
      if (acc === account() && place() === "drive" && String(u.folder ?? "") === String(folder() ?? "") && made.id) {
        WS().details(acc, made.id).then((f) => patch({ added: [f] }), () => load());
      }
    } catch (e) {
      if (e.cancelled) setUploads((q) => uploadStep(q, { type: "cancel", id }));
      else setUploads((q) => uploadStep(q, { type: "fail", id, error: friendly(e) }));
    }
    pump();
  }

  /* ---- menus ---- */
  const LABEL = () => ({
    open: L.menuFileOpen, preview: L.wsdPreview, download: L.wsdDownload, rename: L.wsRename, move: L.wsMoveToMenu, copy: L.wsMakeCopy,
    share: L.wsShareMenu, "request-edit": L.wsRequestEdit, versions: L.wsVersionHistory, details: L.wsdDetails, browser: L.wsOpenInBrowserItem,
    trash: L.wsMoveToBin, restore: L.wsdRestore, purge: L.wsdDeleteForever,
  });
  const ICON = { open: "external", preview: "eye", download: "download", rename: "edit", move: "move", copy: "copy", share: "share",
    versions: "history", details: "info", trash: "trash", restore: "restore", purge: "trash", star: "star", browser: "external", "request-edit": "edit" };

  function menuFor(item) {
    const multi = selectedItems().length > 1 && isSelected(item);
    const acts = multi ? commonActions(selectedItems(), actx()) : itemActions(item, actx());
    const out = [];
    acts.forEach((a) => {
      if (a === "trash" || a === "purge") out.push({ separator: true });
      if (a === "star") out.push({ id: "star", icon: item.starred ? "star-on" : "star", label: item.starred && !multi ? L.wsUnstar : L.wsStar });
      else out.push({ id: a, icon: ICON[a], label: LABEL()[a], danger: a === "trash" || a === "purge" });
    });
    return out;
  }

  function runAction(a, item) {
    const list = selectedItems().length > 1 && isSelected(item) ? selectedItems() : [item];
    switch (a) {
      case "open": return open(item);
      case "preview": return setDialog({ kind: "preview", file: item });
      case "download": return downloadItems(list);
      case "rename": return setRenaming(key(item));
      case "move": return setDialog({ kind: "move", file: item, list });
      case "copy": return copyOf(item);
      case "share": return setDialog({ kind: "share", file: item });
      case "request-edit": return WS().requestEdit(account(), item).then(() => say(L.wsRequestSent), failed);
      case "versions": return setDialog({ kind: "versions", file: item });
      case "details": return setDetails(item);
      case "browser": return WS().openInBrowser(account(), "/files?file=" + encodeURIComponent(item.id));
      case "star": return star(list, !(list.length === 1 && item.starred));
      case "trash": return toTrash(list);
      case "restore": return restore(list);
      case "purge": return setDialog({ kind: "purge", list });
    }
  }

  function openMenu(e, item) {
    e.preventDefault();
    e.stopPropagation();
    if (!isSelected(item)) setSelected([key(item)]);
    const items = menuFor(item);
    if (!items.length) return;
    setMenu({ point: e.type === "contextmenu" ? { x: e.clientX, y: e.clientY } : null, anchor: e.type === "contextmenu" ? null : e.currentTarget, items, item });
  }

  const newItems = () => [
    { id: "word", icon: "doc", label: L.wsNewDocument },
    { id: "cell", icon: "sheet", label: L.wsNewSpreadsheet },
    { id: "slide", icon: "slides", label: L.wsNewPresentation },
    { separator: true },
    { id: "folder", icon: "folder-plus", label: L.wsdNewFolder, disabled: !canAdd(), reason: canAdd() ? undefined : L.wsdCannotAdd },
  ];
  function onNew(item) {
    if (item.id === "folder") return setDialog({ kind: "folder", name: L.wsdUntitledFolder, error: "" });
    setDialog({ kind: "new", type: item.id });
  }

  /* ---- selection and keys ---- */
  const order = () => shown().map(key);
  function onRowClick(e, item) {
    if (renaming() === key(item)) return;
    const r = selectWith(selected(), key(item), { toggle: e.ctrlKey || e.metaKey, shift: e.shiftKey }, order(), anchor);
    anchor = r.anchor;
    setSelected(r.selected);
    if (details()) setDetails(item);
  }
  function toggleOne(item) {
    const r = selectWith(selected(), key(item), { toggle: true }, order(), anchor);
    anchor = r.anchor;
    setSelected(r.selected);
  }
  function onRowKey(e, item) {
    if (renaming() === key(item)) return;
    const acts = itemActions(item, actx());
    if (e.key === "Enter") { e.preventDefault(); open(item); }
    else if (e.key === " ") { e.preventDefault(); toggleOne(item); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const rows = [...scroller.querySelectorAll("[data-row]")];
      const i = rows.indexOf(e.currentTarget) + (e.key === "ArrowDown" ? 1 : -1);
      rows[i] && rows[i].focus();
    } else if (e.key === "Escape" && selected().length) setSelected([]);
    else if (e.key === "F2" && acts.includes("rename")) setRenaming(key(item));
    else if (e.key === "Delete" && acts.includes("trash")) toTrash(selectedItems().length ? selectedItems() : [item]);
    else if ((e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) {
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      if (!isSelected(item)) setSelected([key(item)]);
      setMenu({ point: { x: r.left + 40, y: r.bottom }, items: menuFor(item), item });
    }
  }

  /* ---- drag and drop: files from the computer upload; rows move onto folders ---- */
  const DRAG = "application/x-ws-drive";
  function dragStart(e, item) {
    if (!isSelected(item)) setSelected([key(item)]);
    e.dataTransfer.setData(DRAG, JSON.stringify(selected()));
    e.dataTransfer.effectAllowed = "move";
  }
  const dragged = (e) => {
    try { return JSON.parse(e.dataTransfer.getData(DRAG) || "[]"); } catch { return []; }
  };
  const isFiles = (e) => [...(e.dataTransfer && e.dataTransfer.types || [])].includes("Files");
  const isRows = (e) => [...(e.dataTransfer && e.dataTransfer.types || [])].includes(DRAG);
  function overFolder(e, f) {
    if (!(isFiles(e) || isRows(e))) return;
    if (isRows(e) && !canDropOn(selectedItems(), f, actx())) return;
    if (isFiles(e) && !canAddTo(f.access, "drive")) return;
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(f.id);
  }
  function dropOnFolder(e, f) {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    if (isFiles(e)) return addUploads(e.dataTransfer.files, f.id);
    const keys = dragged(e);
    const list = visible().filter((i) => keys.includes(key(i)));
    if (canDropOn(list, f, actx())) moveItems(list, f.id);
  }
  function overSpace(e) {
    if (!isFiles(e) || !canAdd()) return;
    e.preventDefault();
    setDropTarget("here");
  }
  function dropOnSpace(e) {
    if (!isFiles(e)) return;
    e.preventDefault();
    setDropTarget(null);
    if (canAdd()) addUploads(e.dataTransfer.files);
  }

  /* ---- columns ---- */
  /* My Drive's folders do not repeat the folder in each row (as Desktop's Explorer); each column shrinks to its minimum before the page would scroll sideways */
  const columns = () => COLUMNS.filter((c) => !(c.key === "location" && place() === "drive"));
  const cols = () => "32px " + columns().map((c) => `minmax(${c.min}px, ${widths()[c.key]}px)`).join(" ") + " 40px";
  function startResize(e, k) {
    e.preventDefault();
    e.stopPropagation();
    let x = e.clientX;
    const move = (ev) => { setWidths(resizeColumn(widths(), k, ev.clientX - x)); x = ev.clientX; };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  function keyResize(e, k) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setWidths(resizeColumn(widths(), k, e.key === "ArrowRight" ? 16 : -16));
  }
  const COL_LABEL = () => ({ name: L.wshName, type: L.wshType, location: place() === "trash" ? L.wsdWasIn : L.colLocation, owner: L.wsOwner, size: L.wsdSize,
                             modified: place() === "trash" ? L.wsdDeleted : L.wsModified, sharing: place() === "trash" ? L.wsdKeptFor : L.wsdSharing });
  const SORTABLE = ["name", "type", "location", "owner", "size", "modified"];

  /* ---- events ---- */
  onMount(() => {
    const changed = () => refresh();
    const signedin = () => {
      rc$({ type: "signedin" });
      resetPlace();
      setPhase("validate");
      const a = WS().active();
      // the sign-in already asked the server what it can do; ask again so a server that changed is known
      Promise.resolve(a ? WS().checkServer(a.server).catch(() => null) : null).then(() => { setPhase("orgs"); refresh(); });
    };
    const error = (e) => { if (!live()) { setConnectError(friendly(e)); setPhase(null); } };
    WS().on("changed", changed);
    WS().on("signedin", signedin);
    WS().on("error", error);
    const back = () => live() && load();
    window.addEventListener("online", back);
    onCleanup(() => {
      WS().off("changed", changed);
      WS().off("signedin", signedin);
      WS().off("error", error);
      window.removeEventListener("online", back);
    });
    refresh();
  });

  let lastOrg;
  createEffect(() => {
    const a = account();
    const org = a ? (a.org ?? null) : null;
    const id = a ? a.id + "@" + org : null;
    if (lastOrg !== undefined && id !== lastOrg) { setSelected([]); setDetails(null); }
    lastOrg = id;
  });

  /* ---- pieces ---- */
  const Name = (p) => {
    const item = p.item;
    const dot = item.kind === "file" ? item.name.lastIndexOf(".") : -1;
    const base = dot > 0 ? item.name.substring(0, dot) : item.name;
    const ext = dot > 0 ? item.name.substring(dot) : "";
    return (
      <Show when={renaming() === key(item)} fallback={<span class="wsd-name wsx-ellipsis">{base}<span class="wsd-ext">{ext}</span></span>}>
        <input class="wsd-rename" value={base} spellcheck={false} aria-label={L.wsRename}
               ref={(el) => setTimeout(() => { el.focus(); el.select(); }, 0)}
               onClick={(e) => e.stopPropagation()} onDblClick={(e) => e.stopPropagation()}
               onKeyDown={(e) => {
                 e.stopPropagation();
                 if (e.key === "Enter") commitRename(item, e.currentTarget.value);
                 if (e.key === "Escape") setRenaming(null);
               }}
               onBlur={(e) => renaming() === key(item) && commitRename(item, e.currentTarget.value)} />
      </Show>
    );
  };

  const rowProps = (item) => ({
    "data-row": "",
    role: "row",
    tabindex: "0",
    "aria-selected": isSelected(item) ? "true" : "false",
    draggable: live() && online() && renaming() !== key(item) && place() !== "trash",
    onDragStart: (e) => dragStart(e, item),
    onDragOver: item.kind === "folder" ? (e) => overFolder(e, item) : undefined,
    onDragLeave: item.kind === "folder" ? () => dropTarget() === item.id && setDropTarget(null) : undefined,
    onDrop: item.kind === "folder" ? (e) => dropOnFolder(e, item) : undefined,
    onClick: (e) => onRowClick(e, item),
    onDblClick: () => renaming() !== key(item) && open(item),
    onKeyDown: (e) => onRowKey(e, item),
    onContextMenu: (e) => openMenu(e, item),
  });

  const Row = (p) => {
    const item = p.item;
    return (
      <div {...rowProps(item)} class="wsd-row" style={{ "grid-template-columns": cols() }}
           classList={{ "is-selected": isSelected(item), "is-drop": dropTarget() === item.id }}>
        <span class="wsd-cell wsd-check" role="gridcell">
          <Checkbox checked={isSelected(item)} tabindex="-1" label={L.wshSelect.replace("$1", item.name)} onChange={() => toggleOne(item)} />
        </span>
        <span class="wsd-cell wsd-col-name" role="gridcell" title={item.name}>
          <FileIcon item={item} thumb={thumbs()[item.id]} />
          <Name item={item} />
          <Show when={item.starred}><Icon name="star-on" class="wsd-star" /></Show>
          <Show when={item.locked}><span class="wsd-chip is-warning"><Icon name="lock" />{L.wsdLocked}</span></Show>
        </span>
        <span class="wsd-cell" role="gridcell"><span class="wsx-ellipsis">{typeName(item)}</span></span>
        <Show when={place() !== "drive"}>
          <span class="wsd-cell" role="gridcell" title={item.location}><span class="wsx-ellipsis">{item.location || (place() === "trash" ? "" : L.wsMyDrive)}</span></span>
        </Show>
        <span class="wsd-cell" role="gridcell"><span class="wsx-ellipsis">{item.owner}</span></span>
        <span class="wsd-cell wsd-mono" role="gridcell">{item.kind === "folder" ? (item.size ? formatBytes(item.size) : "—") : formatBytes(item.size)}</span>
        <span class="wsd-cell" role="gridcell"><span class="wsx-ellipsis">{place() === "trash" && item.deleted ? when(item.deleted) : when(item.modified)}</span></span>
        <span class="wsd-cell" role="gridcell">
          <Show when={place() !== "trash"} fallback={<Show when={item.daysLeft !== undefined}><span class="wsd-chip">{L.wsdDaysLeft.replace("$1", item.daysLeft)}</span></Show>}>
            <span class={"wsd-chip is-" + sharingOf(item, account() && account().user.id)}>{SHARING()[sharingOf(item, account() && account().user.id)]}</span>
          </Show>
        </span>
        <span class="wsd-cell wsd-more" role="gridcell">
          <button type="button" class="wsd-more-btn" aria-label={L.wsxMoreActions.replace("$1", item.name)} aria-haspopup="menu"
                  onClick={(e) => openMenu(e, item)} onDblClick={(e) => e.stopPropagation()}><Icon name="more" /></button>
        </span>
      </div>
    );
  };

  const Card = (p) => {
    const item = p.item;
    return (
      <div {...rowProps(item)} class="wsd-card" classList={{ "is-selected": isSelected(item), "is-folder": item.kind === "folder", "is-drop": dropTarget() === item.id }}>
        <Show when={item.kind === "file"}>
          <div class="wsd-card-thumb"><FileIcon item={item} thumb={thumbs()[item.id]} /></div>
        </Show>
        <div class="wsd-card-text">
          <Show when={item.kind === "folder"}><FileIcon item={item} /></Show>
          <span class="wsd-card-lines">
            <Name item={item} />
            <span class="wsd-hint wsx-ellipsis">{item.kind === "folder" ? (item.count !== undefined ? L.wshFiles.replace("$1", item.count) : typeName(item)) : [formatBytes(item.size), when(item.modified)].filter(Boolean).join(" · ")}</span>
          </span>
          <span class="wsd-card-check"><Checkbox checked={isSelected(item)} tabindex="-1" label={L.wshSelect.replace("$1", item.name)} onChange={() => toggleOne(item)} /></span>
        </div>
      </div>
    );
  };

  const NAV = () => [["drive", "drive", L.wsMyDrive], ["recent", "history", L.wsRecent], ["shared", "users", L.wsShared], ["starred", "star", L.wsStarred], ["trash", "trash", L.wsdTrash]];
  const crumbs = () => breadcrumbs(place() === "search" ? "drive" : place(), place() === "drive" ? (data() && data().breadcrumb) || [] : [],
                                   { drive: L.wsMyDrive, recent: L.wsRecent, shared: L.wsShared, starred: L.wsStarred, trash: L.wsdTrash });
  const title = () => (place() === "search" ? L.wsdResultsFor.replace("$1", query()) : crumbs()[crumbs().length - 1].name);
  const bulk = () => commonActions(selectedItems(), actx());
  const up = () => uploadSummary(uploads());
  const allShownSelected = () => shown().length > 0 && shown().every((i) => isSelected(i));
  const someSelected = () => selected().length > 0 && !allShownSelected();

  const emptyText = () => {
    if (place() === "search") return [L.wshNoMatch.replace("$1", query()), L.wshNoMatchHint];
    return {
      drive: [folder() ? L.wshEmptyFolder : L.wsdEmptyDrive, canAdd() ? L.wsdEmptyDriveHint : ""],
      recent: [L.wshEmptyRecent, L.wshEmptyRecentHint],
      shared: [L.wshEmptyShared, L.wshEmptySharedHint],
      starred: [L.wshEmptyStarred, L.wshEmptyStarredHint],
      trash: [L.wsdEmptyTrash, L.wsdEmptyTrashHint],
    }[place()] || [L.wsEmpty, ""];
  };

  return (
    <section class="wsd" data-wsx-density={density() === "compact" ? "compact" : undefined} aria-labelledby="wsd-title">
      <h2 class="wsx-visually-hidden" id="wsd-title">{L.wsTitle}</h2>
      <PlatformNotices account={account()} />

      {/* ---- not connected / connecting / choose an organisation ---- */}
      <Show when={state() === "not-connected" || (state() === "connecting" && !live())}>
        <div class="wsd-connect">
          <div class="wsd-connect-intro">
            <span class="wsd-connect-mark" aria-hidden="true"><Icon name="drive" /></span>
            <div>
              <h3 class="wsd-h1">{L.wsTitle}</h3>
              <p class="wsd-lede">{L.wsdIntro}</p>
              <ul class="wsd-points">
                <li><Icon name="check" />{L.wsdPointOpen}</li>
                <li><Icon name="check" />{L.wsdPointSave}</li>
                <li><Icon name="check" />{L.wsdPointOrg}</li>
              </ul>
            </div>
          </div>
          <Show when={state() === "connecting"} fallback={
            <ConnectCard known={known()} selected={connectAccount()} connecting={false} error={connectError()}
                         onSelect={chooseInCard} onContinue={continueAs} noOther={!!(os() && os().available)} onOtherAccount={() => signIn(null, true)} />
          }>
            <Progress phase={phase()} onCancel={() => { WS().cancelSignIn && WS().cancelSignIn(); setDialog(null); setPhase(null); }} />
          </Show>
        </div>
      </Show>

      <Show when={live() && phase() && phase() !== "load" && phase() !== "signin"}>
        <div class="wsd-connect is-narrow"><Progress phase={phase()} /></div>
      </Show>

      <Show when={state() === "choose-org" && !phase()}>
        <div class="wsd-connect is-narrow">
          <div class="wsd-orgs" role="radiogroup" aria-labelledby="wsd-org-title">
            <h3 class="wsd-h1" id="wsd-org-title">{L.wsdChooseOrg}</h3>
            <p class="wsd-lede">{L.wsdChooseOrgHint}</p>
            <For each={companies()}>
              {(c) => (
                <button type="button" role="radio" aria-checked="false" class="wsd-org" onClick={() => chooseOrg(c.id)}>
                  <span class="wsd-org-logo" aria-hidden="true">{String(c.name || "?").charAt(0).toUpperCase()}</span>
                  <span class="wsx-ellipsis">{c.name}</span>
                  <Icon name="chevron" class="wsd-org-go" />
                </button>
              )}
            </For>
            <button type="button" role="radio" aria-checked="false" class="wsd-org" onClick={() => chooseOrg(null)}>
              <span class="wsd-org-logo is-all" aria-hidden="true"><Icon name="building" /></span>
              <span>{L.wsAllCompanies}</span>
              <Icon name="chevron" class="wsd-org-go" />
            </button>
          </div>
        </div>
      </Show>

      {/* ---- the Drive ---- */}
      <Show when={showAccount() && !needsOrg() && !(phase() && phase() !== "load")}>
        <div class="wsd-top">
          <AccountPanel state={panel()} account={panelAccount()} known={known()} companies={companies()}
                        companyId={WS().companyOf(account())} onCompany={chooseOrg}
                        onSelect={chooseAccount} onAdd={() => signIn(null, true)}
                        onManage={() => { try { sessionStorage.setItem("ws:settings:section", "accounts"); } catch {} location.hash = "#/settings/worksuite"; }}
                        onDisconnect={() => setDialog({ kind: "disconnect" })}
                        onReconnect={reconnect} reconnecting={reconnectBusy(rc())} error={rc().phase === "error" ? rc().message : ""}
                        noRefresh />
        </div>

        <div class="wsd-body">
          <div class="wsd-rail"><nav class="wsd-rail-inner" aria-label={L.wsTitle}>
            <div class="wsd-rail-new">
              <NewButton disabled={!live() || !online()} items={newItems()} onSelect={onNew} />
            </div>
            <For each={NAV()}>
              {([v, icon, label]) => (
                <button type="button" class="wsd-nav wsx-lead" classList={{ "is-on": view() === v && !query() }} aria-current={view() === v && !query() ? "page" : undefined}
                        onClick={() => go(v)}
                        onDragOver={v === "drive" ? (e) => isRows(e) && canDropOn(selectedItems(), { kind: "folder", id: "root", access: null }, actx()) && (e.preventDefault(), setDropTarget("root")) : undefined}
                        onDragLeave={() => dropTarget() === "root" && setDropTarget(null)}
                        onDrop={v === "drive" ? (e) => { e.preventDefault(); setDropTarget(null); const k = dragged(e); moveItems(visible().filter((i) => k.includes(key(i))), null); } : undefined}>
                  <Icon name={icon} />
                  <span class="wsx-ellipsis">{label}</span>
                  <Show when={v === "drive" && dropTarget() === "root"}><span class="wsd-drop-ring" /></Show>
                </button>
              )}
            </For>
          </nav></div>

          <main class="wsd-main" ref={(el) => (scroller = el)} onDragOver={overSpace} onDragLeave={(e) => e.currentTarget === e.target && setDropTarget(null)} onDrop={dropOnSpace}
                classList={{ "is-drop": dropTarget() === "here" }}>
            <div class="wsd-head">
              <nav class="wsd-crumbs" aria-label={L.wsdBreadcrumb} hidden={place() !== "drive"}>
                <For each={crumbs()}>
                  {(c, i) => (
                    <>
                      <Show when={i() > 0}><span class="wsd-sep" aria-hidden="true">›</span></Show>
                      <Show when={!c.current} fallback={<span class="wsd-crumb-here" aria-current="page">{c.name}</span>}>
                        <Show when={!c.ellipsis} fallback={
                          <button type="button" class="wsd-crumb" title={c.hidden.map((h) => h.name).join(" › ")}
                                  onClick={() => go("drive", c.hidden[c.hidden.length - 1].id)}>…</button>
                        }>
                          <button type="button" class="wsd-crumb" onClick={() => go(c.view, c.id)}
                                  onDragOver={(e) => isRows(e) && c.view === "drive" && (e.preventDefault())}
                                  onDrop={(e) => { e.preventDefault(); const k = dragged(e); const list = visible().filter((x) => k.includes(key(x))); if (list.length) moveItems(list, c.id); }}>{c.name}</button>
                        </Show>
                      </Show>
                    </>
                  )}
                </For>
              </nav>
              <div class="wsd-titlebar">
                <h3 class="wsd-title">{title()}</h3>
                <Show when={data() && data().access && data().access.owner === false}>
                  <span class="wsd-hint">{L.wsdSharedWithYouLevel.replace("$1", LEVEL()[data().access.level] || "")}</span>
                </Show>
                <span class="wsd-spacer" />
                <Show when={place() === "drive" && live()}>
                  <WsButton variant="secondary" icon="folder-plus" disabled={!canAdd()} title={canAdd() ? undefined : L.wsdCannotAdd}
                            onClick={() => setDialog({ kind: "folder", name: L.wsdUntitledFolder, error: "" })}>{L.wsdNewFolder}</WsButton>
                  <UploadButton disabled={!canAdd()} onFiles={(f) => addUploads(f)} />
                </Show>
              </div>
              <div class="wsd-toolbar" role="toolbar" aria-label={L.wsdToolbar}>
                <SearchBox class="wsd-search" placeholder={folder() ? L.wsdSearchHere : L.wsdSearchDrive} value={query()} onSearch={search} />
                <span class="wsd-spacer" />
                <Show when={live()}>
                  <SyncButton iconOnly label={L.wshRefresh} busyLabel={L.wsdRefreshing} doneLabel={L.wsdUpToDate} failedLabel={L.wsdRefreshFailed}
                              onSync={() => load().then(() => { if (loadError()) throw new Error("x"); })} />
                </Show>
                <LayoutToggle value={layout()} onChange={(v) => { setLayout(v); if (live()) pictures(account(), seq); }} />
                <IconButton icon="density" label={density() === "compact" ? L.wsdComfortable : L.wsdCompact} pressed={density() === "compact"}
                            onClick={() => setDensity(density() === "compact" ? "comfortable" : "compact")} />
                <IconButton icon="info" label={L.wsdDetails} pressed={!!details()}
                            onClick={() => setDetails(details() ? null : selectedItems()[0] || { kind: "place" })} />
              </div>
            </div>

            <ConnectionWarning when={!online()} text={data() ? L.wsdOfflineCached : L.wshOfflineNone} />
            <Show when={panel() === "expired"}>
              <div class="wsd-pad"><InfoBanner tone="warning" icon="lock" title={L.wsxSessionExpired} description={L.wsdExpiredCached.replace("$1", hostOf(account().server))} /></div>
            </Show>
            <Show when={state() === "stale"}>
              <div class="wsd-pad"><InfoBanner tone="warning" icon="warning" title={L.wsdShowingCached} description={loadError().message}>
                <WsButton variant="secondary" small onClick={() => load()}>{L.wsxRetry}</WsButton>
              </InfoBanner></div>
            </Show>

            <Show when={selected().length}>
              <div class="wsd-bulk" role="toolbar" aria-label={L.wshSelection}>
                <span class="wsd-bulk-count">{L.wshSelected.replace("$1", selected().length)}</span>
                <Show when={bulk().includes("download")}><WsButton small variant="secondary" icon="download" onClick={() => downloadItems(selectedItems())}>{L.wsdDownload}</WsButton></Show>
                <Show when={bulk().includes("move")}><WsButton small variant="secondary" icon="move" onClick={() => setDialog({ kind: "move", file: selectedItems()[0], list: selectedItems() })}>{L.wsMoveToMenu}</WsButton></Show>
                <Show when={bulk().includes("star")}><WsButton small variant="secondary" icon="star" onClick={() => star(selectedItems(), true)}>{L.wsStar}</WsButton></Show>
                <Show when={bulk().includes("restore")}><WsButton small variant="secondary" icon="restore" onClick={() => restore(selectedItems())}>{L.wsdRestore}</WsButton></Show>
                <Show when={bulk().includes("trash")}><WsButton small variant="danger" icon="trash" onClick={() => toTrash(selectedItems())}>{L.wsMoveToBin}</WsButton></Show>
                <Show when={bulk().includes("purge")}><WsButton small variant="danger" icon="trash" onClick={() => setDialog({ kind: "purge", list: selectedItems() })}>{L.wsdDeleteForever}</WsButton></Show>
                <WsButton small variant="ghost" onClick={() => setSelected([])}>{L.wshClearSelection}</WsButton>
              </div>
            </Show>

            <Show when={state() === "denied"}>
              <EmptyState icon="lock" title={L.wsdDenied} text={L.wsdDeniedHint}
                          action={<WsButton small variant="secondary" onClick={() => go("drive", null)}>{L.wshOpenMyDrive}</WsButton>} />
            </Show>
            <Show when={state() === "error"}>
              <EmptyState icon="warning" title={L.wsdCantLoad} text={loadError().message}
                          action={<WsButton small variant="primary" onClick={() => load()}>{L.wsxRetry}</WsButton>} />
            </Show>
            <Show when={state() === "offline-empty"}>
              <EmptyState icon="cloud" title={L.wsdOfflineTitle} text={L.wshOfflineNone}
                          action={<WsButton small variant="secondary" onClick={() => load()}>{L.wsxRetry}</WsButton>} />
            </Show>
            <Show when={state() === "loading" || state() === "expired" || state() === "connecting"}>
              <div class="wsd-pad"><SkeletonRows count={8} /></div>
            </Show>
            <Show when={state() === "empty"}>
              <EmptyState icon={place() === "trash" ? "trash" : place() === "starred" ? "star" : place() === "shared" ? "users" : "folder"}
                          title={emptyText()[0]} text={emptyText()[1]}
                          action={canAdd() ? <UploadButton onFiles={(f) => addUploads(f)} /> : place() === "search" ? undefined
                                 : place() !== "drive" ? <WsButton small variant="secondary" onClick={() => go("drive")}>{L.wshOpenMyDrive}</WsButton> : undefined} />
            </Show>

            <Show when={["list", "offline", "stale"].includes(state())}>
              <Show when={layout() === "list"} fallback={
                <div class="wsd-grids" role="grid" aria-label={title()} aria-multiselectable="true" aria-busy={loading() ? "true" : "false"}>
                  <Show when={shown().some((i) => i.kind === "folder")}>
                    <div class="wsd-grid is-folders" role="rowgroup">
                      <For each={shown().filter((i) => i.kind === "folder")}>{(item) => <Card item={item} />}</For>
                    </div>
                  </Show>
                  <div class="wsd-grid" role="rowgroup">
                    <For each={shown().filter((i) => i.kind !== "folder")}>{(item) => <Card item={item} />}</For>
                  </div>
                </div>
              }>
                <div class="wsd-table" role="grid" aria-label={title()} aria-multiselectable="true" aria-busy={loading() ? "true" : "false"}
                     aria-rowcount={visible().length + 1}>
                  <div class="wsd-row wsd-row-head" role="row" style={{ "grid-template-columns": cols() }}>
                    <span class="wsd-cell wsd-check" role="columnheader">
                      <Checkbox checked={allShownSelected()} indeterminate={someSelected()} label={L.wshSelectAll}
                                onChange={() => setSelected(allShownSelected() ? [] : shown().map(key))} />
                    </span>
                    <For each={columns()}>
                      {(c) => (
                        <span class="wsd-cell wsd-colhead" role="columnheader"
                              aria-sort={sort().key === c.key ? (sort().dir === "asc" ? "ascending" : "descending") : SORTABLE.includes(c.key) ? "none" : undefined}>
                          <Show when={SORTABLE.includes(c.key) && place() !== "recent"} fallback={<span class="wsx-ellipsis">{COL_LABEL()[c.key]}</span>}>
                            <button type="button" class="wsd-sort" onClick={() => setSort(nextSort(sort(), c.key))}>
                              <span class="wsx-ellipsis">{COL_LABEL()[c.key]}</span>
                              <Show when={sort().key === c.key}><Icon name="chevron" class={"wsd-sortdir " + sort().dir} /></Show>
                            </button>
                          </Show>
                          <span class="wsd-resize" role="separator" aria-orientation="vertical" tabindex="0" aria-valuenow={widths()[c.key]}
                                aria-label={L.wsdResize.replace("$1", COL_LABEL()[c.key])}
                                onPointerDown={(e) => startResize(e, c.key)} onKeyDown={(e) => keyResize(e, c.key)} onDblClick={() => setWidths({ ...widths(), [c.key]: c.width })} />
                        </span>
                      )}
                    </For>
                    <span class="wsd-cell" />
                  </div>
                  <For each={shown()}>{(item) => <Row item={item} />}</For>
                </div>
              </Show>
              <div class="wsd-foot">
                <span class="wsd-hint">{L.wsdItems.replace("$1", data() && data().total !== null && data().total !== undefined ? data().total : visible().length)}</span>
                <Show when={shownCount() < visible().length || (data() && data().more)}>
                  <span ref={(el) => (sentinel = el)} aria-hidden="true" />
                  <WsButton small variant="secondary" busy={loading()} onClick={showMore}>{L.wsdLoadMore}</WsButton>
                </Show>
              </div>
            </Show>

            <Show when={dropTarget() === "here"}>
              <div class="wsd-dropzone" aria-hidden="true"><Icon name="upload" />{L.wsdDropHere.replace("$1", title())}</div>
            </Show>
          </main>

          <Show when={details()}>
            <DetailsDrawer item={details()} account={account()} place={title()} data={data()} online={online() && !!live()}
                           actions={details().kind === "place" ? [] : itemActions(details(), actx())}
                           onAction={(a) => runAction(a, details())} onClose={() => setDetails(null)} />
          </Show>
        </div>
      </Show>

      <Show when={note() && showAccount()}>
        <div class="wsd-toast" classList={{ "is-error": note().error }} role={note().error ? "alert" : "status"}>
          <span>{note().text}</span>
          <Show when={note().undo}><button type="button" class="wsx-link" onClick={() => note().undo.run()}>{note().undo.label}</button></Show>
          <button type="button" class="wsd-toast-x" aria-label={L.wsClose} onClick={() => setNote(null)}><Icon name="x" /></button>
        </div>
      </Show>

      <Transfers uploads={uploads()} downloads={downloads()} summary={up()}
                 onCancel={(id) => { cancelled.add(id); setUploads((q) => uploadStep(q, { type: "cancel", id })); }}
                 onRetry={(id) => { cancelled.delete(id); setUploads((q) => uploadStep(q, { type: "retry", id })); pump(); }}
                 onCancelDownload={(d) => d.cancel && d.cancel()} onReveal={(d) => reveal(d.path)}
                 onClear={() => { setUploads((q) => uploadStep(q, { type: "clear" })); setDownloads((d) => d.filter((x) => x.state === "running" || x.state === "starting")); }} />

      <Menu open={!!menu()} point={menu() && menu().point} anchor={menu() && menu().anchor} items={menu() ? menu().items : []}
            label={menu() ? L.wsxMoreActions.replace("$1", menu().item.name) : ""} onClose={() => setMenu(null)}
            onSelect={(it) => runAction(it.id, menu() ? menu().item : null)} />

      <Show when={dialog() && dialog().kind === "signin"}>
        <SignInDialog desktopAccount={dialog().desktopAccount} server={dialog().server} onClose={closeDialog} />
      </Show>
      <Show when={dialog() && dialog().kind === "disconnect"}>
        <ConfirmDialog title={L.wshDisconnectTitle.replace("$1", account().user.name)} text={L.wshDisconnectText.replace("$1", hostOf(account().server))}
                       confirmLabel={L.wsxDisconnect} danger busy={disconnecting()} onConfirm={disconnect} onClose={() => setDialog(null)} />
      </Show>
      <Show when={dialog() && dialog().kind === "new"}>
        <NewDialog account={account()} type={dialog().type} folder={place() === "drive" && canAdd() ? folder() : null} onClose={() => setDialog(null)}
                   onCreated={(file) => { open(file); if (place() === "drive" && String(file.folder ?? "") === String(folder() ?? "")) patch({ added: [file] }); }} />
      </Show>
      <Show when={dialog() && dialog().kind === "folder"}>
        <Frame title={L.wsdNewFolder} onClose={() => setDialog(null)}>
          <label class="ws-label" for="wsd-folder-name">{L.wsName}</label>
          <input id="wsd-folder-name" type="text" class="ws-input" spellcheck={false} value={dialog().name}
                 ref={(el) => setTimeout(() => { el.focus(); el.select(); }, 0)}
                 onInput={(e) => setDialog({ ...dialog(), name: e.currentTarget.value })}
                 onKeyDown={(e) => e.key === "Enter" && dialog().name.trim() && newFolder(dialog().name.trim())} />
          <Show when={dialog().error}><p class="ws-error" role="alert">{dialog().error}</p></Show>
          <div class="wsx-confirm-actions">
            <WsButton variant="secondary" onClick={() => setDialog(null)}>{L.wsCancel}</WsButton>
            <WsButton variant="primary" disabled={!dialog().name.trim()} onClick={() => newFolder(dialog().name.trim())}>{L.wsCreate}</WsButton>
          </div>
        </Frame>
      </Show>
      <Show when={dialog() && dialog().kind === "move"}>
        <MoveDialog account={account()} file={dialog().list.length > 1 ? { ...dialog().file, name: L.wsdNItems.replace("$1", dialog().list.length) } : dialog().file}
                    start={folder()} onClose={() => setDialog(null)} onDone={() => {}}
                    move={(target) => moveItems(dialog().list, target)} />
      </Show>
      <Show when={dialog() && dialog().kind === "versions"}>
        <VersionsDialog account={account()} file={dialog().file} onClose={() => setDialog(null)} onDone={(t) => say(t)} />
      </Show>
      <Show when={dialog() && dialog().kind === "share"}>
        <ShareDialog account={account()} file={dialog().file} onClose={() => setDialog(null)} />
      </Show>
      <Show when={dialog() && dialog().kind === "purge"}>
        <ConfirmDialog title={L.wsdPurgeTitle.replace("$1", dialog().list.length)} text={L.wsdPurgeText} confirmLabel={L.wsdDeleteForever} danger
                       onConfirm={() => purge(dialog().list)} onClose={() => setDialog(null)} />
      </Show>
      <Show when={dialog() && dialog().kind === "preview"}>
        <PreviewDialog account={account()} file={dialog().file} thumb={thumbs()[dialog().file.id]} onClose={() => setDialog(null)}
                       onOpen={() => { const f = dialog().file; setDialog(null); open(f); }}
                       onDownload={itemActions(dialog().file, actx()).includes("download") ? () => downloadItems([dialog().file]) : null} />
      </Show>
    </section>
  );
}

const LEVEL = () => ({ view: L.wsRoleViewer, comment: L.wsRoleCommenter, edit: L.wsRoleEditor, full: L.wsRoleFull });

/* "Connecting" as steps: sign in, check the server, organisations, the Drive */
function Progress(props) {
  const steps = () => [["signin", L.wsdStepSignIn], ["validate", L.wsdStepValidate], ["orgs", L.wsdStepOrgs], ["load", L.wsdStepLoad]];
  const at = () => Math.max(0, steps().findIndex(([k]) => k === props.phase));
  return (
    <div class="wsd-progress" role="status" aria-live="polite">
      <div class="wsd-progress-head"><Spinner /><span class="wsd-strong">{L.wsxConnecting}</span></div>
      <ol class="wsd-steps">
        <For each={steps()}>
          {([, label], i) => (
            <li classList={{ "is-done": i() < at(), "is-current": i() === at() }}>
              <Show when={i() < at()} fallback={<span class="wsd-step-dot" />}><Icon name="check" /></Show>{label}
            </li>
          )}
        </For>
      </ol>
      <div class="wsx-progress"><div class="wsx-progress-bar" style={{ width: ((at() + 1) / steps().length) * 100 + "%" }} /></div>
      <Show when={props.onCancel && props.phase === "signin"}>
        <p class="wsd-hint">{L.wsxConnectingHint}</p>
      </Show>
    </div>
  );
}

/* Desktop's PrimaryAction: "New" with its menu */
function NewButton(props) {
  const [open, setOpen] = createSignal(false);
  let btn;
  return (
    <>
      <button type="button" ref={(el) => (btn = el)} class="wsx-btn wsx-btn-accent wsd-new" aria-haspopup="menu" aria-expanded={open() ? "true" : "false"}
              disabled={props.disabled} onClick={() => setOpen(!open())}>
        <Icon name="plus" /><span>{L.wsNew}</span><Icon name="chevron" class="wsd-new-caret" />
      </button>
      <Menu open={open()} anchor={btn} items={props.items} label={L.wsNew} onClose={() => setOpen(false)} onSelect={props.onSelect} />
    </>
  );
}

function UploadButton(props) {
  let input;
  return (
    <>
      <WsButton variant="primary" icon="upload" disabled={props.disabled} onClick={() => input.click()}>{L.wsdUpload}</WsButton>
      <input type="file" multiple hidden ref={(el) => (input = el)}
             onChange={(e) => { props.onFiles(e.currentTarget.files); e.currentTarget.value = ""; }} />
    </>
  );
}

/* Desktop's upload tray: one line per file with its bar, and the downloads below */
function Transfers(props) {
  const [hidden, setHidden] = createSignal(false);
  const any = () => props.uploads.length || props.downloads.length;
  const pct = (a, b) => (b ? Math.min(100, Math.round((a / b) * 100)) : 0);
  const STATE = () => ({ queued: L.wsdQueued, sending: "", finishing: L.wsdFinishing, done: L.wsdDone, failed: L.wsdFailed, cancelled: L.wsdCancelled,
                         starting: L.wsdQueued, running: "" });
  return (
    <Show when={any() && !hidden()}>
      <section class="wsd-tray" aria-label={L.wsdTransfers}>
        <div class="wsd-tray-head">
          <b class="wsd-strong">
            {props.summary.active ? L.wsdUploading.replace("$1", props.summary.files - props.summary.done - props.summary.failed).replace("$2", props.summary.percent)
              : props.uploads.length ? L.wsdUploadsDone.replace("$1", props.summary.done) : L.wsdDownloads}
          </b>
          <button type="button" class="wsx-link" onClick={props.onClear}>{L.wshClear}</button>
          <button type="button" class="wsd-tray-x" aria-label={L.wsClose} onClick={() => setHidden(true)}><Icon name="x" /></button>
        </div>
        <div class="wsd-tray-list">
          <For each={props.uploads}>
            {(u) => (
              <div class="wsd-transfer" data-state={u.state}>
                <div class="wsd-transfer-line">
                  <Icon name="upload" />
                  <span class="wsx-ellipsis wsd-transfer-name" title={u.name}>{u.name}</span>
                  <span class="wsd-transfer-state">{u.state === "sending" ? pct(u.sent, u.size) + "%" : STATE()[u.state]}</span>
                  <Show when={u.state === "queued" || u.state === "sending"}>
                    <button type="button" class="wsd-tray-x" aria-label={L.wsdCancelUpload.replace("$1", u.name)} onClick={() => props.onCancel(u.id)}><Icon name="x" /></button>
                  </Show>
                  <Show when={u.state === "failed" || u.state === "cancelled"}>
                    <button type="button" class="wsx-link" onClick={() => props.onRetry(u.id)}>{L.wsxRetry}</button>
                  </Show>
                </div>
                <div class="wsd-bar" role="progressbar" aria-label={u.name} aria-valuemin="0" aria-valuemax="100" aria-valuenow={pct(u.sent, u.size)}>
                  <div class="wsd-bar-fill" style={{ width: Math.max(2, pct(u.sent, u.size)) + "%" }} />
                </div>
                <Show when={u.error}><span class="wsd-transfer-error">{u.error}</span></Show>
              </div>
            )}
          </For>
          <For each={props.downloads}>
            {(d) => (
              <div class="wsd-transfer" data-state={d.state}>
                <div class="wsd-transfer-line">
                  <Icon name="download" />
                  <span class="wsx-ellipsis wsd-transfer-name" title={d.name}>{d.name}</span>
                  <span class="wsd-transfer-state">{d.state === "running" ? (d.total ? pct(d.received, d.total) + "%" : formatBytes(d.received)) : STATE()[d.state]}</span>
                  <Show when={d.state === "running"}>
                    <button type="button" class="wsd-tray-x" aria-label={L.wsdCancelUpload.replace("$1", d.name)} onClick={() => props.onCancelDownload(d)}><Icon name="x" /></button>
                  </Show>
                  <Show when={d.state === "done" && d.path}>
                    <button type="button" class="wsx-link" onClick={() => props.onReveal(d)}>{L.wshShowInFolder}</button>
                  </Show>
                </div>
                <div class="wsd-bar" role="progressbar" aria-label={d.name} aria-valuemin="0" aria-valuemax="100" aria-valuenow={d.state === "done" ? 100 : pct(d.received, d.total)}>
                  <div class="wsd-bar-fill" style={{ width: (d.state === "done" ? 100 : Math.max(2, pct(d.received, d.total))) + "%" }} />
                </div>
                <Show when={d.error}><span class="wsd-transfer-error">{d.error}</span></Show>
              </div>
            )}
          </For>
        </div>
      </section>
    </Show>
  );
}

/* Desktop's DetailsDrawer: Details and Activity of the item, or of the place shown */
function DetailsDrawer(props) {
  const [tab, setTab] = createSignal("details");
  const [activity, setActivity] = createSignal(null);
  const [error, setError] = createSignal("");
  const item = () => props.item;
  createEffect(() => {
    const it = item();
    setActivity(null);
    setError("");
    if (tab() !== "activity" || !it || it.kind === "place" || !props.online) return;
    WS().activity(props.account, it).then(setActivity, (e) => { setActivity([]); setError(friendly(e)); });
  });
  const rows = () => {
    const it = item();
    if (!it || it.kind === "place") return [[L.wsdItemsLabel, String(((props.data && props.data.items) || []).length)]];
    return [
      [L.wshType, typeName(it)],
      [L.wsdSize, it.kind === "folder" && !it.size ? "—" : formatBytes(it.size)],
      [L.colLocation, it.location || L.wsMyDrive],
      [L.wsOwner, it.owner || "—"],
      [L.wsModified, when(it.modified) || "—"],
      [L.wsdSharing, SHARING()[sharingOf(it)]],
      [L.wsdAccess, LEVEL()[(it.access && it.access.level) || it.level] || "—"],
    ].concat(it.version ? [[L.wsdVersion, String(it.version)]] : []);
  };
  return (
    <aside class="wsd-drawer" aria-label={L.wsdDetails}><div class="wsd-drawer-inner">
      <div class="wsd-drawer-head">
        <Show when={item().kind !== "place"} fallback={<Icon name="folder" />}><FileIcon item={item()} /></Show>
        <b class="wsx-ellipsis wsd-strong" title={item().name}>{item().kind === "place" ? props.place : item().name}</b>
        <button type="button" class="wsd-tray-x" aria-label={L.wsClose} onClick={props.onClose}><Icon name="x" /></button>
      </div>
      <Show when={item().kind !== "place"}>
        <div class="wsd-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab() === "details" ? "true" : "false"} onClick={() => setTab("details")}>{L.wsdDetails}</button>
          <button type="button" role="tab" aria-selected={tab() === "activity" ? "true" : "false"} onClick={() => setTab("activity")}>{L.wsdActivity}</button>
        </div>
      </Show>
      <Show when={tab() === "details" || item().kind === "place"} fallback={
        <div class="wsd-activity">
          <Show when={props.online} fallback={<p class="wsd-hint">{L.wsdActivityOffline}</p>}>
            <Show when={activity()} fallback={<SkeletonRows count={3} />}>
              <Show when={activity().length} fallback={<p class="wsd-hint">{error() || L.wsdNoActivity}</p>}>
                <ol class="wsd-timeline">
                  <For each={activity()}>
                    {(a) => <li><span>{a.summary}</span><span class="wsd-hint">{[a.actor, when(a.at)].filter(Boolean).join(" · ")}</span></li>}
                  </For>
                </ol>
              </Show>
            </Show>
          </Show>
        </div>
      }>
        <dl class="wsx-kv wsd-kv">
          <For each={rows()}>{([k, v]) => <><dt>{k}</dt><dd>{v}</dd></>}</For>
        </dl>
        <Show when={props.actions.length}>
          <div class="wsd-drawer-actions">
            <For each={props.actions.filter((a) => ["open", "preview", "download", "share", "versions"].includes(a))}>
              {(a) => <WsButton small variant={a === "open" ? "primary" : "secondary"} onClick={() => props.onAction(a)}>
                {{ open: L.menuFileOpen, preview: L.wsdPreview, download: L.wsdDownload, share: L.wsShareMenu, versions: L.wsVersionHistory }[a]}
              </WsButton>}
            </For>
          </div>
        </Show>
      </Show>
    </div></aside>
  );
}

/* A PDF in the app's own viewer (the server's signed address, never a download link), with Open and Download */
function PreviewDialog(props) {
  const [p, setP] = createSignal(null);
  const [error, setError] = createSignal("");
  onMount(() => WS().preview(props.account, props.file).then(setP, (e) => setError(friendly(e))));
  return (
    <Frame title={props.file.name} onClose={props.onClose} wide>
      <div class="wsd-preview">
        <Show when={p()} fallback={<Show when={error()} fallback={<Spinner label={L.wsdPreview} />}><p class="ws-error">{error()}</p></Show>}>
          <Show when={p().url} fallback={
            <Show when={props.thumb} fallback={<p class="wsd-hint">{L.wsdNoPreview}</p>}><img src={props.thumb} alt="" class="wsd-preview-img" /></Show>
          }>
            <iframe class="wsd-preview-frame" src={p().url} title={props.file.name} sandbox="allow-scripts allow-same-origin" referrerpolicy="no-referrer" />
          </Show>
        </Show>
      </div>
      <div class="wsx-confirm-actions">
        <Show when={props.onDownload}><WsButton variant="secondary" icon="download" onClick={props.onDownload}>{L.wsdDownload}</WsButton></Show>
        <WsButton variant="primary" onClick={props.onOpen}>{L.wsdOpenInEditor}</WsButton>
      </div>
    </Frame>
  );
}
