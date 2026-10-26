/*
 * Recent files (local and cloud, from the native recents list): search, type and place filters, sort by last
 * opened or name, list or grid, open, show in folder, pin, Remove from Recent and Clear recent history
 * (confirmed). The native commands are unchanged: LocalFileRemoveRecent, LocalFileRemoveAllRecents,
 * "recent:pinned", openRecentFile / exploreFile.
 */
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { exploreFile, openRecentFile } from "@/sdk";
import { ContextMenu, DropdownMenu } from "@/components";
import { usePngIcons } from "@/services/display";
import { appliedUseAi } from "@/services/settings-sync";
import { L } from "@/worksuite/lang.js";
import { filterFiles, nextPage, sortFiles } from "@/worksuite/home-logic.js";
import { ConfirmDialog, EmptyState, Icon, IconButton, LayoutToggle, SearchBox, TypeChips, WsButton } from "@/worksuite/ui/components.jsx";
import { homeSession, setHomeSession } from "@/stores/home-session.js";
import "./RecentList.styles.css";

const PAGE = 60;

function FileMenuItems(props) {
  const Menu = props.menu;
  return (
    <>
      <Menu.Item onSelect={() => openRecentFile(props.model)}>{L.menuFileOpen}</Menu.Item>
      <Show when={props.model.islocal && appliedUseAi()}>
        <Menu.Item icon="#aichat20" onSelect={() => props.onAddToChat(props.model)}>{L.wshAiChat}</Menu.Item>
      </Show>
      <Show when={props.model.islocal}>
        <Menu.Item icon="#gofolder" onSelect={() => exploreFile(props.model)}>{L.wshShowInFolder}</Menu.Item>
      </Show>
      <Menu.Item icon={props.model.pinned ? "#unpin20" : "#pin20"} onSelect={() => props.onTogglePin(props.model.fileid)}>
        {props.model.pinned ? L.wshUnpin : L.wshPin}
      </Menu.Item>
      <Menu.Item icon="#remove" onSelect={() => props.onRemove(props.model.fileid)}>{L.wshRemoveRecent}</Menu.Item>
      <Menu.Separator />
      <Menu.Item class="negative" onSelect={props.onClear}>{L.wshClearHistory}</Menu.Item>
    </>
  );
}

function FormatIcon(props) {
  return (
    <span class="wsh-recent-icon" aria-hidden="true">
      <Show when={usePngIcons()} fallback={<svg class="icon"><use href={`#${props.model.format}`} /></svg>}>
        <i class={`doc-format ${props.model.format}`} />
      </Show>
      <Show when={props.model.crypted}><svg class="icon shield"><use href="#shield" /></svg></Show>
    </span>
  );
}

function RecentItem(props) {
  const m = () => props.model;
  const grid = () => props.layout === "grid";
  const menuProps = () => ({ model: m(), onAddToChat: props.onAddToChat, onTogglePin: props.onTogglePin, onRemove: props.onRemove, onClear: props.onClear });
  return (
    <ContextMenu>
      <ContextMenu.Trigger as="div" role="row" tabindex="0" data-row
                           class={grid() ? "wsh-card wsh-recent-card" : "wsh-row wsh-recent-row"}
                           classList={{ "is-missing": m().exist === false, "is-pinned": m().pinned }}
                           onClick={() => openRecentFile(m())}
                           onKeyDown={(e) => {
                             if (e.key === "Enter") { e.preventDefault(); openRecentFile(m()); }
                             else if (e.key === "Delete") props.onRemove(m().fileid);
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
              <Show when={m().exist === false}><span class="ws-badge">{L.wshFileMissing}</span></Show>
            </span>
            <span class="wsh-col-loc wsx-ellipsis" role="gridcell" title={m().descr}>
              <Icon name={m().islocal ? "computer" : "cloud"} class="wsh-place" />{m().descr}
            </span>
            <span class="wsh-col-date" role="gridcell" title={m().date}>{m().dateLabel}</span>
          </>
        }>
          <div class="wsh-card-thumb"><FormatIcon model={m()} /></div>
          <div class="wsh-card-text">
            <span class="wsh-name wsx-ellipsis" title={m().fullName}>{m().name}<span class="ext">{m().ext}</span></span>
            <span class="wsx-hint wsx-ellipsis" title={m().descr}>{m().exist === false ? L.wshFileMissing : m().dateLabel}</span>
          </div>
        </Show>
        <div class="wsh-row-actions" onClick={(e) => e.stopPropagation()}>
          <IconButton icon={m().pinned ? "pin-on" : "pin"} label={m().pinned ? L.wshUnpin : L.wshPin} class={m().pinned ? "is-starred" : ""}
                      onClick={() => props.onTogglePin(m().fileid)} />
          <IconButton icon="x" label={L.wshRemoveRecent} onClick={() => props.onRemove(m().fileid)} />
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

export function RecentList(props) {
  const [query, setQuery] = createSignal("");
  const [confirm, setConfirm] = createSignal(false);
  const [shownCount, setShownCount] = createSignal(PAGE);
  let sentinel;
  const prefs = () => homeSession.recents;
  const all = () => props.recents || [];
  const hasCloud = () => all().some((r) => !r.islocal);

  const list = createMemo(() => {
    const found = filterFiles(all(), { query: query(), type: prefs().type, source: hasCloud() ? prefs().source : "all" });
    const sorted = sortFiles(found, prefs().sort);
    return sorted.filter((r) => r.pinned).concat(sorted.filter((r) => !r.pinned));
  });
  const shown = () => list().slice(0, shownCount());
  const filtered = () => !!query() || prefs().type !== "all" || (hasCloud() && prefs().source !== "all");

  createEffect(() => {
    query(); prefs().type; prefs().source;
    setShownCount(PAGE);
  });
  createEffect(() => {
    if (!sentinel || shownCount() >= list().length) return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setShownCount(nextPage(shownCount(), list().length, PAGE)), { rootMargin: "400px" });
    io.observe(sentinel);
    onCleanup(() => io.disconnect());
  });

  const clearAsked = () => setConfirm(true);

  return (
    <section class="wsh-recents" aria-labelledby="wsh-recents-title">
      <div class="wsh-head">
        <h2 class="wsh-h2" id="wsh-recents-title">{props.heading || L.wshRecentFiles}</h2>
        <div class="wsh-head-tools">
          <Show when={all().length}>
            <SearchBox class="wsh-search" placeholder={L.wshSearchRecent} delay={150} onSearch={setQuery} />
          </Show>
          <WsButton variant="secondary" onClick={props.onOpenFile}>{L.wshOpenFile}</WsButton>
        </div>
      </div>

      <Show when={all().length}>
        <div class="wsh-bar">
          <div class="wsh-bar-tools wsh-bar-start">
            <TypeChips value={prefs().type} onChange={(t) => setHomeSession("recents", "type", t)} />
            <Show when={hasCloud()}>
              <div class="wsx-chips" role="group" aria-label={L.wshSource}>
                <For each={[["all", L.wshAllPlaces], ["local", L.wshThisComputer], ["cloud", L.wshCloud]]}>
                  {([v, label]) => (
                    <button type="button" class="wsx-chip-btn" aria-pressed={prefs().source === v ? "true" : "false"}
                            onClick={() => setHomeSession("recents", "source", v)}>{label}</button>
                  )}
                </For>
              </div>
            </Show>
          </div>
          <div class="wsh-bar-tools">
            <DropdownMenu>
              <DropdownMenu.Trigger class="wsx-btn wsx-btn-ghost wsx-btn-sm">
                <Icon name="sort" /><span>{prefs().sort.key === "name" ? L.wshName : L.wshLastOpened}</span>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content>
                <DropdownMenu.Item onSelect={() => setHomeSession("recents", "sort", { key: "opened", dir: "desc" })}>{L.wshLastOpened}</DropdownMenu.Item>
                <DropdownMenu.Item onSelect={() => setHomeSession("recents", "sort", { key: "name", dir: "asc" })}>{L.wshName}</DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu>
            <LayoutToggle value={prefs().layout} onChange={(v) => setHomeSession("recents", "layout", v)} />
            <WsButton small variant="ghost" icon="history" onClick={clearAsked}>{L.wshClearHistory}</WsButton>
          </div>
        </div>
      </Show>

      <Show when={list().length} fallback={
        <Show when={props.loaded}>
          <Show when={filtered()} fallback={props.empty || <EmptyState icon="history" title={L.wshNoRecent} text={L.wshNoRecentHint} />}>
            <EmptyState icon="search" title={L.wshNoRecentMatch}
                        action={<WsButton small variant="secondary" onClick={() => { setHomeSession("recents", "type", "all"); setHomeSession("recents", "source", "all"); }}>{L.wshShowAllTypes}</WsButton>} />
          </Show>
        </Show>
      }>
        <div class={prefs().layout === "grid" ? "wsh-grid" : "wsh-table wsh-recent-table"} role="grid" aria-labelledby="wsh-recents-title">
          <Show when={prefs().layout === "list"}>
            <div class="wsh-row wsh-row-head wsh-recent-row" role="row">
              <span class="wsh-col-name" role="columnheader">{L.wshName}</span>
              <span class="wsh-col-loc" role="columnheader">{L.colLocation}</span>
              <span class="wsh-col-date" role="columnheader">{L.wshLastOpened}</span>
              <span class="wsh-row-actions" />
            </div>
          </Show>
          <For each={shown()}>
            {(model) => <RecentItem model={model} layout={prefs().layout} onTogglePin={props.onTogglePin} onRemove={props.onRemove}
                                    onClear={clearAsked} onAddToChat={props.onAddToChat} />}
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
