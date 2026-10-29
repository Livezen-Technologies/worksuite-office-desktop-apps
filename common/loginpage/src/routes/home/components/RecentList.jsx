/*
 * The Files explorer's Recent and This Computer tabs (FilesExplorer.jsx).
 *   Recent: the native recents (local files and other clouds' documents) and WorkSuite Drive's recently opened
 *           files (props.driveItems), one list (mergeRecents), filtered by source.
 *   This Computer (tab "local"): the native recents that are files on this computer.
 * Columns: Name | Location | Owner | Last opened | Actions. Open, show in folder, pin, Remove from Recent and
 * Clear recent history (confirmed) use the native commands as before (LocalFileRemoveRecent,
 * LocalFileRemoveAllRecents, "recent:pinned", openRecentFile / exploreFile); a Drive row opens with WorkSuite.
 */
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { exploreFile, openRecentFile } from "@/sdk";
import { ContextMenu, DropdownMenu } from "@/components";
import { usePngIcons } from "@/services/display";
import { appliedUseAi } from "@/services/settings-sync";
import { L } from "@/worksuite/lang.js";
import { when } from "@/worksuite/cards.jsx";
import { filterFiles, mergeRecents, nextPage, nextSort, sortFiles } from "@/worksuite/home-logic.js";
import { FilesToolbar } from "@/worksuite/FilesToolbar.jsx";
import { ConfirmDialog, EmptyState, Icon, IconButton, WsButton } from "@/worksuite/ui/components.jsx";
import { homeSession, setHomeSession } from "@/stores/home-session.js";
import "./RecentList.styles.css";

const PAGE = 60;
const FORMAT_ICONS = ["csv", "djvu", "doc", "docm", "docx", "docxf", "dotm", "dotx", "epub", "fb2", "fodp", "fods", "fodt", "html", "md",
  "odp", "ods", "odt", "otp", "ots", "ott", "pdf", "potm", "potx", "pps", "ppsm", "ppsx", "ppt", "pptm", "pptx", "rtf", "txt", "xls",
  "xlsb", "xlsm", "xlsx", "xltm", "xltx"];

function FileMenuItems(props) {
  const Menu = props.menu;
  const m = () => props.model;
  return (
    <Show when={m().source !== "drive"} fallback={
      <>
        <Menu.Item onSelect={() => props.onOpen(m())}>{L.menuFileOpen}</Menu.Item>
        <Menu.Item onSelect={() => props.onStar(m())}>{m().starred ? L.wsUnstar : L.wsStar}</Menu.Item>
        <Menu.Item onSelect={() => props.onBrowser(m())}>{L.wsOpenInBrowserItem}</Menu.Item>
      </>
    }>
      <Menu.Item onSelect={() => props.onOpen(m())}>{L.menuFileOpen}</Menu.Item>
      <Show when={m().islocal && appliedUseAi()}>
        <Menu.Item icon="#aichat20" onSelect={() => props.onAddToChat(m())}>{L.wshAiChat}</Menu.Item>
      </Show>
      <Show when={m().islocal}>
        <Menu.Item icon="#gofolder" onSelect={() => exploreFile(m())}>{L.wshShowInFolder}</Menu.Item>
      </Show>
      <Menu.Item icon={m().pinned ? "#unpin20" : "#pin20"} onSelect={() => props.onTogglePin(m().fileid)}>
        {m().pinned ? L.wshUnpin : L.wshPin}
      </Menu.Item>
      <Menu.Item icon="#remove" onSelect={() => props.onRemove(m().fileid)}>{L.wshRemoveRecent}</Menu.Item>
      <Menu.Separator />
      <Menu.Item class="negative" onSelect={props.onClear}>{L.wshClearHistory}</Menu.Item>
    </Show>
  );
}

function FormatIcon(props) {
  const format = () => {
    if (props.model.source !== "drive") return props.model.format;
    const ext = String(props.model.ext || "").replace(/^\./, "").toLowerCase();
    return FORMAT_ICONS.includes(ext) ? ext : "neutral";
  };
  return (
    <span class="wsh-recent-icon" aria-hidden="true">
      <Show when={usePngIcons()} fallback={<svg class="icon"><use href={`#${format()}`} /></svg>}>
        <i class={`doc-format ${format()}`} />
      </Show>
      <Show when={props.model.crypted}><svg class="icon shield"><use href="#shield" /></svg></Show>
    </span>
  );
}

function RecentItem(props) {
  const m = () => props.model;
  const grid = () => props.layout === "grid";
  const drive = () => m().source === "drive";
  const menuProps = () => ({ model: m(), onOpen: props.onOpen, onStar: props.onStar, onBrowser: props.onBrowser, onAddToChat: props.onAddToChat,
                             onTogglePin: props.onTogglePin, onRemove: props.onRemove, onClear: props.onClear });
  const dateLabel = () => (drive() ? when(m().date) : m().dateLabel);
  return (
    <ContextMenu>
      <ContextMenu.Trigger as="div" role="row" tabindex="0" data-row
                           class={grid() ? "wsh-card wsh-recent-card" : "wsh-row wsh-recent-row"}
                           classList={{ "is-missing": m().exist === false, "is-pinned": m().pinned }}
                           onClick={() => props.onOpen(m())}
                           onKeyDown={(e) => {
                             if (e.target !== e.currentTarget) return;
                             if (e.key === "Enter") { e.preventDefault(); props.onOpen(m()); }
                             else if (e.key === "Delete" && !drive()) props.onRemove(m().fileid);
                             else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                               e.preventDefault();
                               const rows = [...e.currentTarget.parentElement.querySelectorAll("[data-row]")];
                               const i = rows.indexOf(e.currentTarget) + (e.key === "ArrowDown" ? 1 : -1);
                               rows[i] && rows[i].focus();
                             }
                           }}>
        <Show when={grid()} fallback={
          <>
            <span class="wsh-col-name" role="gridcell" title={m().fullName}>
              <FormatIcon model={m()} />
              <span class="wsh-name wsx-ellipsis">{m().name}<span class="ext">{m().ext}</span></span>
              <Show when={m().pinned}><Icon name="pin-on" class="wsh-pin-mark" /></Show>
              <Show when={drive() && m().starred}><Icon name="star-on" class="wsh-star-mark" /></Show>
              <Show when={m().exist === false}><span class="ws-badge">{L.wshFileMissing}</span></Show>
            </span>
            <span class="wsh-col-loc" role="gridcell" title={m().descr}>
              <Icon name={drive() ? "drive" : m().islocal ? "computer" : "cloud"} class="wsh-place" />
              <span class="wsx-ellipsis">{m().descr}</span>
            </span>
            <span class="wsh-col-owner wsx-ellipsis" role="gridcell">{m().owner || "—"}</span>
            <span class="wsh-col-date" role="gridcell" title={m().date}>{dateLabel()}</span>
          </>
        }>
          <div class="wsh-card-thumb"><FormatIcon model={m()} /></div>
          <div class="wsh-card-text">
            <span class="wsh-name wsx-ellipsis" title={m().fullName}>{m().name}<span class="ext">{m().ext}</span></span>
            <span class="wsx-hint wsx-ellipsis" title={m().descr}>{m().exist === false ? L.wshFileMissing : dateLabel()}</span>
          </div>
        </Show>
        <div class="wsh-row-actions" onClick={(e) => e.stopPropagation()}>
          <Show when={!drive()} fallback={
            <IconButton icon={m().starred ? "star-on" : "star"} label={m().starred ? L.wsUnstar : L.wsStar} class={m().starred ? "is-starred" : ""}
                        onClick={() => props.onStar(m())} />
          }>
            <IconButton icon={m().pinned ? "pin-on" : "pin"} label={m().pinned ? L.wshUnpin : L.wshPin} class={m().pinned ? "is-starred" : ""}
                        onClick={() => props.onTogglePin(m().fileid)} />
            <IconButton icon="x" label={L.wshRemoveRecent} onClick={() => props.onRemove(m().fileid)} />
          </Show>
          <DropdownMenu>
            <DropdownMenu.Trigger class="wsx-btn wsx-btn-ghost wsx-btn-sm wsx-btn-icon" aria-label={L.wsxMoreActions.replace("$1", m().fullName)}>
              <Icon name="more" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Content><FileMenuItems menu={DropdownMenu} {...menuProps()} /></DropdownMenu.Content>
          </DropdownMenu>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Content><FileMenuItems menu={ContextMenu} {...menuProps()} /></ContextMenu.Content>
    </ContextMenu>
  );
}

/*
 * props: tab ("recent" | "local"), recents (native), loaded, driveItems, driveServers, driveError, onOpenDrive(item),
 * onStarDrive(item), onBrowserDrive(item), onTogglePin, onRemove, onClear, onAddToChat, onOpenFile, onRefresh, empty
 */
export function RecentList(props) {
  const [confirm, setConfirm] = createSignal(false);
  const [shownCount, setShownCount] = createSignal(PAGE);
  let sentinel;
  const tab = () => props.tab || "recent";
  const prefs = () => homeSession.files[tab()];
  const set = (...a) => setHomeSession("files", tab(), ...a);

  const all = createMemo(() => {
    const native = (props.recents || []).filter((r) => tab() !== "local" || r.islocal !== false);
    return mergeRecents(native, tab() === "recent" ? props.driveItems || [] : [], { servers: props.driveServers || [], driveLabel: L.wsfSourceDrive });
  });
  const sources = createMemo(() => {
    if (tab() !== "recent") return null;
    const has = (s) => all().some((r) => r.source === s);
    const out = [["all", L.wsfSourceAll], ["local", L.wsfSourceLocal]];
    if (has("drive") || (props.driveItems && props.driveItems.length)) out.push(["drive", L.wsfSourceDrive]);
    if (has("cloud")) out.push(["cloud", L.wsfSourceCloud]);
    return out;
  });
  const source = () => (sources() && sources().some(([v]) => v === prefs().source) ? prefs().source : "all");

  const list = createMemo(() => {
    const found = filterFiles(all(), { query: prefs().query, type: prefs().type, source: source() });
    const sorted = sortFiles(found, prefs().sort);
    return sorted.filter((r) => r.pinned).concat(sorted.filter((r) => !r.pinned));
  });
  const shown = () => list().slice(0, shownCount());
  const filtered = () => !!prefs().query || prefs().type !== "all" || source() !== "all";

  createEffect(() => {
    prefs().query; prefs().type; source();
    setShownCount(PAGE);
  });
  createEffect(() => {
    if (!sentinel || shownCount() >= list().length) return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setShownCount(nextPage(shownCount(), list().length, PAGE)), { rootMargin: "400px" });
    io.observe(sentinel);
    onCleanup(() => io.disconnect());
  });

  const open = (m) => (m.source === "drive" ? props.onOpenDrive(m.drive) : openRecentFile(m));
  const star = (m) => props.onStarDrive(m.drive);
  const browser = (m) => props.onBrowserDrive(m.drive);
  const clearAsked = () => setConfirm(true);
  const sorts = () => [["opened", L.wshLastOpened], ["name", L.wshName], ["type", L.wshType]];

  return (
    <section class="wsh-recents" aria-label={tab() === "local" ? L.wshThisComputer : L.wsRecent}>
      <FilesToolbar placeholder={tab() === "local" ? L.wsfSearchLocal : L.wshSearchRecent} query={prefs().query} onSearch={(q) => set("query", q)}
                    type={prefs().type} onType={(t) => set("type", t)}
                    sources={sources()} source={source()} onSource={(s) => set("source", s)}
                    sorts={sorts()} sort={prefs().sort} onSort={(k) => set("sort", nextSort(prefs().sort, k))}
                    layout={prefs().layout} onLayout={(v) => set("layout", v)} onRefresh={props.onRefresh}>
        <Show when={all().some((r) => r.source !== "drive")}>
          <IconButton icon="history" label={L.wshClearHistory} onClick={clearAsked} />
        </Show>
        <WsButton variant="primary" icon="folder" onClick={props.onOpenFile}>{L.wshOpenFile}</WsButton>
      </FilesToolbar>

      <Show when={tab() === "recent" && props.driveError}>
        <div class="wsh-banner" role="status"><span>{L.wsfDriveRecentFailed}</span></div>
      </Show>

      <Show when={list().length} fallback={
        <Show when={props.loaded}>
          <Show when={filtered()} fallback={
            tab() === "local" ? <EmptyState icon="computer" title={L.wsfNoLocal} text={L.wsfNoLocalHint}
                                            action={<WsButton small variant="secondary" onClick={props.onOpenFile}>{L.wshOpenFile}</WsButton>} />
                              : props.empty || <EmptyState icon="history" title={L.wshNoRecent} text={L.wshNoRecentHint} />
          }>
            <EmptyState icon="search" title={L.wshNoRecentMatch}
                        action={<WsButton small variant="secondary" onClick={() => { set("query", ""); set("type", "all"); set("source", "all"); }}>{L.wshShowAllTypes}</WsButton>} />
          </Show>
        </Show>
      }>
        <div class={prefs().layout === "grid" ? "wsh-grid" : "wsh-table wsh-recent-table"} role="grid"
             aria-label={tab() === "local" ? L.wshThisComputer : L.wsRecent}>
          <Show when={prefs().layout === "list"}>
            <div class="wsh-row wsh-row-head wsh-recent-row" role="row">
              <span class="wsh-col-name" role="columnheader">{L.wshName}</span>
              <span class="wsh-col-loc" role="columnheader">{L.colLocation}</span>
              <span class="wsh-col-owner" role="columnheader">{L.wsOwner}</span>
              <span class="wsh-col-date" role="columnheader">{L.wshLastOpened}</span>
              <span class="wsh-row-actions" role="columnheader"><span class="wsx-visually-hidden">{L.wsfActions}</span></span>
            </div>
          </Show>
          <For each={shown()}>
            {(model) => <RecentItem model={model} layout={prefs().layout} onOpen={open} onStar={star} onBrowser={browser}
                                    onTogglePin={props.onTogglePin} onRemove={props.onRemove} onClear={clearAsked} onAddToChat={props.onAddToChat} />}
          </For>
        </div>
        <Show when={shownCount() < list().length}>
          <div class="wsh-foot">
            <span ref={(el) => (sentinel = el)} class="wsh-sentinel" aria-hidden="true" />
            <WsButton small variant="secondary" onClick={() => setShownCount(nextPage(shownCount(), list().length, PAGE))}>
              {L.wshShowMore.replace("$1", list().length - shownCount())}
            </WsButton>
          </div>
        </Show>
      </Show>

      <Show when={confirm()}>
        <ConfirmDialog title={L.wshClearHistoryTitle} text={L.wshClearHistoryText} confirmLabel={L.wshClear} danger
                       onConfirm={() => { setConfirm(false); props.onClear(); }} onClose={() => setConfirm(false)} />
      </Show>
    </section>
  );
}
