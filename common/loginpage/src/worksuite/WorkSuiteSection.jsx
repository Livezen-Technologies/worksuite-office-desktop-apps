/*
 * The WorkSuite Drive section of the home screen: the full-width account panel (connected / session
 * expired / not connected), then a Drive browser: Recent, Shared with me, Starred, My Drive and search,
 * type filters, sort, list or grid, multi-select, row and context menus (only what the server and the
 * file's access level allow), paged rendering and lazy pictures. See core.js for signing in and opening.
 */
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { ContextMenu, DropdownMenu } from "@/components";
import { usePngIcons } from "@/services/display";
import { L } from "./lang.js";
import "./core.js";
import { SignInDialog, NewDialog } from "./dialogs.jsx";
import { MoveDialog, VersionsDialog, ShareDialog, OpenLinkDialog } from "./drive.jsx";
import { hostOf, when } from "./cards.jsx";
import { AccountPanel, ConnectCard } from "./connect.jsx";
import { mergeAccounts } from "./settings-logic.js";
import { accountPanelState, driveActions, filterFiles, nextPage, nextSort, reconnectBusy, reconnectStep, selectWith, sortFiles } from "./home-logic.js";
import { ConfirmDialog, EmptyState, Icon, IconButton, LayoutToggle, SearchBox, SkeletonRows, TypeChips, WsButton } from "./ui/components.jsx";
import { homeSession, setHomeSession } from "@/stores/home-session.js";
import { online } from "./shell.js";
import { PlatformNotices } from "./notices.jsx"; // oda-platform hook (G-01, G-04)
import "./worksuite.css";
import "./home.css";
import { PolicyBanner, PolicyCard } from "./ShellParts.jsx"; // oda-shell (ADM-01)

const WS = () => window.WorkSuite;

const FORMAT_ICONS = ["csv", "djvu", "doc", "docm", "docx", "docxf", "dotm", "dotx", "epub", "fb2", "fodp", "fods", "fodt", "html", "md",
  "odp", "ods", "odt", "otp", "ots", "ott", "pdf", "potm", "potx", "pps", "ppsm", "ppsx", "ppt", "pptm", "pptx", "rtf", "txt", "xls",
  "xlsb", "xlsm", "xlsx", "xltm", "xltx"];

// How many times a list asks the server for more pictures while it is shown.
const PICTURE_ROUNDS = 12;
// rows rendered at a time; more as the page scrolls to the end of the list
const PAGE = 50;

function FileIcon(props) {
  const icon = () => (props.item.kind === "folder" ? "folder-small" : FORMAT_ICONS.includes(props.item.ext) ? props.item.ext : "neutral");
  const [broken, setBroken] = createSignal(false);
  const thumb = () => props.item.kind === "file" && !broken() && props.thumb;
  return (
    <div class="icon" classList={{ "has-thumb": !!thumb() }}>
      <Show when={usePngIcons() && props.item.kind !== "folder"} fallback={<svg class="icon"><use href={`#${icon()}`} /></svg>}>
        <i class={`doc-format ${props.item.ext}`} />
      </Show>
      <Show when={thumb()}>
        <img class="ws-thumb" src={thumb()} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setBroken(true)} />
      </Show>
    </div>
  );
}

const TABS = () => [["recent", L.wsRecent], ["shared", L.wsShared], ["starred", L.wsStarred], ["drive", L.wsMyDrive]];
const SORTS = () => [["name", L.colFileName], ["modified", L.wsModified], ["owner", L.wsOwner], ["type", L.wshType]];

export default function WorkSuiteSection() {
  const [account, setAccount] = createSignal(null);
  const [accounts, setAccounts] = createSignal([]);
  const [folder, setFolder] = createSignal(null);
  const [query, setQuery] = createSignal("");
  const [data, setData] = createSignal(null);
  const [thumbs, setThumbs] = createSignal({});
  const [shownCount, setShownCount] = createSignal(PAGE);
  const [state, setState] = createSignal({ text: "", error: false, undo: null });
  const [loadError, setLoadError] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [renaming, setRenaming] = createSignal(null); // the id of the file renamed in place
  const [companies, setCompanies] = createSignal([]);
  const [dialog, setDialog] = createSignal(null);
  const [, setDesktop] = createSignal(null); // a WorkSuite Desktop account to continue as
  const [os, setOs] = createSignal(null); // WorkSuite OS's credentials broker
  const [osBusy, setOsBusy] = createSignal(false);
  const [osError, setOsError] = createSignal("");
  const [desktopList, setDesktopList] = createSignal([]); // every WorkSuite Desktop account, for the account picker
  const [picked, setPicked] = createSignal(null); // the account chosen in the connect card
  const [disconnecting, setDisconnecting] = createSignal(false);
  const [rc, setRc] = createSignal({ phase: "idle" }); // Reconnect (reconnectStep)
  const [selected, setSelected] = createSignal([]);
  let anchor = null;

  let seq = 0, lastOpen = 0, pendingLink = null, osTried = false, sentinel;

  const live = () => account() && !account().signedOut;
  const panel = () => accountPanelState(account());
  const say = (text, error, undo) => setState({ text: text || "", error: !!error, undo: undo || null });
  const prefs = () => homeSession.drive;
  const view = () => (query() ? "search" : prefs().view);
  const rc$ = (event) => setRc(reconnectStep(rc(), event));

  const visible = createMemo(() => {
    const items = (data() && data().items) || [];
    const org = account() ? WS().companyOf(account()) : null;
    const inOrg = items.filter((i) => WS().inCompany(org, i));
    return sortFiles(filterFiles(inOrg, { type: prefs().type }), prefs().sort);
  });
  const shown = () => visible().slice(0, shownCount());
  const fileCount = () => visible().filter((i) => i.kind === "file").length;
  const isSelected = (item) => selected().includes(item.id);
  const selectedItems = () => visible().filter((i) => selected().includes(i.id));

  function refresh() {
    setAccounts(WS().accounts());
    setAccount(WS().active());
    setCompanies((account() && account().companies) || []);
    if (live()) {
      load();
      if (!account().companies) WS().companies(account()).then(setCompanies, () => {});
    }
    else findDesktop();
  }

  /* Signed out, but WorkSuite Desktop (or WorkSuite OS) is signed in on this computer: one click */
  function findDesktop() {
    const liveIds = WS().accounts().filter((a) => !a.signedOut).map((a) => a.id);
    WS().desktopAccounts().then((list) => {
      setDesktopList(list || []);
      if (os() && os().available) return;
      setDesktop(list.find((x) => !liveIds.includes(x.server + "|" + x.user.id)) || null);
    });
    WS().osBroker().then((o) => {
      setOs(o);
      if (!o.available) return;
      const a = o.account;
      if (a && a.state === "signed_in" && !osTried) {
        osTried = true;
        signInOs();
      }
    });
  }

  async function signInOs() {
    setOsBusy(true);
    setOsError("");
    try {
      await WS().signInWithBroker();
    } catch (e) {
      setOsError(e.message);
    } finally {
      setOsBusy(false);
    }
  }

  function signIn(desktopAccount, other, server) {
    if (dialog() || osBusy()) return;
    say("");
    if (!desktopAccount && !other && !server && os() && os().available) return signInOs();
    setDialog({ kind: "signin", desktopAccount: desktopAccount || null, server: server || null });
  }

  function selectTab(v) {
    setHomeSession("drive", "view", v);
    if (v === "drive") setFolder(null);
    setSelected([]);
    load();
  }

  function search(q) {
    if (q === query()) return;
    setQuery(q.length >= 2 ? q : "");
    setSelected([]);
    load();
  }

  async function load() {
    const acc = account();
    if (!acc || acc.signedOut) return;

    const opts = { folder: folder(), q: query() };
    const mine = ++seq;
    setShownCount(PAGE);
    setLoadError("");

    // what we saw last time, straight away; then what the server says now
    const cached = WS().cached(acc, view(), opts);
    setThumbs(WS().cachedThumbs(acc) || {});
    setData(cached);
    setLoading(true);

    try {
      const fresh = await WS().list(acc, view(), opts);
      if (mine !== seq) return;
      setData(fresh);
      setSelected((s) => s.filter((id) => fresh.items.some((i) => i.id === id)));
      pictures(acc, mine);
    } catch (e) {
      if (mine !== seq || e.signedOut) return;
      setLoadError(e.message || L.wsOffline);
    } finally {
      if (mine === seq) setLoading(false);
    }
  }

  /* Pictures of the documents shown (not of the whole list) instead of their file-type icons; failures are quiet. */
  const asked = new Set();
  async function pictures(acc, mine) {
    let ids = shown().filter((i) => i.kind === "file" && !asked.has(acc.id + ":" + i.id)).map((i) => i.id).slice(0, 100);
    ids.forEach((id) => asked.add(acc.id + ":" + id));
    for (let round = 0; ids.length && round < PICTURE_ROUNDS; round++) {
      let answer;
      try {
        answer = await WS().thumbs(acc, ids, true);
      } catch (e) {
        return;
      }
      if (mine !== seq) return;
      const next = { ...thumbs() };
      Object.keys(answer.thumbs).forEach((id) => {
        if (answer.thumbs[id]) next[id] = answer.thumbs[id];
        else delete next[id];
      });
      setThumbs(next);
      ids = answer.pending.filter((id) => ids.includes(id));
    }
  }

  function showMore() {
    if (shownCount() >= visible().length) return;
    setShownCount(nextPage(shownCount(), visible().length, PAGE));
    if (live()) pictures(account(), seq);
  }

  /* the next page renders as the end of the list comes into view (the page is the one scroll container) */
  createEffect(() => {
    if (!sentinel || shownCount() >= visible().length) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && showMore(), { rootMargin: "400px" });
    io.observe(sentinel);
    onCleanup(() => io.disconnect());
  });

  function activate(item) {
    if (item.kind === "folder") {
      setHomeSession("drive", "view", "drive");
      setQuery("");
      setFolder(item.id);
      setSelected([]);
      load();
    } else open(item);
  }

  async function open(file, acc) {
    acc = acc || account();
    if (performance.now() - lastOpen < 1000) return;
    lastOpen = performance.now();
    try {
      await WS().open(acc, file);
    } catch (e) {
      !e.signedOut && say(e.message, true);
    }
  }

  /*
   * worksuiteoffice://open, contract v1 (LNK-04/05, G-06): the account is the link's uid on its server, chosen in
   * "Open as" when more than one could open it; org switches the company; mode=view opens read-only; a src copy
   * (a mail attachment) is read from the server and saved into a Drive folder the person picks.
   */
  async function openLink(link) {
    const all = WS().accounts().filter((a) => !a.signedOut);
    const current = live() ? account() : null;
    const onServer = link.server ? all.filter((a) => a.server === link.server) : current ? [current] : [];
    const own = link.uid ? onServer.find((a) => String(a.user.id) === String(link.uid)) : null;
    if (!onServer.length) {
      pendingLink = link;
      signIn();
      return;
    }
    const initial = own || (current && onServer.find((a) => a.id === current.id)) || onServer[0];
    if (onServer.length === 1 && (!link.uid || own) && !link.src) return openLinkAs(link, initial);
    setDialog({ kind: "link", link, candidates: onServer, initial, error: "" });
  }

  async function openLinkAs(link, acc) {
    if (!current() || acc.id !== current().id) WS().setActive(acc.id);
    if (link.org && link.uid && String(acc.user.id) === String(link.uid)) WS().setCompany(acc, link.org);
    try {
      if (link.src) {
        const server = await WS().checkServer(acc.server).catch(() => ({}));
        if (!server.openSource) throw new Error(L.wsErrNoSourceOpen);
        await WS().open(acc, { src: link.src, name: link.name || "", ext: WS().extOf(link.name), level: "view" });
      } else {
        const file = await WS().details(acc, link.id);
        if (link.mode === "view") file.level = "view";
        await open(file, acc);
      }
      if (dialog() && dialog().kind === "link") setDialog(null);
    } catch (e) {
      if (e.signedOut) return;
      if (dialog() && dialog().kind === "link") setDialog({ ...dialog(), error: e.message });
      else say(e.message, true);
    }
  }

  function current() {
    return live() ? account() : null;
  }

  /* "Share" in a Drive editor tab (DRV-10): the Share dialog here, for the account on that tab's server */
  async function shareFromEditor(req) {
    const all = WS().accounts().filter((a) => !a.signedOut && a.server === req.server);
    const acc = (current() && all.find((a) => a.id === current().id)) || all[0];
    if (!acc) return;
    try {
      const file = await WS().details(acc, req.id);
      if (!current() || acc.id !== current().id) WS().setActive(acc.id);
      setDialog({ kind: "share", file, account: acc });
    } catch (e) {
      !e.signedOut && say(e.message, true);
    }
  }

  /* ---- Drive actions (DRV-08, G-09) ---- */

  const failed = (e) => !e.signedOut && say(e.message, true);

  async function commitRename(item, value) {
    setRenaming(null);
    const dot = item.name.lastIndexOf(".");
    const ext = dot > 0 ? item.name.substring(dot) : "";
    const base = String(value || "").trim();
    if (!base || base + ext === item.name) return;
    try {
      await WS().rename(account(), item, base + ext);
      say(L.wsRenamed);
      load();
    } catch (e) {
      failed(e);
    }
  }

  async function makeCopy(item) {
    try {
      const copy = await WS().copy(account(), item);
      say(L.wsCopied.replace("$1", copy.name || item.name));
      load();
    } catch (e) {
      failed(e);
    }
  }

  async function toBin(list) {
    const acc = account();
    const done = [];
    try {
      for (const item of list) {
        await WS().trash(acc, item);
        done.push(item);
      }
    } catch (e) {
      failed(e);
    }
    if (done.length) {
      say(done.length === 1 ? L.wsMovedToBin.replace("$1", done[0].name) : L.wshMovedManyToBin.replace("$1", done.length), false, {
        label: L.wsUndo,
        run: () => Promise.all(done.map((item) => WS().untrash(acc, item))).then(() => { say(""); load(); }, failed),
      });
      setSelected([]);
      load();
    }
  }

  async function star(list, on) {
    try {
      for (const item of list) await WS().star(account(), item, on);
    } catch (e) {
      failed(e);
    }
    load();
  }

  function crumbs() {
    return [{ id: null, name: L.wsMyDrive }].concat((data() && data().breadcrumb) || []);
  }

  onMount(() => {
    const changed = () => refresh();
    const signedin = () => {
      rc$({ type: "signedin" });
      setFolder(null);
      refresh();
      if (pendingLink) {
        const link = pendingLink;
        pendingLink = null;
        openLink(link);
      }
    };
    const error = (e) => !dialog() && say(e.message, true);
    WS().on("changed", changed);
    WS().on("signedin", signedin);
    WS().on("openlink", openLink);
    WS().on("share", shareFromEditor);
    WS().on("error", error);
    const back = () => live() && load();
    window.addEventListener("online", back);
    onCleanup(() => {
      WS().off("changed", changed);
      WS().off("signedin", signedin);
      WS().off("openlink", openLink);
      WS().off("share", shareFromEditor);
      WS().off("error", error);
      window.removeEventListener("online", back);
    });
    refresh();
  });

  const can = (feature) => WS().has(account(), feature);

  /* The row menu (T03): Open, Rename, Move to…, Make a copy, Version history, Share…, Move to bin.
     Only what the server offers (G-01) and the file's access level allow; the server refuses the rest in its own words. */
  const FileMenu = (p) => {
    const M = p.menu;
    const item = p.item;
    const acts = driveActions(item, can);
    const has = (a) => acts.includes(a);
    return (
      <>
        <M.Item onSelect={() => activate(item)}>{L.menuFileOpen}</M.Item>
        <Show when={item.kind === "file"}>
          <Show when={has("rename")}><M.Item onSelect={() => setRenaming(item.id)}>{L.wsRename}</M.Item></Show>
          <Show when={has("move")}><M.Item onSelect={() => setDialog({ kind: "move", file: item })}>{L.wsMoveToMenu}</M.Item></Show>
          <Show when={has("copy")}><M.Item onSelect={() => makeCopy(item)}>{L.wsMakeCopy}</M.Item></Show>
          <Show when={has("versions")}><M.Item onSelect={() => setDialog({ kind: "versions", file: item })}>{L.wsVersionHistory}</M.Item></Show>
          <Show when={has("share")}><M.Item onSelect={() => setDialog({ kind: "share", file: item, account: account() })}>{L.wsShareMenu}</M.Item></Show>
          <M.Separator />
          <Show when={has("request-edit")}>
            <M.Item onSelect={() => WS().requestEdit(account(), item).then(() => say(L.wsRequestSent), failed)}>{L.wsRequestEdit}</M.Item>
          </Show>
          <M.Item onSelect={() => star([item], !item.starred)}>{item.starred ? L.wsUnstar : L.wsStar}</M.Item>
          <M.Item onSelect={() => WS().openInBrowser(account(), "/files?file=" + encodeURIComponent(item.id))}>{L.wsOpenInBrowserItem}</M.Item>
          <Show when={has("trash")}>
            <M.Separator />
            <M.Item class="negative" onSelect={() => toBin([item])}>{L.wsMoveToBin}</M.Item>
          </Show>
        </Show>
      </>
    );
  };

  /* ---- the account area (connect.jsx) ---- */
  const known = createMemo(() => mergeAccounts(accounts(), desktopList()));
  const connectAccount = () => {
    const o = os();
    if (o && o.available) {
      const b = o.account;
      return { id: "os", os: true, server: b ? b.server : "", user: { name: (b && b.state === "signed_in" && b.name) || (b ? hostOf(b.server) : L.wsOsSignIn) } };
    }
    const list = known();
    return list.find((a) => a.id === picked()) || list.find((a) => a.desktopOnly || a.desktop) || (account() && list.find((a) => a.id === account().id)) || list[0] || null;
  };
  const connecting = () => osBusy() || !!(dialog() && dialog().kind === "signin" && !dialog().reconnect);
  const connectError = () => osError() || (state().error ? state().text : "");
  const panelAccount = () => known().find((a) => account() && a.id === account().id) || account();

  function chooseAccount(a) {
    if (a.desktopOnly) return signIn(a.desktop);
    setPicked(null);
    WS().setActive(a.id);
  }
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

  /*
   * Reconnect the expired account: its kept refresh token first (silent), otherwise a sign-in for that same
   * account (WorkSuite Desktop's "Continue as" when it has it, else the browser on that server). The account
   * is never removed for this, and the in-flight state (reconnectStep) keeps a second click from opening a
   * second sign-in window. Success refreshes the panel and the Drive list ("signedin" / "changed").
   */
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
    if (dialog() && dialog().kind === "signin" && dialog().reconnect) rc$({ type: "cancel" });
    setDialog(null);
  }

  async function disconnect() {
    setDisconnecting(true);
    try {
      await WS().signOutOnly(account());
      setDialog(null);
    } catch (e) {
      say(e.message, true);
    } finally {
      setDisconnecting(false);
    }
  }

  function manageAccounts() {
    try { sessionStorage.setItem("ws:settings:section", "accounts"); } catch {}
    location.hash = "#/settings/worksuite";
  }

  /* ---- selection and keyboard ---- */
  function onRowClick(e, item) {
    if (renaming() === item.id) return;
    const r = selectWith(selected(), item.id, { toggle: e.ctrlKey || e.metaKey, shift: e.shiftKey }, visible().map((i) => i.id), anchor);
    anchor = r.anchor;
    setSelected(r.selected);
  }
  function toggleOne(item) {
    const r = selectWith(selected(), item.id, { toggle: true }, visible().map((i) => i.id), anchor);
    anchor = r.anchor;
    setSelected(r.selected);
  }
  function onRowKey(e, item) {
    if (renaming() === item.id) return;
    if (e.key === "Enter") { e.preventDefault(); activate(item); }
    else if (e.key === " ") { e.preventDefault(); toggleOne(item); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const rows = [...e.currentTarget.parentElement.querySelectorAll("[data-row]")];
      const i = rows.indexOf(e.currentTarget) + (e.key === "ArrowDown" ? 1 : -1);
      rows[i] && rows[i].focus();
    } else if (e.key === "Escape" && selected().length) setSelected([]);
    else if (e.key === "F2" && driveActions(item, can).includes("rename")) setRenaming(item.id);
    else if (e.key === "Delete" && driveActions(item, can).includes("trash")) toBin([item]);
  }

  const sortLabel = () => (SORTS().find(([k]) => k === prefs().sort.key) || SORTS()[1])[1];
  const allSelected = () => shown().length > 0 && shown().every((i) => selected().includes(i.id));
  const bulkTrash = () => selectedItems().length > 0 && selectedItems().every((i) => driveActions(i, can).includes("trash"));

  const Name = (p) => {
    const item = p.item;
    const dot = item.name.lastIndexOf(".");
    const base = item.kind === "file" && dot > 0 ? item.name.substring(0, dot) : item.name;
    const ext = item.kind === "file" && dot > 0 ? item.name.substring(dot) : "";
    return (
      <Show when={renaming() === item.id} fallback={<span class="wsh-name wsx-ellipsis">{base}<span class="ext">{ext}</span></span>}>
        <input class="ws-input ws-rename" value={base} spellcheck={false} aria-label={L.wsRename}
               ref={(el) => setTimeout(() => { el.focus(); el.select(); }, 0)}
               onClick={(e) => e.stopPropagation()} onDblClick={(e) => e.stopPropagation()}
               onKeyDown={(e) => {
                 e.stopPropagation();
                 if (e.key === "Enter") commitRename(item, e.currentTarget.value);
                 if (e.key === "Escape") setRenaming(null);
               }}
               onBlur={(e) => renaming() === item.id && commitRename(item, e.currentTarget.value)} />
      </Show>
    );
  };

  const RowActions = (p) => (
    <div class="wsh-row-actions" onClick={(e) => e.stopPropagation()} onDblClick={(e) => e.stopPropagation()}>
      <Show when={p.item.kind === "file"}>
        <IconButton icon={p.item.starred ? "star-on" : "star"} label={p.item.starred ? L.wsUnstar : L.wsStar}
                    class={p.item.starred ? "is-starred" : ""} onClick={() => star([p.item], !p.item.starred)} />
        <Show when={driveActions(p.item, can).includes("share")}>
          <IconButton icon="share" label={L.wshShare} onClick={() => setDialog({ kind: "share", file: p.item, account: account() })} />
        </Show>
        <DropdownMenu>
          <DropdownMenu.Trigger class="wsx-btn wsx-btn-ghost wsx-btn-sm wsx-btn-icon" aria-label={L.wsxMoreActions.replace("$1", p.item.name)}>
            <Icon name="more" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Content><FileMenu menu={DropdownMenu} item={p.item} /></DropdownMenu.Content>
        </DropdownMenu>
      </Show>
    </div>
  );

  const Row = (p) => {
    const item = p.item;
    return (
      <ContextMenu onOpenChange={(o) => o && !isSelected(item) && setSelected([item.id])}>
        <ContextMenu.Trigger as="div" data-row role="row" tabindex="0" aria-selected={isSelected(item) ? "true" : "false"}
                             class={prefs().layout === "grid" ? "wsh-card" : "wsh-row"} classList={{ "is-selected": isSelected(item) }}
                             onClick={(e) => onRowClick(e, item)} onDblClick={() => renaming() !== item.id && activate(item)}
                             onKeyDown={(e) => onRowKey(e, item)}>
          <span class="wsh-check" role="gridcell" onClick={(e) => { e.stopPropagation(); toggleOne(item); }} onDblClick={(e) => e.stopPropagation()}>
            <input type="checkbox" tabindex="-1" checked={isSelected(item)} aria-label={L.wshSelect.replace("$1", item.name)} />
          </span>
          <Show when={prefs().layout === "grid"} fallback={
            <>
              <span class="wsh-col-name" role="gridcell" title={item.name}>
                <FileIcon item={item} thumb={thumbs()[item.id]} />
                <Name item={item} />
                <Show when={item.starred}><Icon name="star-on" class="wsh-star-mark" /></Show>
                <Show when={item.level === "view"}><span class="ws-badge">{L.wsViewOnly}</span></Show>
              </span>
              <span class="wsh-col-loc wsx-ellipsis" role="gridcell" title={item.location}>{item.location}</span>
              <span class="wsh-col-owner wsx-ellipsis" role="gridcell">{item.owner}</span>
              <span class="wsh-col-date" role="gridcell">{when(item.modified)}</span>
              <RowActions item={item} />
            </>
          }>
            <div class="wsh-card-thumb">
              <FileIcon item={item} thumb={thumbs()[item.id]} />
            </div>
            <div class="wsh-card-text">
              <Name item={item} />
              <span class="wsx-hint wsx-ellipsis">{[item.owner, when(item.modified)].filter(Boolean).join(" · ")}</span>
            </div>
            <RowActions item={item} />
          </Show>
        </ContextMenu.Trigger>
        <ContextMenu.Content><FileMenu menu={ContextMenu} item={item} /></ContextMenu.Content>
      </ContextMenu>
    );
  };

  const emptyText = () => {
    if (view() === "search") return [L.wshNoMatch.replace("$1", query()), L.wshNoMatchHint];
    if (prefs().type !== "all" && ((data() && data().items) || []).length) return [L.wshNoType, ""];
    return {
      recent: [L.wshEmptyRecent, L.wshEmptyRecentHint],
      shared: [L.wshEmptyShared, L.wshEmptySharedHint],
      starred: [L.wshEmptyStarred, L.wshEmptyStarredHint],
      drive: [L.wshEmptyFolder, ""],
    }[view()] || [L.wsEmpty, ""];
  };

  const ColHead = (p) => (
    <span class={p.class} role="columnheader" aria-sort={prefs().sort.key === p.k ? (prefs().sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" class="wsh-sort-head" onClick={() => setHomeSession("drive", "sort", nextSort(prefs().sort, p.k))}>
        {p.label}
        <Show when={prefs().sort.key === p.k}><Icon name="chevron" class={"wsh-sort-dir " + prefs().sort.dir} /></Show>
      </button>
    </span>
  );

  return (
    <section class="ws-section wsh-drive" classList={{ "signed-in": !!live() }} aria-labelledby="wsh-drive-title">
      <div class="wsh-head">
        <h2 class="wsh-h2" id="wsh-drive-title">{L.wsTitle}</h2>
        <Show when={live()}>
          <div class="wsh-head-tools">
            <SearchBox class="wsh-search" placeholder={L.wsSearch} value={query()} onSearch={search} />
            <WsButton variant="secondary" icon="external" onClick={() => WS().openInBrowser(account(), "/files")}>{L.wsxOpenDrive}</WsButton>
            <DropdownMenu>
              <DropdownMenu.Trigger class="wsx-btn wsx-btn-primary">
                <Icon name="plus" /><span>{L.wsNew}</span>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content>
                <DropdownMenu.Item icon="#docx" onSelect={() => setDialog({ kind: "new", type: "word" })}>{L.wsNewDocument}</DropdownMenu.Item>
                <DropdownMenu.Item icon="#xlsx" onSelect={() => setDialog({ kind: "new", type: "cell" })}>{L.wsNewSpreadsheet}</DropdownMenu.Item>
                <DropdownMenu.Item icon="#pptx" onSelect={() => setDialog({ kind: "new", type: "slide" })}>{L.wsNewPresentation}</DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu>
          </div>
        </Show>
      </div>

      <PolicyBanner />{/* oda-shell (ADM-01) */}
      {/* oda-platform hook: server too old (G-01), sign-in kept in a file (G-04) */}
      <PlatformNotices account={account()} />

      <Show when={panel() === "connected" || panel() === "expired"} fallback={
        <>
          <ConnectCard known={known()} selected={connectAccount()} connecting={connecting()} error={connectError()}
                       onSelect={chooseInCard} onContinue={continueAs} noOther={!!(os() && os().available)} onOtherAccount={() => signIn(null, true)} />
          <PolicyCard />{/* oda-shell (ADM-01) */}
        </>
      }>
        <AccountPanel state={panel()} account={panelAccount()} known={known()} companies={companies()}
                      companyId={WS().companyOf(account())} onCompany={(id) => WS().setCompany(account(), id)}
                      onSelect={chooseAccount} onAdd={() => signIn(null, true)} onManage={manageAccounts}
                      onDisconnect={() => setDialog({ kind: "disconnect" })}
                      onReconnect={reconnect} reconnecting={reconnectBusy(rc())} error={rc().phase === "error" ? rc().message : ""}
                      onRefresh={load} refreshing={loading()} />
      </Show>

      <Show when={live()}>
        <div class="wsh-bar">
          <div class="wsh-tabs" role="tablist" aria-label={L.wsTitle}
               onKeyDown={(e) => {
                 const tabs = TABS().map(([v]) => v);
                 const i = tabs.indexOf(prefs().view);
                 const j = e.key === "ArrowRight" ? (i + 1) % tabs.length : e.key === "ArrowLeft" ? (i - 1 + tabs.length) % tabs.length : -1;
                 if (j < 0) return;
                 e.preventDefault();
                 setQuery("");
                 selectTab(tabs[j]);
                 e.currentTarget.querySelectorAll("[role=tab]")[j].focus();
               }}>
            <For each={TABS()}>
              {([v, label]) => (
                <button type="button" role="tab" aria-selected={view() === v ? "true" : "false"} tabindex={prefs().view === v ? 0 : -1}
                        onClick={() => { setQuery(""); selectTab(v); }}>{label}</button>
              )}
            </For>
            <Show when={view() === "search"}>
              <button type="button" role="tab" aria-selected="true" tabindex="-1">{L.wsSearchResults}</button>
            </Show>
          </div>
          <div class="wsh-bar-tools">
            <TypeChips value={prefs().type} onChange={(t) => { setHomeSession("drive", "type", t); setShownCount(PAGE); }} />
            <DropdownMenu>
              <DropdownMenu.Trigger class="wsx-btn wsx-btn-ghost wsx-btn-sm" aria-label={L.wshSortBy.replace("$1", sortLabel())}>
                <Icon name="sort" /><span>{sortLabel()}</span>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content>
                <For each={SORTS()}>
                  {([k, label]) => (
                    <DropdownMenu.Item onSelect={() => setHomeSession("drive", "sort", nextSort(prefs().sort, k))}>
                      {label}{prefs().sort.key === k ? (prefs().sort.dir === "asc" ? "  ↑" : "  ↓") : ""}
                    </DropdownMenu.Item>
                  )}
                </For>
              </DropdownMenu.Content>
            </DropdownMenu>
            <LayoutToggle value={prefs().layout} onChange={(v) => setHomeSession("drive", "layout", v)} />
          </div>
        </div>

        <Show when={view() === "drive" && !query()}>
          <nav class="ws-crumbs" aria-label={L.wsMyDrive}>
            <For each={crumbs()}>
              {(c, i) => (
                <>
                  <Show when={i() > 0}><span class="sep" aria-hidden="true">›</span></Show>
                  <Show when={i() < crumbs().length - 1} fallback={<span aria-current="page">{c.name}</span>}>
                    <a href="#" onClick={(e) => { e.preventDefault(); setFolder(c.id || null); load(); }}>{c.name}</a>
                  </Show>
                </>
              )}
            </For>
          </nav>
        </Show>

        <Show when={!online() || loadError()}>
          <div class="wsh-banner" classList={{ "is-danger": !data() }} role="status">
            <span>{!online() ? (data() ? L.wshOfflineCached : L.wshOfflineNone) : (data() ? L.wshUnreachableCached.replace("$1", hostOf(account().server)) : loadError())}</span>
            <WsButton variant="link" onClick={load}>{L.wsxRetry}</WsButton>
          </div>
        </Show>

        <Show when={selected().length}>
          <div class="wsh-bulk" role="toolbar" aria-label={L.wshSelection}>
            <span class="wsh-bulk-count">{L.wshSelected.replace("$1", selected().length)}</span>
            <Show when={selected().length === 1}>
              <WsButton small variant="secondary" onClick={() => selectedItems()[0] && activate(selectedItems()[0])}>{L.menuFileOpen}</WsButton>
            </Show>
            <Show when={selectedItems().some((i) => i.kind === "file")}>
              <WsButton small variant="secondary" icon="star" onClick={() => star(selectedItems().filter((i) => i.kind === "file"), true)}>{L.wsStar}</WsButton>
            </Show>
            <Show when={bulkTrash()}>
              <WsButton small variant="danger" icon="trash" onClick={() => toBin(selectedItems())}>{L.wsMoveToBin}</WsButton>
            </Show>
            <WsButton small variant="ghost" onClick={() => setSelected([])}>{L.wshClearSelection}</WsButton>
          </div>
        </Show>

        <Show when={data()} fallback={<Show when={!loadError() && online()}><SkeletonRows count={5} /></Show>}>
          <Show when={visible().length} fallback={
            <EmptyState icon={view() === "starred" ? "star" : view() === "shared" ? "share" : "drive"} title={emptyText()[0]} text={emptyText()[1]}
                        action={prefs().type !== "all" ? <WsButton small variant="secondary" onClick={() => setHomeSession("drive", "type", "all")}>{L.wshShowAllTypes}</WsButton>
                              : view() !== "drive" ? <WsButton small variant="secondary" onClick={() => { setQuery(""); selectTab("drive"); }}>{L.wshOpenMyDrive}</WsButton> : undefined} />
          }>
            <div class={prefs().layout === "grid" ? "wsh-grid" : "wsh-table"} role="grid" aria-label={L.wsTitle} aria-multiselectable="true"
                 aria-busy={loading() ? "true" : "false"}>
              <Show when={prefs().layout === "list"}>
                <div class="wsh-row wsh-row-head" role="row">
                  <span class="wsh-check" role="columnheader">
                    <input type="checkbox" checked={allSelected()} aria-label={L.wshSelectAll}
                           onChange={() => setSelected(allSelected() ? [] : shown().map((i) => i.id))} />
                  </span>
                  <ColHead class="wsh-col-name" k="name" label={L.colFileName} />
                  <span class="wsh-col-loc" role="columnheader">{L.colLocation}</span>
                  <ColHead class="wsh-col-owner" k="owner" label={L.wsOwner} />
                  <ColHead class="wsh-col-date" k="modified" label={L.wsModified} />
                  <span class="wsh-row-actions" />
                </div>
              </Show>
              <For each={shown()}>{(item) => <Row item={item} />}</For>
            </div>
            <div class="wsh-foot">
              <span class="wsx-hint">
                {selected().length ? L.wshSelected.replace("$1", selected().length) + " · " : ""}{L.wshFiles.replace("$1", fileCount())}
              </span>
              <Show when={shownCount() < visible().length}>
                <span ref={(el) => (sentinel = el)} class="wsh-sentinel" aria-hidden="true" />
                <WsButton small variant="secondary" onClick={showMore}>{L.wshShowMore.replace("$1", visible().length - shownCount())}</WsButton>
              </Show>
            </div>
          </Show>
        </Show>
      </Show>

      <Show when={state().text && live()}>
        <p class="ws-state" classList={{ "ws-error": state().error }} role={state().error ? "alert" : "status"}>
          {state().text}
          <Show when={state().undo}>
            {" "}<a href="#" class="ws-link" onClick={(e) => { e.preventDefault(); state().undo.run(); }}>{state().undo.label}</a>
          </Show>
        </p>
      </Show>

      <Show when={dialog() && dialog().kind === "signin"}>
        <SignInDialog desktopAccount={dialog().desktopAccount} server={dialog().server} onClose={closeDialog} />
      </Show>
      <Show when={dialog() && dialog().kind === "disconnect"}>
        <ConfirmDialog title={L.wshDisconnectTitle.replace("$1", account().user.name)}
                       text={L.wshDisconnectText.replace("$1", hostOf(account().server))}
                       confirmLabel={L.wsxDisconnect} danger busy={disconnecting()} onConfirm={disconnect} onClose={() => setDialog(null)} />
      </Show>
      <Show when={dialog() && dialog().kind === "new"}>
        <NewDialog account={account()} type={dialog().type} onClose={() => setDialog(null)}
                   onCreated={(file) => { open(file); load(); }} />
      </Show>
      <Show when={dialog() && dialog().kind === "move"}>
        <MoveDialog account={account()} file={dialog().file} onClose={() => setDialog(null)} onDone={(t) => { say(t); load(); }} />
      </Show>
      <Show when={dialog() && dialog().kind === "versions"}>
        <VersionsDialog account={account()} file={dialog().file} onClose={() => setDialog(null)} onDone={(t) => { say(t); load(); }} />
      </Show>
      <Show when={dialog() && dialog().kind === "share"}>
        <ShareDialog account={dialog().account || account()} file={dialog().file} onClose={() => setDialog(null)} />
      </Show>
      <Show when={dialog() && dialog().kind === "link"}>
        <OpenLinkDialog link={dialog().link} candidates={dialog().candidates} initial={dialog().initial} error={dialog().error}
                        onClose={() => setDialog(null)} onOpen={(acc) => openLinkAs(dialog().link, acc)}
                        onSignIn={() => { pendingLink = dialog().link; setDialog(null); signIn(); }} />
      </Show>
    </section>
  );
}
