/*
 * Where templates come from, and the existing commands that turn one into a new document:
 * - the online gallery (templates.onlyoffice.com "oforms", as the 9.x start page read it) → sdk.openTemplate(url, name)
 * - the local template folders (LocalFileTemplates → "onaddtemplates") → create:new {"template": {id, type, path}}
 * - WorkSuite organisation templates (GET /api/files/office/templates) → WorkSuite.createFromTemplate, then open
 */
import { command } from "@/sdk/bridge.js";
import { catalogUrl, normalizeLocal, normalizeOrg, parseCatalogPage } from "./templates-logic.js";

export const CATALOG_LOCALES = ["en", "de", "fr", "es", "it", "pt", "ja", "zh", "ru", "ar"];
const CATALOG_PAGE = 48;
const PROXY = "onlyoffice-proxy://";
const sdk = () => window.AscDesktopEditor;
const WS = () => window.WorkSuite;

function catalogDomain() {
  try { return localStorage.templatesdomain || "https://templates.onlyoffice.com"; } catch { return "https://templates.onlyoffice.com"; }
}

async function getJson(url, signal) {
  try {
    const r = await fetch(url, { signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } catch (e) {
    if (signal && signal.aborted) throw e;
    const r = await fetch(PROXY + url, { signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }
}

/*
 * The gallery of one locale, page by page (the first page shows at once, the rest follow in the background).
 * onPage({items, done}) per page; resolves with every item. An empty locale falls back to English.
 */
const catalogCache = new Map();
export function loadCatalog(locale, onPage) {
  const hit = catalogCache.get(locale);
  if (hit && hit.done) { onPage({ items: hit.items, done: true }); return Promise.resolve(hit.items); }
  const ctl = new AbortController();
  const run = (async () => {
    let items = [];
    for (let page = 1, count = 1; page <= count; page++) {
      const json = await getJson(catalogUrl(catalogDomain(), locale, page, CATALOG_PAGE), ctl.signal);
      const p = parseCatalogPage(json, locale);
      if (page === 1 && !p.raw && locale !== "en") return loadCatalog("en", onPage);
      count = p.pageCount;
      items = items.concat(p.items);
      onPage({ items, done: page >= count });
    }
    catalogCache.set(locale, { items, done: true });
    return items;
  })();
  run.abort = () => ctl.abort();
  return run;
}

/* Thumbnails: fetched once into blob URLs for the page's lifetime (falls back to the URL itself) */
const thumbCache = new Map();
export function cachedThumb(url) {
  if (!url || url.startsWith("data:")) return Promise.resolve(url || "");
  if (!thumbCache.has(url)) {
    thumbCache.set(url, fetch(url).then((r) => (r.ok ? r.blob() : Promise.reject())).then((b) => URL.createObjectURL(b), () => url));
  }
  return thumbCache.get(url);
}

/* The native local templates, in the UI language with its fallbacks */
export function requestLocal(lang) {
  const l = String(lang || "en").replace("-", "_");
  const ls = [l, l.replace("_", "-"), l.slice(0, 2), "en-US", "en_US", "en"];
  const s = sdk();
  if (s && typeof s.LocalFileTemplates === "function") s.LocalFileTemplates([...new Set(ls)]);
}
export function parseLocal(list) {
  return (Array.isArray(list) ? list : []).map(normalizeLocal).filter(Boolean);
}

/* The native "Add templates" file dialog (win-linux add:templates local, macOS CEF_addUserTemplateFiles) */
export function addLocalTemplates() {
  command("add:templates", "local");
}

/* Organisation and WorkSuite templates of every signed-in account whose server has the gallery */
export async function loadOrg() {
  const ws = WS();
  if (!ws) return [];
  const out = [];
  for (const acc of ws.accounts().filter((a) => a && a.user && !a.expired && ws.has(a, "files.templates"))) {
    for (const type of ["word", "cell", "slide"]) {
      try {
        const company = (id) => ((acc.companies || []).find((c) => String(c.id) === String(id)) || {}).name;
        (await ws.templates(acc, type)).forEach((t) => {
          const m = normalizeOrg(t, acc, company(t.organization_id));
          if (m) out.push(m);
        });
      } catch { /* that account's gallery is unavailable: the others still show */ }
    }
  }
  return out;
}

export async function useTemplate(tpl) {
  if (tpl.source === "local") {
    command("create:new", { template: { id: tpl.nativeId, type: tpl.format, path: tpl.path } });
  } else if (tpl.source === "catalog") {
    sdk().openTemplate(tpl.url, tpl.fullName);
  } else {
    const ws = WS();
    const acc = ws.accounts().find((a) => a.id === tpl.accountId);
    if (!acc) throw new Error("account");
    const file = await ws.createFromTemplate(acc, tpl.type, tpl.template, tpl.name, null);
    await ws.open(acc, file);
  }
}
