/*
 * The home screen's one file explorer (issue #30): tabs Recent | My Drive | Shared with me | Starred | This Computer,
 * one list at a time under one sticky tab bar and toolbar. Where each tab's files come from:
 *   Recent        the native recent files (this computer and other clouds) + WorkSuite Drive's recently opened
 *                 files (GET /api/drive/list?view=recent), merged without duplicates (mergeRecents)
 *   My Drive      WorkSuite Drive's folders (/api/files/browse), search (/api/files/search)
 *   Shared        WorkSuite Drive's view=shared
 *   Starred       WorkSuite Drive's view=starred
 *   This Computer the native recent files that are on this computer
 * A tab's panel is created the first time it is shown and kept, so its search, filters, sort, layout and
 * scroll position stay as they were; its data is loaded only when it is shown.
 */
import { For, Show, createEffect, createSignal, on, onCleanup, onMount, untrack } from "solid-js";
import { L } from "@/worksuite/lang.js";
import WorkSuiteSection from "@/worksuite/WorkSuiteSection.jsx";
import { homeSession, setHomeSession, FILE_TABS } from "@/stores/home-session.js";
import { RecentList } from "./RecentList.jsx";

const WS = () => window.WorkSuite;
const DRIVE_TABS = ["drive", "shared", "starred"];
const FRESH_MS = 60 * 1000;

export function FilesExplorer(props) {
  const tab = () => (FILE_TABS.includes(homeSession.files.tab) ? homeSession.files.tab : "recent");
  const labels = () => ({ recent: L.wsRecent, drive: L.wsMyDrive, shared: L.wsShared, starred: L.wsStarred, local: L.wshThisComputer });
  const [visited, setVisited] = createSignal({ [tab()]: true });
  const [driveRecent, setDriveRecent] = createSignal([]);
  const [driveServers, setDriveServers] = createSignal([]);
  const [driveError, setDriveError] = createSignal(false);
  const [note, setNote] = createSignal("");
  let root, recentAt = 0, recentSeq = 0;

  /* ---- the Recent tab's WorkSuite Drive part ---- */
  async function loadDriveRecent(force) {
    const ws = WS();
    const acc = ws && ws.active();
    if (!acc || acc.signedOut) {
      setDriveRecent([]);
      setDriveServers([]);
      setDriveError(false);
      return;
    }
    setDriveServers(ws.accounts().filter((a) => !a.signedOut).map((a) => a.server));
    const cached = ws.cached(acc, "recent", {});
    if (cached && cached.items) setDriveRecent(cached.items);
    if (!force && Date.now() - recentAt < FRESH_MS) return;
    const mine = ++recentSeq;
    try {
      const fresh = await ws.list(acc, "recent", {});
      if (mine !== recentSeq) return;
      recentAt = Date.now();
      setDriveRecent(fresh.items || []);
      setDriveError(false);
    } catch (e) {
      if (mine === recentSeq && !e.signedOut) setDriveError(true);
      if (e.signedOut) setDriveRecent([]);
    }
  }
  const driveAccount = () => WS() && WS().active();
  const openDrive = (item) => WS().open(driveAccount(), item).catch((e) => !e.signedOut && setNote(e.message));
  const starDrive = (item) => WS().star(driveAccount(), item, !item.starred).then(() => loadDriveRecent(true), (e) => !e.signedOut && setNote(e.message));
  const browserDrive = (item) => WS().openInBrowser(driveAccount(), "/files?file=" + encodeURIComponent(item.id));

  createEffect(on(tab, (t) => { if (t === "recent") untrack(() => loadDriveRecent(false)); }));

  onMount(() => {
    const ws = WS();
    if (!ws) return;
    const changed = () => {
      recentAt = 0;
      if (tab() === "recent") loadDriveRecent(true);
    };
    ws.on("changed", changed);
    ws.on("signedin", changed);
    onCleanup(() => {
      ws.off("changed", changed);
      ws.off("signedin", changed);
    });
  });

  /* ---- tabs: one scroll position each ---- */
  const page = () => root && root.closest(".home-page");
  function select(t) {
    if (t === tab()) return;
    const p = page();
    const top = root ? root.offsetTop : 0;
    if (p) setHomeSession("scroll", tab(), Math.max(0, p.scrollTop - top));
    setNote("");
    setVisited((v) => ({ ...v, [t]: true }));
    setHomeSession("files", "tab", t);
    requestAnimationFrame(() => {
      const q = page();
      if (!q || q.scrollTop < top) return;
      q.scrollTop = top + (homeSession.scroll[t] || 0);
    });
  }
  function onTabKey(e) {
    const i = FILE_TABS.indexOf(tab());
    const rtl = document.body.classList.contains("rtl") ? -1 : 1;
    const j = { ArrowRight: i + rtl, ArrowLeft: i - rtl, Home: 0, End: FILE_TABS.length - 1 }[e.key];
    if (j === undefined) return;
    e.preventDefault();
    const k = (j + FILE_TABS.length) % FILE_TABS.length;
    select(FILE_TABS[k]);
    e.currentTarget.querySelectorAll("[role=tab]")[k].focus();
  }

  return (
    <section class="wsf" ref={(el) => (root = el)} aria-labelledby="wsf-title">
      <div class="wsf-head">
        <h2 class="wsh-h2" id="wsf-title">{L.wsfTitle}</h2>
      </div>
      <div class="wsf-tabs" role="tablist" aria-label={L.wsfTabs} onKeyDown={onTabKey}>
        <For each={FILE_TABS}>
          {(t) => (
            <button type="button" role="tab" id={"wsf-tab-" + t} aria-controls={"wsf-panel-" + t} data-tab={t}
                    aria-selected={tab() === t ? "true" : "false"} tabindex={tab() === t ? 0 : -1} onClick={() => select(t)}>
              {labels()[t]}
            </button>
          )}
        </For>
      </div>

      <Show when={note()}>
        <p class="ws-state ws-error wsf-note" role="alert">{note()}</p>
      </Show>

      <For each={["recent", "local"]}>
        {(t) => (
          <Show when={visited()[t]}>
            <div class="wsf-panel" role="tabpanel" id={"wsf-panel-" + t} aria-labelledby={"wsf-tab-" + t} hidden={tab() !== t}>
              <RecentList tab={t} recents={props.recents} loaded={props.loaded}
                          driveItems={driveRecent()} driveServers={driveServers()} driveError={driveError()}
                          onOpenDrive={openDrive} onStarDrive={starDrive} onBrowserDrive={browserDrive}
                          onTogglePin={props.onTogglePin} onRemove={props.onRemove} onClear={props.onClear} onAddToChat={props.onAddToChat}
                          onOpenFile={props.onOpenFile} empty={props.empty}
                          onRefresh={() => Promise.all([props.onRefresh && props.onRefresh(), t === "recent" ? loadDriveRecent(true) : null])} />
            </div>
          </Show>
        )}
      </For>
      {/* always there: it also answers worksuiteoffice:// links and an editor's Share */}
      <div class="wsf-panel" role="tabpanel" id={"wsf-panel-drive"} aria-labelledby={"wsf-tab-" + (DRIVE_TABS.includes(tab()) ? tab() : "drive")}
           hidden={!DRIVE_TABS.includes(tab())}>
        <WorkSuiteSection tab={DRIVE_TABS.includes(tab()) ? tab() : "drive"} active={DRIVE_TABS.includes(tab())} onTab={select} />
      </div>
    </section>
  );
}
