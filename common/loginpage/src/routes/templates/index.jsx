/*
 * Templates: one gallery of the online template gallery, the user's own template folders and the
 * organisation templates of WorkSuite sign-ins. Filters, favourites and recently used are local
 * preferences per user; Use Template goes through the existing native / WorkSuite create commands.
 */
import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import { langCode } from "@/services/l10n";
import { onNativeMessage } from "@/sdk";
import { Icon, IconButton, LayoutToggle, SearchBox, WsButton } from "@/worksuite/ui/components.jsx";
import { FilterSelect, PreviewDialog } from "./controls.jsx";
import { T } from "./strings.js";
import {
  TABS, PAGE_SIZE, filterTemplates, sortTemplates, facetOptions, toggleFavorite, pushRecent, hasFilters,
  clearFilters, prefsKey, parsePrefs, catalogLocale,
} from "./templates-logic.js";
import { CATALOG_LOCALES, addLocalTemplates, cachedThumb, loadCatalog, loadOrg, parseLocal, requestLocal, useTemplate } from "./sources.js";
import "./templates.css";

const [uiLang, setUiLang] = createSignal("");

/* settings-sync tells the page about the UI language (it used to post it into the gallery iframe) */
export function sendTemplatesSettings(opts) {
  if (opts && opts.type === "locale" && opts.value) setUiLang(String(opts.value));
}
export function sendTemplatesCountry(code) {
  code && setUiLang(String(code));
}
/* the page follows the start page's theme classes itself */
export function sendTemplatesTheme() {}

const TAB_LABEL = { word: () => T.tplDocument, cell: () => T.tplSpreadsheet, slide: () => T.tplPresentation, pdf: () => T.tplTabPdf };
const SOURCE_LABEL = { catalog: () => T.tplSourceCatalog, local: () => T.tplSourceLocal, organization: () => T.tplSourceOrg, worksuite: () => T.tplSourceWs };

function languageName(code) {
  try { return new Intl.DisplayNames([langCode() || "en"], { type: "language" }).of(code) || code; } catch { return code; }
}

function readPrefs(key) {
  try { return parsePrefs(localStorage.getItem(key)); } catch { return parsePrefs(null); }
}

/* Visible-once: one observer for every lazily loaded thumbnail */
let seen = null;
const seenCallbacks = new WeakMap();
function whenVisible(el, cb) {
  if (typeof IntersectionObserver === "undefined") return cb();
  if (!seen) {
    seen = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (!e.isIntersecting) return;
      seen.unobserve(e.target);
      const f = seenCallbacks.get(e.target);
      f && f();
    }), { rootMargin: "200px" });
  }
  seenCallbacks.set(el, cb);
  seen.observe(el);
  onCleanup(() => seen.unobserve(el));
}

const TYPE_ICON = { word: "file-text", cell: "file-sheet", slide: "presentation", pdf: "file-type" };

function Thumb(props) {
  const [src, setSrc] = createSignal("");
  const [failed, setFailed] = createSignal(false);
  const [settled, setSettled] = createSignal(!props.template.thumb);
  let el;
  onMount(() => whenVisible(el, () => cachedThumb(props.template.thumb).then(setSrc).finally(() => setSettled(true))));
  return (
    <div class="tpl-thumb" ref={el}>
      <Show when={src() && !failed()} fallback={
        <Show when={settled() || failed()} fallback={<span class="tpl-skel" aria-hidden="true" />}>
          <div class="tpl-thumb-none">
            <Icon name={TYPE_ICON[props.template.type] || "file-text"} class="tpl-thumb-icon" />
            <span class="tpl-type-mark">{props.template.ext.toUpperCase()}</span>
          </div>
        </Show>
      }>
        <img src={src()} alt="" draggable={false} onError={() => setFailed(true)} />
      </Show>
    </div>
  );
}

function SkeletonCards(props) {
  return (
    <For each={Array.from({ length: props.count })}>
      {() => (
        <div class="tpl-card tpl-card-skeleton" aria-hidden="true">
          <div class="tpl-thumb"><span class="tpl-skel" /></div>
          <div class="tpl-meta"><span class="tpl-skel tpl-skel-line" /><span class="tpl-skel tpl-skel-line short" /></div>
        </div>
      )}
    </For>
  );
}

export default function Templates() {
  const key = () => prefsKey(window.WorkSuite ? window.WorkSuite.accounts() : []);
  const [prefs, setPrefs] = createSignal(readPrefs(key()));
  const savePrefs = (patch) => {
    const next = { ...prefs(), ...patch };
    setPrefs(next);
    try { localStorage.setItem(key(), JSON.stringify(next)); } catch { /* preferences only */ }
  };

  const lang = () => catalogLocale(uiLang() || langCode(), CATALOG_LOCALES);
  const [filters, setFilters] = createSignal({ type: "word", query: "", category: "", purpose: "", language: lang(), collection: "all" });
  const setFilter = (patch) => setFilters({ ...filters(), ...patch });
  createEffect(on(uiLang, (l) => l && setFilter({ language: catalogLocale(l, CATALOG_LOCALES) }), { defer: true }));

  const [catalog, setCatalog] = createSignal([]);
  const [status, setStatus] = createSignal("loading");
  const [local, setLocal] = createSignal([]);
  const [org, setOrg] = createSignal([]);
  const [online, setOnline] = createSignal(navigator.onLine);
  let run = null;
  function fetchCatalog() {
    run && run.abort && run.abort();
    setStatus("loading");
    const token = {};
    run = token;
    const r = loadCatalog(language(), (p) => {
      if (run !== token && run !== r) return;
      setCatalog(p.items);
      setStatus(p.done ? "ready" : "more");
    });
    run = r;
    r.catch(() => run === r && setStatus(catalog().length ? "ready" : "error"));
  }
  const language = createMemo(() => filters().language);
  createEffect(on(language, () => { setCatalog([]); fetchCatalog(); }));

  onMount(() => {
    const onLocal = (list) => setLocal(parseLocal(list));
    const sdk = window.AscDesktopEditor;
    sdk && sdk.on && sdk.on("onaddtemplates", onLocal);
    requestLocal(uiLang() || langCode());
    const off = onNativeMessage((cmd, param) => cmd === "templates" && param === "update:local" && requestLocal(uiLang() || langCode()));
    loadOrg().then(setOrg, () => setOrg([]));
    const up = () => { setOnline(true); status() === "error" && fetchCatalog(); };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    onCleanup(() => {
      sdk && sdk.remove && sdk.remove("onaddtemplates", onLocal);
      off && off();
      run && run.abort && run.abort();
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    });
  });

  const all = createMemo(() => org().concat(local(), catalog()));
  const ctx = () => ({ favorites: prefs().favorites, recent: prefs().recent });
  const ofTab = createMemo(() => filterTemplates(all(), { type: filters().type, language: filters().language }));
  const results = createMemo(() => sortTemplates(filterTemplates(all(), filters(), ctx()), prefs().sort, ctx()));
  const categories = createMemo(() => facetOptions(ofTab(), "categories").map((o) => ({ value: o.value, label: o.value, hint: String(o.count) })));
  const purposes = createMemo(() => facetOptions(ofTab(), "purposes").map((o) => ({ value: o.value, label: o.value, hint: String(o.count) })));
  const tabCount = (type) => filterTemplates(all(), { ...filters(), type }, ctx()).length;

  const [shown, setShown] = createSignal(PAGE_SIZE);
  createEffect(on([filters, () => prefs().sort], () => setShown(PAGE_SIZE)));
  const page = createMemo(() => results().slice(0, shown()));
  let sentinel;
  onMount(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && setShown((n) => (n < results().length ? n + PAGE_SIZE : n)), { rootMargin: "400px" });
    io.observe(sentinel);
    onCleanup(() => io.disconnect());
  });

  const [preview, setPreview] = createSignal(null);
  const [previewThumb, setPreviewThumb] = createSignal("");
  const [busy, setBusy] = createSignal(null);
  const [error, setError] = createSignal("");
  createEffect(on(preview, (p) => {
    setPreviewThumb("");
    p && cachedThumb(p.preview || p.thumb).then((u) => preview() === p && setPreviewThumb(u));
  }));

  const isFav = (t) => prefs().favorites.includes(t.id);
  const fav = (t) => savePrefs({ favorites: toggleFavorite(prefs().favorites, t.id) });
  async function use(t) {
    if (busy()) return;
    setBusy(t.id);
    setError("");
    try {
      await useTemplate(t);
      savePrefs({ recent: pushRecent(prefs().recent, t.id) });
      setPreview(null);
    } catch (e) {
      setError(e && e.message && e.message !== "account" ? e.message : T.tplError);
    } finally {
      setBusy(null);
    }
  }
  const meta = (t) => [t.categories[0] || SOURCE_LABEL[t.source](), t.language ? languageName(t.language) : SOURCE_LABEL[t.source]()]
    .filter((v, i, a) => a.indexOf(v) === i).join(" · ");

  const collections = () => [
    { value: "all", label: T.tplAll },
    { value: "favorites", label: T.tplFavorites, hint: String(prefs().favorites.length || "") },
    { value: "recent", label: T.tplRecent },
    { value: "mine", label: T.tplMine },
    ...(org().length ? [{ value: "organization", label: T.tplOrg }] : []),
  ];
  const sorts = () => [
    { value: "popular", label: T.tplSortPopular }, { value: "name", label: T.tplSortName },
    { value: "newest", label: T.tplSortNewest }, { value: "recent", label: T.tplSortRecent },
  ];
  const languages = () => CATALOG_LOCALES.map((c) => ({ value: c, label: languageName(c) })).sort((a, b) => a.label.localeCompare(b.label));

  const loading = () => status() === "loading" && !catalog().length;
  const empty = () => {
    const c = filters().collection;
    if (c === "mine" && !hasFilters({ ...filters(), collection: "all" })) return { title: T.tplEmptyMine, text: T.tplEmptyMineHint, mine: true };
    if (c === "favorites" && !hasFilters({ ...filters(), collection: "all" })) return { title: T.tplEmptyFav, text: T.tplEmptyFavHint };
    if (c === "recent" && !hasFilters({ ...filters(), collection: "all" })) return { title: T.tplEmptyRecent, text: "" };
    return { title: T.tplEmpty, text: T.tplEmptyHint, clear: true };
  };
  const catalogFailed = () => status() === "error" && filters().collection !== "mine" && filters().collection !== "organization";

  function onTabKey(e) {
    const i = TABS.indexOf(filters().type);
    const n = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!n) return;
    e.preventDefault();
    const rtl = document.body.classList.contains("rtl") ? -1 : 1;
    const next = TABS[(i + n * rtl + TABS.length) % TABS.length];
    setFilter({ type: next });
    e.currentTarget.querySelector(`[data-tab="${next}"]`)?.focus();
  }

  return (
    <div class="tpl-page" classList={{ "is-list": prefs().layout === "list" }}>
      <div class="tpl-inner">
        <header class="tpl-head">
          <div class="tpl-head-text">
            <h1 class="tpl-title">{T.tplTitle}</h1>
            <p class="tpl-descr">{T.tplDescr}</p>
          </div>
          <WsButton variant={filters().collection === "mine" ? "primary" : "secondary"} icon="folder"
                    onClick={() => setFilter({ collection: filters().collection === "mine" ? "all" : "mine" })}>{T.tplMine}</WsButton>
        </header>

        <div class="tpl-sticky">
          <div class="tpl-toolbar" role="search">
            <SearchBox class="tpl-search" placeholder={T.tplSearchPh} value={filters().query} onSearch={(q) => setFilter({ query: q })} />
            <div class="tpl-filters">
              <FilterSelect label={T.tplCategory} allLabel={T.tplAnyCategory} value={filters().category} options={categories()} searchable
                            onChange={(v) => setFilter({ category: v })} />
              <FilterSelect label={T.tplPurpose} allLabel={T.tplAnyPurpose} value={filters().purpose} options={purposes()} searchable
                            onChange={(v) => setFilter({ purpose: v })} />
              <FilterSelect label={T.tplLanguage} value={filters().language} options={languages()} searchable
                            onChange={(v) => setFilter({ language: v })} />
              <Show when={hasFilters(filters())}>
                <WsButton variant="ghost" icon="x" onClick={() => setFilters(clearFilters(filters()))}>{T.tplClear}</WsButton>
              </Show>
            </div>
          </div>
          <div class="tpl-tabrow">
            <div class="tpl-tabs" role="tablist" aria-label={T.tplTitle} onKeyDown={onTabKey}>
              <For each={TABS}>
                {(type) => (
                  <button type="button" role="tab" data-tab={type} aria-selected={filters().type === type ? "true" : "false"}
                          tabIndex={filters().type === type ? 0 : -1} aria-controls="tpl-gallery" onClick={() => setFilter({ type })}>
                    {TAB_LABEL[type]()}
                    <span class="tpl-tab-count">{tabCount(type)}</span>
                  </button>
                )}
              </For>
            </div>
            <div class="tpl-tabs-tools">
              <Show when={status() === "more"}><span class="tpl-loading-more" role="status"><span class="wsx-spinner" />{T.tplCount.replace("$1", catalog().length)}</span></Show>
              <FilterSelect label={T.tplShow} value={filters().collection} options={collections()} searchable={false}
                            onChange={(v) => setFilter({ collection: v })} />
              <FilterSelect label={T.tplSort} icon="sort" value={prefs().sort} options={sorts()} searchable={false}
                            onChange={(v) => savePrefs({ sort: v })} />
              <LayoutToggle value={prefs().layout} onChange={(v) => savePrefs({ layout: v })} />
            </div>
          </div>
        </div>

        <Show when={!online()}><p class="wsx-msg wsx-tone-warning tpl-banner" role="status"><Icon name="alert" />{T.tplOffline}</p></Show>
        <Show when={error()}><p class="wsx-msg wsx-tone-danger tpl-banner" role="alert"><Icon name="alert" />{error()}</p></Show>

        <section id="tpl-gallery" class="tpl-gallery" role="tabpanel" aria-busy={loading() ? "true" : "false"}>
          <Show when={page().length || loading()} fallback={
            <Show when={catalogFailed()} fallback={
              <div class="tpl-state">
                <div class="wsx-empty" role="status">
                  <Icon name="template" class="wsx-empty-icon" />
                  <p class="wsx-empty-title">{empty().title}</p>
                  <Show when={empty().text}><p class="wsx-hint">{empty().text}</p></Show>
                  <div class="wsx-empty-action">
                    <Show when={empty().mine}><WsButton variant="primary" icon="plus" onClick={addLocalTemplates}>{T.tplAddMine}</WsButton></Show>
                    <Show when={empty().clear && hasFilters(filters())}>
                      <WsButton variant="secondary" onClick={() => setFilters(clearFilters(filters()))}>{T.tplClear}</WsButton>
                    </Show>
                  </div>
                </div>
              </div>
            }>
              <div class="tpl-state">
                <div class="wsx-empty" role="alert">
                  <Icon name="alert" class="wsx-empty-icon" />
                  <p class="wsx-empty-title">{T.tplError}</p>
                  <p class="wsx-hint">{T.tplErrorHint}</p>
                  <div class="wsx-empty-action"><WsButton variant="primary" icon="refresh" onClick={fetchCatalog}>{T.tplRetry}</WsButton></div>
                </div>
              </div>
            </Show>
          }>
            <div class="tpl-grid" role="list">
              <For each={page()}>
                {(t) => (
                  <article class="tpl-card" role="listitem" classList={{ "is-busy": busy() === t.id }}>
                    <div class="tpl-frame">
                      <Thumb template={t} />
                      <div class="tpl-hover">
                        <WsButton variant="secondary" small onClick={() => setPreview(t)}>{T.tplPreview}</WsButton>
                        <WsButton variant="primary" small busy={busy() === t.id} onClick={() => use(t)}>{T.tplUse}</WsButton>
                      </div>
                      <span class="tpl-fav" classList={{ "is-on": isFav(t) }}>
                        <IconButton icon={isFav(t) ? "star-on" : "star"} label={isFav(t) ? T.tplUnfav : T.tplFav} pressed={isFav(t)} onClick={() => fav(t)} />
                      </span>
                    </div>
                    <div class="tpl-meta">
                      <button type="button" class="tpl-name wsx-ellipsis" title={t.name} onClick={() => setPreview(t)}>{t.name}</button>
                      <span class="tpl-sub wsx-ellipsis">{meta(t)}</span>
                    </div>
                  </article>
                )}
              </For>
              <Show when={loading() || (status() === "more" && shown() > results().length)}>
                <SkeletonCards count={loading() ? 12 : 4} />
              </Show>
            </div>
          </Show>
          <div ref={sentinel} class="tpl-sentinel" aria-hidden="true" />
        </section>
      </div>

      <Show when={preview()}>
        <PreviewDialog template={preview()} thumb={previewThumb()} meta={meta(preview())} favorite={isFav(preview())}
                       busy={busy() === preview().id} onUse={() => use(preview())} onFavorite={() => fav(preview())}
                       onClose={() => setPreview(null)} />
      </Show>
    </div>
  );
}
