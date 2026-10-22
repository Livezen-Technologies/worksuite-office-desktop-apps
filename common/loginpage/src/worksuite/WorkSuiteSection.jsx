/*
 * The WorkSuite section of the home screen (above the recent files):
 * Recent, Shared with me, Starred, My Drive and Search from WorkSuite Drive,
 * with type filters, for the selected WorkSuite account. Signed out, it offers
 * "Sign in to WorkSuite". See core.js for how signing in and opening work.
 */
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { ContextMenu, DropdownMenu } from "@/components";
import { usePngIcons } from "@/services/display";
import { L } from "./lang.js";
import "./core.js";
import { SignInDialog, NewDialog } from "./dialogs.jsx";
import { MoveDialog, VersionsDialog, ShareDialog, OpenLinkDialog } from "./drive.jsx";
import { ContinueCard, hostOf, initials, when } from "./cards.jsx";
import "./worksuite.css";
import { PolicyBanner, PolicyCard } from "./ShellParts.jsx"; // oda-shell (ADM-01)

const WS = () => window.WorkSuite;

const FORMAT_ICONS = ["csv", "djvu", "doc", "docm", "docx", "docxf", "dotm", "dotx", "epub", "fb2", "fodp", "fods", "fodt", "html", "md",
  "odp", "ods", "odt", "otp", "ots", "ott", "pdf", "potm", "potx", "pps", "ppsm", "ppsx", "ppt", "pptm", "pptx", "rtf", "txt", "xls",
  "xlsb", "xlsm", "xlsx", "xltm", "xltx"];

// How many times a list asks the server for more pictures while it is shown.
const PICTURE_ROUNDS = 12;
// rows shown before "Show all"
const ROWS_SHOWN = 10;

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
        <img class="ws-thumb" src={thumb()} alt="" draggable={false} onError={() => setBroken(true)} />
      </Show>
    </div>
  );
}

export default function WorkSuiteSection() {
  const [account, setAccount] = createSignal(null);
  const [accounts, setAccounts] = createSignal([]);
  const [view, setView] = createSignal("recent");
  const [filter, setFilter] = createSignal("all");
  const [folder, setFolder] = createSignal(null);
  const [query, setQuery] = createSignal("");
  const [data, setData] = createSignal(null);
  const [thumbs, setThumbs] = createSignal({});
  const [expanded, setExpanded] = createSignal(false);
  const [state, setState] = createSignal({ text: "", error: false, undo: null });
  const [renaming, setRenaming] = createSignal(null); // the id of the file renamed in place
  const [companies, setCompanies] = createSignal([]);
  const [dialog, setDialog] = createSignal(null); // { kind: 'signin', desktopAccount } | { kind: 'new', type }
  const [desktop, setDesktop] = createSignal(null); // a WorkSuite Desktop account to continue as
  const [os, setOs] = createSignal(null); // WorkSuite OS's credentials broker
  const [osBusy, setOsBusy] = createSignal(false);
  const [osError, setOsError] = createSignal("");

  let seq = 0, where = "", lastOpen = 0, pendingLink = null, osTried = false;

  const live = () => account() && !account().signedOut;
  const say = (text, error, undo) => setState({ text: text || "", error: !!error, undo: undo || null });

  const visible = () => {
    const items = (data() && data().items) || [];
    const org = account() ? WS().companyOf(account()) : null;
    const inOrg = items.filter((i) => WS().inCompany(org, i));
    return filter() === "all" ? inOrg : inOrg.filter((i) => i.kind === "folder" || WS().typeOf(i.ext) === filter());
  };
  const shown = () => (visible().length > ROWS_SHOWN && !expanded() ? visible().slice(0, ROWS_SHOWN) : visible());

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

  function signIn(desktopAccount) {
    if (dialog() || osBusy()) return;
    if (!desktopAccount && os() && os().available) return signInOs();
    setDialog({ kind: "signin", desktopAccount: desktopAccount || null });
  }

  function select(v) {
    setView(v);
    if (v === "drive") setFolder(null);
    load();
  }

  async function load() {
    const acc = account();
    if (!acc || acc.signedOut) return;

    const opts = { folder: folder(), q: query() };
    const mine = ++seq;
    const here = [view(), folder(), query()].join("|");
    if (here !== where) setExpanded(false);
    where = here;

    // what we saw last time, straight away; then what the server says now
    const cached = WS().cached(acc, view(), opts);
    setThumbs(WS().cachedThumbs(acc) || {});
    setData(cached);
    say(cached ? "" : L.wsLoading);

    try {
      const fresh = await WS().list(acc, view(), opts);
      if (mine !== seq) return;
      setData(fresh);
      say(visible().length ? "" : view() === "search" ? L.wsNothingFound : L.wsEmpty);
      pictures(acc, mine);
    } catch (e) {
      if (mine !== seq || e.signedOut) return;
      say(cached ? L.wsOffline : e.message, !cached);
    }
  }

  /* Pictures of the documents instead of their file-type icons; failures are quiet. */
  async function pictures(acc, mine) {
    let ids = ((data() && data().items) || []).filter((i) => i.kind === "file").map((i) => i.id).slice(0, 100);
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

  function activate(item) {
    if (item.kind === "folder") {
      setView("drive");
      setFolder(item.id);
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

  async function toBin(item) {
    const acc = account();
    try {
      await WS().trash(acc, item);
      say(L.wsMovedToBin.replace("$1", item.name), false, {
        label: L.wsUndo,
        run: () => WS().untrash(acc, item).then(() => { say(""); load(); }, failed),
      });
      load();
    } catch (e) {
      failed(e);
    }
  }

  function crumbs() {
    return [{ id: null, name: L.wsMyDrive }].concat((data() && data().breadcrumb) || []);
  }

  onMount(() => {
    const changed = () => refresh();
    const signedin = () => {
      setView("recent");
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
    onCleanup(() => {
      WS().off("changed", changed);
      WS().off("signedin", signedin);
      WS().off("openlink", openLink);
      WS().off("share", shareFromEditor);
      WS().off("error", error);
    });
    refresh();
  });

  /* The row menu (T03): Open, Rename, Move to…, Make a copy, Version history, Share…, Move to bin.
     What a view-only file may not do is not offered; the server refuses the rest in its own words. */
  const FileMenu = (p) => {
    const M = p.menu;
    const item = p.item;
    const canEdit = item.level !== "view";
    return (
      <>
        <M.Item onSelect={() => open(item)}>{L.menuFileOpen}</M.Item>
        <Show when={canEdit}>
          <M.Item onSelect={() => setRenaming(item.id)}>{L.wsRename}</M.Item>
          <M.Item onSelect={() => setDialog({ kind: "move", file: item })}>{L.wsMoveToMenu}</M.Item>
        </Show>
        <M.Item onSelect={() => makeCopy(item)}>{L.wsMakeCopy}</M.Item>
        <M.Item onSelect={() => setDialog({ kind: "versions", file: item })}>{L.wsVersionHistory}</M.Item>
        <M.Item onSelect={() => setDialog({ kind: "share", file: item, account: account() })}>{L.wsShareMenu}</M.Item>
        <M.Separator />
        <Show when={item.level === "view"}>
          <M.Item onSelect={() => WS().requestEdit(account(), item).then(() => say(L.wsRequestSent), failed)}>
            {L.wsRequestEdit}
          </M.Item>
        </Show>
        <M.Item onSelect={() => WS().star(account(), item, !item.starred).then(load, failed)}>
          {item.starred ? L.wsUnstar : L.wsStar}
        </M.Item>
        <M.Item onSelect={() => WS().openInBrowser(account(), "/files?file=" + encodeURIComponent(item.id))}>{L.wsOpenInBrowserItem}</M.Item>
        <Show when={canEdit}>
          <M.Separator />
          <M.Item class="negative" onSelect={() => toBin(item)}>{L.wsMoveToBin}</M.Item>
        </Show>
      </>
    );
  };

  const companyName = () => {
    const org = account() ? WS().companyOf(account()) : null;
    const c = org && companies().find((x) => String(x.id) === String(org));
    return c ? c.name : companies().length > 1 ? L.wsAllCompanies : account() ? account().user.organization : "";
  };

  return (
    <section class="ws-section" classList={{ "signed-in": !!live() }}>
      <div class="ws-head">
        <h3 class="list-section-title ws-title">{L.wsTitle}</h3>
        <Show when={accounts().length && account()}>
          <DropdownMenu>
            <DropdownMenu.Trigger class="ws-account-btn" title={account().user.email || ""}>
              <span class="ws-avatar small" aria-hidden="true">{initials(account().user.name)}</span>
              <span class="ws-account-name">{account().user.name}</span>
              <span class="ws-account-org">{[companyName(), hostOf(account().server)].filter(Boolean).join(" · ")}</span>
              <svg class="ws-caret" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" /></svg>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content class="ws-switcher">
              <For each={accounts()}>
                {(x) => (
                  <>
                    <DropdownMenu.Item class={x.id === account().id ? "checked" : ""} onSelect={() => WS().setActive(x.id)}>
                      {x.user.name + " · " + hostOf(x.server) + (x.signedOut ? " (" + L.wsSignedOutShort + ")" : "")}
                    </DropdownMenu.Item>
                    <Show when={x.id === account().id && !x.signedOut && companies().length > 1}>
                      <>
                        <div class="ws-menu-label" role="presentation">{L.wsCompany}</div>
                        <For each={companies()}>
                          {(c) => (
                            <DropdownMenu.Item class={"ws-company" + (String(WS().companyOf(x)) === String(c.id) ? " checked" : "")}
                                               onSelect={() => WS().setCompany(x, c.id)}>{c.name}</DropdownMenu.Item>
                          )}
                        </For>
                        <DropdownMenu.Item class={"ws-company" + (WS().companyOf(x) === null ? " checked" : "")}
                                           onSelect={() => WS().setCompany(x, null)}>{L.wsAllCompanies}</DropdownMenu.Item>
                      </>
                    </Show>
                  </>
                )}
              </For>
              <DropdownMenu.Separator />
              <DropdownMenu.Item onSelect={() => signIn()}>{L.wsAddAccount}</DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => WS().openInBrowser(account(), "/files")}>{L.wsOpenWeb}</DropdownMenu.Item>
              <DropdownMenu.Item class="negative" onSelect={() => WS().signOut(account())}>
                {L.wsSignOut.replace("$1", account().user.name + " (" + hostOf(account().server) + ")")}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu>
        </Show>
        <span class="ws-spacer" />
        <Show when={live()}>
          <div class="ws-tools">
            <input type="search" class="ws-search" spellcheck={false} placeholder={L.wsSearch}
                   onKeyDown={(e) => {
                     if (e.key === "Enter") {
                       setQuery(e.currentTarget.value.trim());
                       if (query()) select("search");
                     }
                   }} />
            <DropdownMenu>
              <DropdownMenu.Trigger class="ws-new-btn">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
                {L.wsNew}
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
      <Show when={!live()}>
        <div class="ws-signedout">
          <div class="ws-signedout-art" aria-hidden="true">
            <svg viewBox="72 72 880 880"><rect x="72" y="72" width="880" height="880" rx="200" fill="var(--ws-brand)" />
              <path d="M302 365 395 660 512 437 628 660 722 365" fill="none" stroke="#fff" stroke-width="70" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </div>
          <div class="ws-signedout-body">
            <p class="ws-signedout-text">{L.wsSignedOutDescr}</p>
            <div class="ws-signedout-actions">
              <Show when={os() && os().available}
                    fallback={<Show when={desktop()}>
                      <ContinueCard primary name={desktop().user.name}
                                    org={[desktop().user.organization, hostOf(desktop().server)].filter(Boolean).join(" · ")}
                                    via={L.wsViaDesktop} onClick={() => signIn(desktop())} />
                    </Show>}>
                <ContinueCard primary disabled={osBusy()}
                              name={os().account && os().account.state === "signed_in" ? os().account.name || hostOf(os().account.server) : L.wsOsSignIn}
                              org={os().account ? hostOf(os().account.server) : ""} via={L.wsViaOs} onClick={signInOs} />
              </Show>
              <Show when={!(os() && os().available)}>
                <button class="ws-btn" classList={{ "ws-btn-primary": !desktop(), "ws-btn-secondary": !!desktop() }} onClick={() => signIn()}>{L.wsSignInTitle}</button>
              </Show>
            </div>
            <Show when={osError()}><p class="ws-error">{osError()}</p></Show>
          </div>
        </div>
      </Show>
      <Show when={!live()}><PolicyCard /></Show>{/* oda-shell (ADM-01) */}

      <Show when={live()}>
        <div class="ws-bar">
          <div class="ws-tabs" role="tablist">
            <For each={[["recent", L.wsRecent], ["shared", L.wsShared], ["starred", L.wsStarred], ["drive", L.wsMyDrive]]}>
              {([v, label]) => <button role="tab" classList={{ selected: view() === v }} onClick={() => select(v)}>{label}</button>}
            </For>
            <Show when={view() === "search"}>
              <button role="tab" class="selected">{L.wsSearchResults}</button>
            </Show>
          </div>
          <div class="ws-filters">
            <For each={[["all", L.wsAll], ["word", L.wsDocuments], ["cell", L.wsSpreadsheets], ["slide", L.wsPresentations], ["pdf", "PDF"]]}>
              {([f, label]) => (
                <button classList={{ selected: filter() === f, [`ws-f-${f}`]: true }} onClick={() => { setFilter(f); setExpanded(false); }}>{label}</button>
              )}
            </For>
          </div>
        </div>

        <Show when={view() === "drive"}>
          <div class="ws-crumbs">
            <For each={crumbs()}>
              {(c, i) => (
                <>
                  <Show when={i() > 0}><span class="sep">›</span></Show>
                  <Show when={i() < crumbs().length - 1} fallback={<span>{c.name}</span>}>
                    <a href="#" onClick={(e) => { e.preventDefault(); setFolder(c.id || null); load(); }}>{c.name}</a>
                  </Show>
                </>
              )}
            </For>
          </div>
        </Show>

        <Show when={shown().length}>
          <div class="file-list-head text-normal ws-grid">
            <div class="col-name">{L.colFileName}</div>
            <div class="col-location">{L.colLocation}</div>
            <div class="col-owner">{L.wsOwner}</div>
            <div class="col-date">{L.wsModified}</div>
          </div>
          <div class="file-list-body ws-list">
            <For each={shown()}>
              {(item) => {
                const dot = item.name.lastIndexOf(".");
                const base = item.kind === "file" && dot > 0 ? item.name.substring(0, dot) : item.name;
                const ext = item.kind === "file" && dot > 0 ? item.name.substring(dot) : "";
                return (
                  <ContextMenu>
                    <ContextMenu.Trigger as="div" class="row text-normal ws-grid" onClick={() => renaming() !== item.id && activate(item)}>
                      <div class="col-name" title={item.name}>
                        <FileIcon item={item} thumb={thumbs()[item.id]} />
                        <Show when={renaming() === item.id} fallback={<p class="name">{base}<span class="ext">{ext}</span></p>}>
                          <input class="ws-input ws-rename" value={base} spellcheck={false} aria-label={L.wsRename}
                                 ref={(el) => setTimeout(() => { el.focus(); el.select(); }, 0)}
                                 onClick={(e) => e.stopPropagation()}
                                 onKeyDown={(e) => {
                                   e.stopPropagation();
                                   if (e.key === "Enter") commitRename(item, e.currentTarget.value);
                                   if (e.key === "Escape") setRenaming(null);
                                 }}
                                 onBlur={(e) => renaming() === item.id && commitRename(item, e.currentTarget.value)} />
                        </Show>
                        <Show when={item.level === "view"}><span class="ws-badge">{L.wsViewOnly}</span></Show>
                      </div>
                      <div class="col-location" title={item.location}>{item.location}</div>
                      <div class="col-owner">{item.owner}</div>
                      <div class="col-date"><p>{when(item.modified)}</p></div>
                    </ContextMenu.Trigger>
                    <Show when={item.kind === "file"}>
                      <ContextMenu.Content><FileMenu menu={ContextMenu} item={item} /></ContextMenu.Content>
                    </Show>
                  </ContextMenu>
                );
              }}
            </For>
          </div>
        </Show>

        <Show when={state().text}>
          <p class="ws-state" classList={{ "ws-error": state().error }}>
            {state().text}
            <Show when={state().undo}>
              {" "}<a href="#" class="ws-link" onClick={(e) => { e.preventDefault(); state().undo.run(); }}>{state().undo.label}</a>
            </Show>
          </p>
        </Show>
        <Show when={!data() && !state().error}>
          <div class="ws-skeleton" aria-hidden="true"><div /><div /><div /></div>
        </Show>
        <Show when={visible().length > ROWS_SHOWN}>
          <button class="ws-more" onClick={() => setExpanded(!expanded())}>
            {expanded() ? L.wsShowFewer : L.wsShowAll.replace("$1", visible().length)}
          </button>
        </Show>
      </Show>

      <Show when={dialog() && dialog().kind === "signin"}>
        <SignInDialog desktopAccount={dialog().desktopAccount} onClose={() => setDialog(null)} />
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
