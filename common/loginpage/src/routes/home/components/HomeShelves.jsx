/*
 * Home's shelves, between Quick actions and the Files explorer:
 *   Pinned files            the pinned native recents ("recent:pinned"), as cards; search and sort; unpin
 *   Local files             the folders of the recent files on this computer (parseRecentDirs), pinned folders
 *                           first (the pinnedFolders list the Open page keeps); Browse opens the native Open dialog
 *   Connected cloud storage WorkSuite Drive accounts and the other clouds' portals (services/portals.js)
 * Previews are file-type icons: the native recents carry no thumbnails.
 */
import { For, Show, createMemo, createSignal } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { openFolder, openLocal, openRecentFile, parseRecentDirs, togglePinnedFolder } from "@/sdk";
import { portals, providers, openConnectedPortal } from "@/services/portals.js";
import { L } from "@/worksuite/lang.js";
import { pinnedFiles, homeFolders, cloudConnections } from "@/worksuite/home-logic.js";
import { EmptyState, Icon, IconButton, SearchBox, WsButton } from "@/worksuite/ui/components.jsx";
import { setHomeSession } from "@/stores/home-session.js";
import { FormatIcon } from "./RecentList.jsx";
import "./HomeShelves.styles.css";

const FOLDERS = 6;

function ShelfHead(props) {
  return (
    <div class="wsh-shelf-head">
      <h2 class="wsh-eyebrow" id={props.id}>{props.title}</h2>
      <div class="wsh-shelf-tools">{props.children}</div>
    </div>
  );
}

export function PinnedShelf(props) {
  const [query, setQuery] = createSignal("");
  const [byName, setByName] = createSignal(false);
  const all = () => (props.recents || []).filter((r) => r.pinned);
  const rows = createMemo(() => pinnedFiles(props.recents, { query: query(), sort: byName() ? { key: "name", dir: "asc" } : { key: "opened", dir: "desc" } }));
  return (
    <section class="wsh-shelf" aria-labelledby="wsh-pinned-title">
      <ShelfHead id="wsh-pinned-title" title={L.wshPinnedFiles}>
        <Show when={all().length > 3}>
          <SearchBox class="wsh-shelf-search" placeholder={L.wshSearchPinned} onSearch={setQuery} />
        </Show>
        <Show when={all().length > 1}>
          <WsButton variant="ghost" small onClick={() => setByName(!byName())}>
            <Icon name="sort" />{byName() ? L.wshSortNameAsc : L.wshSortRecent}
          </WsButton>
        </Show>
      </ShelfHead>
      <Show when={all().length} fallback={<EmptyState icon="pin" title={L.wshPinnedEmpty} text={L.wshPinnedEmptyHint} />}>
        <Show when={rows().length} fallback={<EmptyState icon="search" title={L.wshNoMatch.replace("$1", query())} text={L.wshNoMatchHint} />}>
          <ul class="wsh-tiles" role="list">
            <For each={rows()}>
              {(m) => (
                <li class={"wsh-tile" + (m.exist === false ? " is-missing" : "")}>
                  <button type="button" class="wsh-tile-main" title={m.path} onClick={() => openRecentFile(m)}>
                    <span class="wsh-tile-preview"><FormatIcon model={m} /></span>
                    <span class="wsh-tile-text">
                      <span class="wsh-tile-name">{m.name}<span class="ext">{m.ext}</span></span>
                      <span class="wsh-tile-meta">{m.exist === false ? L.wshFileMissing : m.dateLabel || m.descr}</span>
                    </span>
                  </button>
                  <IconButton class="wsh-tile-action" icon="pin-on" label={L.wshUnpin} pressed={true} onClick={() => props.onTogglePin(m.fileid)} />
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>
    </section>
  );
}

export function LocalShelf(props) {
  const [tick, setTick] = createSignal(0);
  const [all, setAll] = createSignal(false);
  const dirs = createMemo(() => {
    tick();
    return parseRecentDirs((props.recents || []).filter((r) => r.islocal), (k) => (k === "textMyComputer" ? L.wshThisComputer : k));
  });
  const view = () => homeFolders(dirs(), all() ? Infinity : FOLDERS);
  return (
    <section class="wsh-shelf" aria-labelledby="wsh-local-title">
      <ShelfHead id="wsh-local-title" title={L.wshLocalFiles}>
        <WsButton variant="secondary" small onClick={openLocal}><Icon name="folder" />{L.wshBrowse}</WsButton>
      </ShelfHead>
      <Show when={dirs().length} fallback={<EmptyState icon="computer" title={L.wshLocalEmpty} text={L.wshLocalEmptyHint}
                                                        action={<WsButton variant="primary" onClick={openLocal}>{L.wshOpenFile}</WsButton>} />}>
        <ul class="wsh-tiles wsh-tiles-folders" role="list">
          <For each={view().shown}>
            {(d) => (
              <li class="wsh-tile">
                <button type="button" class="wsh-tile-main" title={d.full} onClick={() => openFolder(d.full)}>
                  <span class="wsh-tile-preview is-folder"><Icon name="folder" /></span>
                  <span class="wsh-tile-text">
                    <span class="wsh-tile-name">{d.name}</span>
                    <span class="wsh-tile-meta">{d.descr}</span>
                  </span>
                </button>
                <IconButton class="wsh-tile-action" icon={d.pinned ? "pin-on" : "pin"} label={d.pinned ? L.wshUnpinFolder : L.wshPinFolder}
                            pressed={d.pinned} onClick={() => { togglePinnedFolder(d.full); setTick(tick() + 1); }} />
              </li>
            )}
          </For>
        </ul>
        <Show when={view().more && !all()}>
          <div><WsButton variant="link" onClick={() => setAll(true)}>{L.wshAllFolders.replace("$1", view().more)}</WsButton></div>
        </Show>
      </Show>
    </section>
  );
}

export function CloudShelf(props) {
  const navigate = useNavigate();
  const ws = () => window.WorkSuite;
  const providerName = (id) => (providers().find((p) => p.provider === id) || {}).name || "";
  const list = createMemo(() => {
    const accounts = props.version >= 0 && ws() ? ws().accounts() : []; // props.version: re-read when WorkSuite's accounts change
    return cloudConnections(accounts, portals(), { driveLabel: L.wsTitle, providerName });
  });
  function open(c) {
    if (c.kind === "portal") return openConnectedPortal(c.portal);
    setHomeSession("files", "tab", "drive");
    if (props.onShowDrive) props.onShowDrive();
  }
  return (
    <section class="wsh-shelf" aria-labelledby="wsh-clouds-title">
      <ShelfHead id="wsh-clouds-title" title={L.wshClouds}>
        <WsButton variant="secondary" small onClick={() => navigate("/clouds")}>
          <Icon name={list().length ? "settings" : "plus"} />{list().length ? L.wshManageClouds : L.wshConnectCloud}
        </WsButton>
      </ShelfHead>
      <Show when={list().length} fallback={<EmptyState icon="cloud" title={L.wshCloudsEmpty} text={L.wshCloudsEmptyHint}
                                                        action={<WsButton variant="primary" onClick={() => navigate("/clouds")}>{L.wshConnectCloud}</WsButton>} />}>
        <ul class="wsh-tiles" role="list">
          <For each={list()}>
            {(c) => (
              <li class="wsh-tile">
                <button type="button" class="wsh-tile-main" title={c.detail} onClick={() => open(c)}>
                  <span class="wsh-tile-preview is-cloud"><Icon name={c.kind === "drive" ? "drive" : "cloud"} /></span>
                  <span class="wsh-tile-text">
                    <span class="wsh-tile-name">{c.name}</span>
                    <span class="wsh-tile-meta">
                      <span class={"wsh-dot" + (c.status === "connected" ? " is-on" : "")} aria-hidden="true" />
                      {c.status === "connected" ? L.wshCloudConnected : L.wshCloudSignedOut} · {c.detail}
                    </span>
                  </span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}
