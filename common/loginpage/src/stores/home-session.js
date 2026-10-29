/*
 * The home screen's view state for this app session (sessionStorage): Files tab and each tab's
 * search, filters, sort and layout, and the page's scroll position, so they are as they were when the person comes
 * back from an editor or another panel. Nothing here is account data.
 */
import { createStore } from "solid-js/store";

const KEY = "ws:home:session";

const local = () => ({ query: "", type: "all", source: "all", sort: { key: "opened", dir: "desc" }, layout: "list" });
const drive = () => ({ query: "", type: "all", sort: { key: "modified", dir: "desc" }, layout: "list" });

/* the Files explorer: the tab shown, and each tab's own search, filters, sort, layout and scroll */
const DEFAULTS = {
  files: { tab: "recent", recent: local(), local: local(), drive: drive(), shared: drive(), starred: drive() },
  scroll: {},
  scrollTop: 0,
};
export const FILE_TABS = ["recent", "drive", "shared", "starred", "local"];

function load() {
  const out = structuredClone(DEFAULTS);
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) || "null");
    if (saved && typeof saved === "object" && saved.files) {
      if (FILE_TABS.includes(saved.files.tab)) out.files.tab = saved.files.tab;
      for (const t of FILE_TABS) out.files[t] = { ...out.files[t], ...saved.files[t] };
      out.scroll = saved.scroll && typeof saved.scroll === "object" ? saved.scroll : {};
      out.scrollTop = Number(saved.scrollTop) || 0;
    }
  } catch {}
  return out;
}

const [homeSession, setStore] = createStore(load());
export { homeSession };

let timer = null;
function persist() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try { sessionStorage.setItem(KEY, JSON.stringify(homeSession)); } catch {}
  }, 150);
}

/* setHomeSession("files", "drive", "type", "word") — the store's path setter, persisted */
export function setHomeSession(...args) {
  setStore(...args);
  persist();
}
