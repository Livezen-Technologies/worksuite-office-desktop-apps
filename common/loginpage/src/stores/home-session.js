/*
 * The home screen's view state for this app session (sessionStorage): Drive tab, filters, sort and layout,
 * the recent files' filters, and the page's scroll position, so they are as they were when the person comes
 * back from an editor or another panel. Nothing here is account data.
 */
import { createStore } from "solid-js/store";

const KEY = "ws:home:session";

const DEFAULTS = {
  drive: { view: "recent", type: "all", sort: { key: "modified", dir: "desc" }, layout: "list" },
  recents: { type: "all", source: "all", sort: { key: "opened", dir: "desc" }, layout: "list" },
  scrollTop: 0,
};

function load() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) || "null");
    if (saved && typeof saved === "object")
      return { drive: { ...DEFAULTS.drive, ...saved.drive }, recents: { ...DEFAULTS.recents, ...saved.recents }, scrollTop: Number(saved.scrollTop) || 0 };
  } catch {}
  return structuredClone(DEFAULTS);
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

/* setHomeSession("drive", "type", "word") — the store's path setter, persisted */
export function setHomeSession(...args) {
  setStore(...args);
  persist();
}
