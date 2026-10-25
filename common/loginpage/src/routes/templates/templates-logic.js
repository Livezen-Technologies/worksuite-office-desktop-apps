/*
 * Pure helpers of the Templates page (no DOM, no Solid): the template model of each source (the online
 * catalogue, the local template folders, WorkSuite organisation templates), filtering, sorting, facets,
 * favourites / recently used, and the per-user preferences record.
 */
import { typeOfExt } from "../../worksuite/home-logic.js";

export const TABS = ["word", "cell", "slide", "pdf"];
export const SORTS = ["popular", "name", "newest", "recent"];
export const COLLECTIONS = ["all", "favorites", "recent", "mine", "organization"];
export const RECENT_MAX = 12;
export const PAGE_SIZE = 24;

const extOf = (name) => {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ""));
  return m ? m[1].toLowerCase() : "";
};
const baseName = (path) => String(path || "").split(/[\\/]/).pop().replace(/\.[a-z0-9]+$/i, "");
const list = (v) => (Array.isArray(v) ? v : []);
const strapiNames = (rel, ...keys) =>
  list(rel && rel.data)
    .map((r) => (r && r.attributes) || {})
    .map((a) => keys.map((k) => a[k]).find((v) => typeof v === "string" && v.trim()))
    .filter(Boolean)
    .map((s) => s.trim());

/* The tab of a template: PDF forms go to "pdf", the rest by extension */
export function tabOf(ext) {
  const t = typeOfExt(ext);
  return t === "other" ? "word" : t;
}

/* An entry of the online catalogue (Strapi "oforms", as the 9.x start page read it) */
export function normalizeCatalog(item, locale) {
  const a = (item && item.attributes) || {};
  const exts = list(a.form_exts && a.form_exts.data);
  const ext = exts.length && exts[0].attributes ? String(exts[0].attributes.ext || "").toLowerCase() : "";
  const file = list(a.file_oform && a.file_oform.data)[0];
  if (!item || item.id === undefined || !ext || !file || !file.attributes || !file.attributes.url) return null;
  const image = a.template_image && a.template_image.data && a.template_image.data.attributes;
  const card = a.card_prewiew && a.card_prewiew.data && a.card_prewiew.data.attributes;
  const name = String(a.name_form || "").trim() || baseName(file.attributes.url);
  return {
    id: "catalog:" + item.id,
    source: "catalog",
    name,
    fullName: name + "." + ext,
    description: String(a.template_desc || a.description_card || "").trim(),
    ext,
    type: tabOf(ext),
    categories: strapiNames(a.categories, "categorie", "category", "name"),
    purposes: strapiNames(a.types, "type", "name").concat(strapiNames(a.compilations, "compilation", "name")),
    language: String(a.locale || locale || "en").slice(0, 2).toLowerCase(),
    thumb: (image && ((image.formats && (image.formats.small || image.formats.thumbnail || {}).url) || image.url)) || (card && card.url) || "",
    preview: (card && card.url) || (image && image.url) || "",
    url: file.attributes.url,
    updated: Date.parse(a.updatedAt || a.publishedAt || "") || 0,
  };
}

/* Strapi's page: {data: [...], meta: {pagination: {page, pageCount}}} */
export function parseCatalogPage(json, locale) {
  const items = list(json && json.data).map((i) => normalizeCatalog(i, locale)).filter(Boolean);
  const p = (json && json.meta && json.meta.pagination) || {};
  return { items, page: Number(p.page) || 1, pageCount: Number(p.pageCount) || 1, raw: list(json && json.data).length };
}

export function catalogUrl(domain, locale, page, size) {
  return `${domain}/dashboard/api/oforms?populate=*&locale=${encodeURIComponent(locale)}` +
         `&pagination[page]=${page}&pagination[pageSize]=${size}`;
}

/* An entry of the native "onaddtemplates": {path, type (format code), name?, icon?} */
export function normalizeLocal(item) {
  if (!item || !item.path) return null;
  const ext = extOf(item.path);
  const type = typeOfExt(ext);
  if (type === "other") return null;
  return {
    id: "local:" + item.path,
    source: "local",
    name: String(item.name || "").replace(/\.[a-z0-9]+$/i, "") || baseName(item.path),
    description: "",
    ext,
    type,
    categories: [],
    purposes: [],
    language: null,
    thumb: typeof item.icon === "string" ? item.icon : "",
    preview: typeof item.icon === "string" ? item.icon : "",
    path: item.path,
    format: item.type,
    nativeId: item.id,
    updated: 0,
  };
}

/* An entry of GET /api/files/office/templates: {id, name, kind, extension, scope, category, organization_id} */
export function normalizeOrg(t, account, company) {
  if (!t || t.id === undefined || !account) return null;
  const ext = String(t.extension || "").toLowerCase();
  return {
    id: "org:" + account.id + ":" + t.id,
    source: t.scope === "organization" ? "organization" : "worksuite",
    name: String(t.name || "").trim() || String(t.id),
    description: company || "",
    ext,
    type: tabOf(ext),
    categories: t.category ? [String(t.category)] : [],
    purposes: [],
    language: null,
    thumb: "",
    preview: "",
    accountId: account.id,
    template: t,
    updated: 0,
  };
}

/*
 * filters: {type, query, category, purpose, language, collection}; ctx: {favorites: [id], recent: [id]}.
 * Templates without a language (local, organisation) pass any language filter.
 */
export function filterTemplates(items, filters, ctx) {
  const f = filters || {};
  const favs = new Set(list(ctx && ctx.favorites));
  const recent = new Set(list(ctx && ctx.recent));
  const q = String(f.query || "").trim().toLowerCase();
  const words = q ? q.split(/\s+/) : [];
  return list(items).filter((i) => {
    if (f.type && i.type !== f.type) return false;
    if (f.category && !i.categories.includes(f.category)) return false;
    if (f.purpose && !i.purposes.includes(f.purpose)) return false;
    if (f.language && i.language && i.language !== f.language) return false;
    switch (f.collection) {
      case "favorites": if (!favs.has(i.id)) return false; break;
      case "recent": if (!recent.has(i.id)) return false; break;
      case "mine": if (i.source !== "local") return false; break;
      case "organization": if (i.source !== "organization" && i.source !== "worksuite") return false; break;
    }
    if (words.length) {
      const hay = [i.name, i.description, ...i.categories, ...i.purposes].join(" ").toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

/* sort: popular (the sources' own order: organisation, mine, catalogue), name, newest, recent (last used first) */
export function sortTemplates(items, sort, ctx) {
  const recent = list(ctx && ctx.recent);
  const rank = { organization: 0, worksuite: 1, local: 2, catalog: 3 };
  const value = {
    popular: (i) => rank[i.source] ?? 9,
    name: (i) => i.name.toLowerCase(),
    newest: (i) => -i.updated,
    recent: (i) => { const r = recent.indexOf(i.id); return r < 0 ? Infinity : r; },
  }[SORTS.includes(sort) ? sort : "popular"];
  return list(items)
    .map((item, index) => ({ item, index, v: value(item) }))
    .sort((a, b) => (a.v < b.v ? -1 : a.v > b.v ? 1 : a.index - b.index))
    .map((x) => x.item);
}

/* [{value, count}] of a facet ("categories" | "purposes") over the given items, most used first */
export function facetOptions(items, key) {
  const counts = new Map();
  for (const i of list(items)) for (const v of list(i[key])) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts].map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export function toggleFavorite(favorites, id) {
  const f = list(favorites);
  return f.includes(id) ? f.filter((x) => x !== id) : [id, ...f];
}

export function pushRecent(recent, id, max) {
  return [id, ...list(recent).filter((x) => x !== id)].slice(0, max || RECENT_MAX);
}

/* True when any filter narrows the gallery (the tab does not count: it is the gallery's own axis) */
export function hasFilters(f) {
  return !!(f && (String(f.query || "").trim() || f.category || f.purpose || (f.collection && f.collection !== "all")));
}

export function clearFilters(f) {
  return { ...f, query: "", category: "", purpose: "", collection: "all" };
}

/* Preferences are per user: the first WorkSuite sign-in, or this computer's user */
export function prefsKey(accounts) {
  const a = list(accounts).find((x) => x && x.user && x.server);
  return "ws:templates:prefs:" + (a ? String(a.server).replace(/\/+$/, "") + "|" + a.user.id : "local");
}

export const DEFAULT_PREFS = { favorites: [], recent: [], sort: "popular", layout: "grid" };

export function parsePrefs(text) {
  let p = null;
  try { p = JSON.parse(text || "null"); } catch { p = null; }
  p = p && typeof p === "object" ? p : {};
  const ids = (v) => list(v).filter((x) => typeof x === "string").slice(0, 500);
  return {
    favorites: ids(p.favorites),
    recent: ids(p.recent).slice(0, RECENT_MAX),
    sort: SORTS.includes(p.sort) ? p.sort : DEFAULT_PREFS.sort,
    layout: p.layout === "list" ? "list" : "grid",
  };
}

/* The catalogue's locale for a UI language ("en-US", "si_LK" → "en", "si"); unknown → "en" */
export function catalogLocale(lang, supported) {
  const l = String(lang || "en").slice(0, 2).toLowerCase();
  return list(supported).includes(l) ? l : "en";
}
