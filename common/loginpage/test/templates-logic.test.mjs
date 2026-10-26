import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCatalog, parseCatalogPage, normalizeLocal, normalizeOrg, filterTemplates, sortTemplates, facetOptions,
  toggleFavorite, pushRecent, hasFilters, clearFilters, prefsKey, parsePrefs, catalogLocale, catalogUrl,
} from "../src/routes/templates/templates-logic.js";

const rel = (key, ...names) => ({ data: names.map((n) => ({ attributes: { [key]: n } })) });
const oform = (id, name, ext, extra) => ({
  id,
  attributes: {
    name_form: name,
    form_exts: { data: [{ attributes: { ext } }] },
    file_oform: { data: [{ attributes: { url: `https://t/${id}.${ext}` } }] },
    template_image: { data: { attributes: { url: `https://t/${id}.png`, formats: { thumbnail: { url: `https://t/${id}-s.png` } } } } },
    categories: rel("categorie", ...(extra?.cat || [])),
    types: rel("type", ...(extra?.purpose || [])),
    updatedAt: extra?.updated,
  },
});

const items = [
  normalizeCatalog(oform(1, "Invoice", "docx", { cat: ["Finance"], purpose: ["Business"], updated: "2026-01-02" }), "en"),
  normalizeCatalog(oform(2, "Budget", "xlsx", { cat: ["Finance"], updated: "2026-03-01" }), "en"),
  normalizeCatalog(oform(3, "Contract", "docx", { cat: ["Legal"], purpose: ["Business"], updated: "2025-05-01" }), "en"),
  normalizeLocal({ path: "C:\\tpl\\Letter.dotx", type: 65 }),
  normalizeOrg({ id: 7, name: "Company memo", extension: "docx", scope: "organization", category: "HR" }, { id: "a1" }),
];

test("catalogue entries are normalized; broken ones dropped", () => {
  const i = items[0];
  assert.equal(i.id, "catalog:1");
  assert.equal(i.type, "word");
  assert.equal(i.fullName, "Invoice.docx");
  assert.deepEqual(i.categories, ["Finance"]);
  assert.deepEqual(i.purposes, ["Business"]);
  assert.equal(i.thumb, "https://t/1-s.png");
  assert.equal(normalizeCatalog({ id: 9, attributes: { name_form: "x" } }), null);
  const page = parseCatalogPage({ data: [oform(4, "Deck", "pptx"), { id: 5 }], meta: { pagination: { page: 1, pageCount: 3 } } }, "en");
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].type, "slide");
  assert.equal(page.pageCount, 3);
  assert.match(catalogUrl("https://d", "si", 2, 24), /locale=si&pagination\[page\]=2&pagination\[pageSize\]=24$/);
});

test("local and organisation templates", () => {
  assert.equal(items[3].name, "Letter");
  assert.equal(items[3].type, "word");
  assert.equal(items[3].language, null);
  assert.equal(normalizeLocal({ path: "/x/readme.foo" }), null);
  assert.equal(items[4].source, "organization");
  assert.equal(normalizeOrg({ id: 8, name: "S", extension: "xlsx", scope: "system" }, { id: "a1" }).source, "worksuite");
});

test("filter by tab, text, category, purpose, language, collection", () => {
  const ids = (f, ctx) => filterTemplates(items, f, ctx).map((i) => i.id);
  assert.deepEqual(ids({ type: "word" }), ["catalog:1", "catalog:3", "local:C:\\tpl\\Letter.dotx", "org:a1:7"]);
  assert.deepEqual(ids({ type: "word", query: "INVO" }), ["catalog:1"]);
  assert.deepEqual(ids({ query: "finance budget" }), ["catalog:2"]);
  assert.deepEqual(ids({ category: "Finance" }), ["catalog:1", "catalog:2"]);
  assert.deepEqual(ids({ purpose: "Business", type: "word" }), ["catalog:1", "catalog:3"]);
  assert.equal(ids({ language: "si" }).length, 2, "language-neutral templates pass a language filter");
  assert.deepEqual(ids({ collection: "favorites" }, { favorites: ["catalog:2"] }), ["catalog:2"]);
  assert.deepEqual(ids({ collection: "recent" }, { recent: ["org:a1:7"] }), ["org:a1:7"]);
  assert.deepEqual(ids({ collection: "mine" }), ["local:C:\\tpl\\Letter.dotx"]);
  assert.deepEqual(ids({ collection: "organization" }), ["org:a1:7"]);
});

test("sort", () => {
  const ids = (s, ctx) => sortTemplates(items, s, ctx).map((i) => i.id);
  assert.deepEqual(ids("name"), ["catalog:2", "org:a1:7", "catalog:3", "catalog:1", "local:C:\\tpl\\Letter.dotx"]);
  assert.deepEqual(ids("newest").slice(0, 3), ["catalog:2", "catalog:1", "catalog:3"]);
  assert.deepEqual(ids("popular").slice(0, 2), ["org:a1:7", "local:C:\\tpl\\Letter.dotx"]);
  assert.deepEqual(ids("recent", { recent: ["catalog:3", "catalog:1"] }).slice(0, 2), ["catalog:3", "catalog:1"]);
  assert.deepEqual(ids("bogus"), ids("popular"));
});

test("facets", () => {
  assert.deepEqual(facetOptions(items, "categories"), [{ value: "Finance", count: 2 }, { value: "HR", count: 1 }, { value: "Legal", count: 1 }]);
});

test("favourites and recently used", () => {
  assert.deepEqual(toggleFavorite([], "a"), ["a"]);
  assert.deepEqual(toggleFavorite(["b", "a"], "a"), ["b"]);
  assert.deepEqual(pushRecent(["a", "b"], "b"), ["b", "a"]);
  assert.equal(pushRecent(Array.from({ length: 20 }, (_, i) => "x" + i), "n").length, 12);
});

test("filters state", () => {
  assert.equal(hasFilters({ type: "word" }), false);
  assert.equal(hasFilters({ query: " a " }), true);
  assert.equal(hasFilters({ collection: "favorites" }), true);
  assert.deepEqual(clearFilters({ type: "cell", query: "x", category: "c", purpose: "p", language: "si", collection: "recent" }),
                   { type: "cell", query: "", category: "", purpose: "", language: "si", collection: "all" });
});

test("preferences are per user and sanitized", () => {
  assert.equal(prefsKey([]), "ws:templates:prefs:local");
  assert.equal(prefsKey([{ server: "https://a.lk/", user: { id: 5 } }]), "ws:templates:prefs:https://a.lk|5");
  assert.deepEqual(parsePrefs("{bad"), { favorites: [], recent: [], sort: "popular", layout: "grid" });
  assert.deepEqual(parsePrefs(JSON.stringify({ favorites: ["a", 3], sort: "name", layout: "list" })),
                   { favorites: ["a"], recent: [], sort: "name", layout: "list" });
  assert.equal(catalogLocale("si-LK", ["en", "si"]), "si");
  assert.equal(catalogLocale("xx", ["en"]), "en");
});
