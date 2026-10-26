/*
 * Settings › AI Models (Local AI, W1, W2, W10): models for the local AI service, worksuite-ai.
 *
 * Section, Row and Toggle below are local stand-ins for the shared settings components
 * (SettingsSection, SettingsToggle) — swap them when those land; styling is CSS variables only
 * (ai-models.css), so the page follows the design tokens and light/dark themes.
 */
import { For, Show, createMemo, onCleanup, onMount } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { langCode } from "@/services/l10n.js";
import { createAiClient } from "./api.js";
import { requestEndpoint } from "./endpoint.js";
import { S } from "./strings.js";
import {
  TASKS, actionsFor, cardState, currentDefaults, defaultOptions, diagnosticsReport, evaluatedSi, fitOf,
  formatMB, installBlock, newInstall, normalizeAiPolicy, offlineOnlyLocked, recommendedProfile, reduceInstall,
  storageOf, tasksOf, withoutCloud,
} from "./logic.js";
import "./ai-models.css";

const LS_OFFLINE = "ws:ai:offline-only";
const LS_DEFAULTS = "ws:ai:defaults";

function readLS(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function writeLS(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked: the choice lasts for this session */
  }
}

function desktopPolicy() {
  try {
    const p = JSON.parse(localStorage.getItem("ws:policy") || "null");
    return p && typeof p === "object" ? p : {};
  } catch {
    return {};
  }
}

async function mockDeps() {
  const params = new URLSearchParams((location.hash.split("?")[1] || "") + "&" + location.search.slice(1));
  if (!params.get("aimock") && !window.__wsAiMock) return null;
  const { createMockService } = await import("./mock.js");
  const o = window.__wsAiMock || { policy: params.get("aipolicy"), state: params.get("aistate") };
  return createMockService(o);
}

export function Section(props) {
  return (
    <section class="aim-section" aria-labelledby={props.id}>
      <div class="aim-section-head">
        <h2 class="aim-h2" id={props.id}>{props.title}</h2>
        {props.aside}
      </div>
      <Show when={props.text}>
        <p class="aim-muted">{props.text}</p>
      </Show>
      {props.children}
    </section>
  );
}

function Toggle(props) {
  return (
    <label class="aim-toggle" classList={{ "aim-disabled": !!props.disabled }}>
      <span class="aim-toggle-text">
        <span class="aim-toggle-label">{props.label}</span>
        <Show when={props.text}>
          <span class="aim-muted aim-small">{props.text}</span>
        </Show>
        <Show when={props.locked}>
          <span class="aim-lock">{S.managed}</span>
        </Show>
      </span>
      <input
        type="checkbox"
        role="switch"
        class="aim-switch"
        checked={!!props.checked}
        disabled={props.disabled}
        aria-checked={!!props.checked}
        onChange={(e) => props.onChange(e.currentTarget.checked)}
      />
    </label>
  );
}

function Badge(props) {
  return <span class={"aim-badge aim-badge-" + props.kind}>{props.children}</span>;
}

export default function AiModelsPage() {
  const [st, set] = createStore({
    phase: "loading", // loading | ready | down | error | unavailable
    reason: "",
    info: null,
    hardware: null,
    catalog: [],
    installed: [],
    health: null,
    policy: normalizeAiPolicy(null, desktopPolicy()),
    privacy: { learning: false, keepRecordings: false },
    installs: {},
    defaults: currentDefaults([], readLS(LS_DEFAULTS, null)),
    offlineOnly: !!readLS(LS_OFFLINE, false),
    storageJob: null,
    moveOpen: false,
    movePath: "",
    filter: "",
    toast: "",
    starting: false,
  });
  let client = null;
  let stopEvents = () => {};
  let deps = null;
  let toastTimer;

  const toast = (text) => {
    set("toast", text);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set("toast", ""), 4000);
  };
  const fail = (e) => toast(S.fmt("actionFailed", (e && (e.message || e.code)) || "?"));

  async function connect(start) {
    set({ phase: "loading", starting: !!start });
    deps = deps || (await mockDeps());
    const ep = deps ? deps.endpoint : await requestEndpoint(start);
    set("starting", false);
    if (ep && ep.policy) set("policy", normalizeAiPolicy(ep.policy, desktopPolicy()));
    if (!ep || !ep.ok) {
      const reason = (ep && ep.reason) || "start-failed";
      set({ phase: reason === "not-running" || reason === "start-failed" || reason === "timeout" ? "down" : "unavailable", reason });
      return;
    }
    client = createAiClient(ep, deps || undefined);
    await load();
  }

  async function load() {
    try {
      const [info, hardware, catalog, installed, policy, privacy] = await Promise.all([
        client.info(), client.hardware(), client.catalog(), client.models(), client.policy(), client.privacy().catch(() => null),
      ]);
      const health = await client.health().catch(() => null);
      set(produce((s) => {
        s.info = info;
        s.hardware = hardware;
        s.catalog = Array.isArray(catalog) ? catalog : [];
        s.installed = Array.isArray(installed) ? installed : [];
        s.health = health;
        s.policy = normalizeAiPolicy(policy, desktopPolicy());
        if (privacy) s.privacy = privacy;
        s.defaults = currentDefaults(s.installed, readLS(LS_DEFAULTS, null));
        if (offlineOnlyLocked(s.policy)) s.offlineOnly = true;
        s.phase = "ready";
      }));
      adoptRunningJobs();
      watchEvents();
    } catch (e) {
      set({ phase: e && e.code === "unreachable" ? "down" : "error", reason: (e && e.code) || "" });
    }
  }

  /* installs the service reports as "updating" (started elsewhere, or before a page reload) */
  function adoptRunningJobs() {
    for (const m of st.installed) {
      if (m.state === "updating" && !st.installs[m.id]) set("installs", m.id, { ...newInstall(m.id, null), state: "downloading" });
    }
  }

  function watchEvents() {
    stopEvents();
    stopEvents = client.events(onEvent, () => {
      /* the socket closed: the service may have stopped */
      if (st.phase === "ready") setTimeout(() => st.phase === "ready" && refreshModels(), 1500);
    });
  }

  function onEvent(ev) {
    if (!ev || !ev.type) return;
    const type = String(ev.type);
    if (type.startsWith("policy")) {
      client.policy().then((p) => set("policy", normalizeAiPolicy(p, desktopPolicy()))).catch(() => {});
      return;
    }
    if (st.storageJob && ev.jobId === st.storageJob.jobId) {
      const next = reduceInstall(st.storageJob, ev);
      set("storageJob", next);
      if (next.state === "installed" || next.state === "failed" || next.state === "available") {
        set("storageJob", null);
        if (next.state === "installed") toast(S.moved);
        else if (next.state === "failed") fail({ code: next.error });
        refreshModels();
      }
      return;
    }
    let finished = false;
    set(produce((s) => {
      for (const id of Object.keys(s.installs)) {
        const before = s.installs[id];
        const after = reduceInstall(before, ev);
        if (after !== before) {
          s.installs[id] = after;
          if (after.state !== before.state && ["installed", "active", "available", "failed"].includes(after.state)) finished = true;
        }
      }
    }));
    if (finished || type.startsWith("model")) refreshModels();
  }

  async function refreshModels() {
    try {
      const [installed, health] = await Promise.all([client.models(), client.health().catch(() => null)]);
      set(produce((s) => {
        s.installed = installed || [];
        s.health = health;
        for (const id of Object.keys(s.installs)) {
          const e = s.installs[id];
          if (e.state === "installed" || e.state === "active" || e.state === "available") delete s.installs[id];
        }
        s.defaults = currentDefaults(s.installed, readLS(LS_DEFAULTS, null));
      }));
      await ensureDefaultsForNewModels();
    } catch (e) {
      if (e && e.code === "unreachable") set("phase", "down");
    }
  }

  /* W1 step 4: a newly installed model becomes the default for its tasks when nothing else is */
  let knownInstalled = null;
  async function ensureDefaultsForNewModels() {
    const ids = st.installed.map((m) => m.id);
    if (knownInstalled === null) {
      knownInstalled = new Set(ids);
      return;
    }
    const added = st.installed.filter((m) => !knownInstalled.has(m.id));
    knownInstalled = new Set(ids);
    if (!added.length) return;
    const next = { ...st.defaults };
    let changed = false;
    for (const m of added) {
      for (const task of tasksOf(m)) {
        if (TASKS.includes(task) && next[task] === "auto") {
          next[task] = m.id;
          changed = true;
        }
      }
    }
    if (changed) await saveDefaults(next);
  }

  async function act(action, model) {
    const id = model.id;
    const entry = st.installs[id];
    try {
      if (action === "install" || action === "retry" || action === "update") {
        const r = await client.install(id, action === "update" ? model.version : undefined);
        set("installs", id, newInstall(id, r && r.jobId));
      } else if (action === "pause") {
        await client.pause(id);
        set("installs", id, "state", "paused");
      } else if (action === "resume") {
        await client.resume(id);
        set("installs", id, "state", "downloading");
      } else if (action === "cancel") {
        await client.cancel(id, entry && entry.jobId);
        set(produce((s) => { delete s.installs[id]; }));
        refreshModels();
      } else if (action === "uninstall") {
        const inst = st.installed.find((m) => m.id === id);
        if (!window.confirm(S.fmt("confirmUninstall", model.name || id, formatMB(inst ? inst.sizeMB : model.sizeMB, langCode())))) return;
        await client.uninstall(id);
        set(produce((s) => { delete s.installs[id]; }));
        refreshModels();
      } else if (action === "activate") {
        await client.activate(id);
        refreshModels();
      } else if (action === "deactivate") {
        await client.deactivate(id);
        refreshModels();
      }
    } catch (e) {
      if (e && e.code === "forbidden_by_policy") client.policy().then((p) => set("policy", normalizeAiPolicy(p, desktopPolicy()))).catch(() => {});
      fail(e);
    }
  }

  async function saveDefaults(next) {
    const clean = st.offlineOnly || !st.policy.cloudAllowed ? withoutCloud(next) : next;
    set("defaults", clean);
    writeLS(LS_DEFAULTS, clean);
    try {
      await client.setDefaults(clean);
    } catch (e) {
      fail(e);
    }
  }

  async function setOfflineOnly(on) {
    set("offlineOnly", on);
    writeLS(LS_OFFLINE, on);
    if (on) await saveDefaults(st.defaults);
  }

  async function setPrivacy(key, value) {
    const prev = st.privacy[key];
    set("privacy", key, value);
    try {
      await client.setPrivacy({ ...st.privacy });
    } catch (e) {
      set("privacy", key, prev);
      fail(e);
    }
  }

  async function clearData(what) {
    try {
      await client.clear([what]);
      toast(S.cleared);
    } catch (e) {
      fail(e);
    }
  }

  async function moveStorage() {
    const path = st.movePath.trim();
    if (!path) return;
    try {
      const r = await client.moveStorage(path);
      set({ storageJob: { ...newInstall("storage", r && r.jobId), state: "downloading" }, moveOpen: false, movePath: "" });
    } catch (e) {
      fail(e);
    }
  }

  let fileInput = null;
  async function importFile(file) {
    if (!file) return;
    toast(S.importing);
    try {
      const r = await client.importModel(file);
      if (r && r.jobId) set("installs", "import:" + r.jobId, { ...newInstall("import", r.jobId), state: "verifying" });
      toast(S.imported);
      refreshModels();
    } catch (e) {
      fail(e);
    }
  }

  async function exportModel(id) {
    try {
      const blob = await client.exportModel(id);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = id + ".wsmodel";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 1000);
    } catch (e) {
      fail(e);
    }
  }

  async function copyReport() {
    const diagnostics = client ? await client.diagnostics().catch(() => null) : null;
    const text = diagnosticsReport({
      app: (window.RendererProcessVariable && window.RendererProcessVariable.appVersion) || "",
      info: st.info, hardware: st.hardware, installed: st.installed, diagnostics,
    });
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    toast(S.copied);
  }

  const start = (launch) => connect(launch).catch((e) => set({ phase: "error", starting: false, reason: String((e && e.message) || e) }));
  onMount(() => start(false));
  onCleanup(() => {
    stopEvents();
    clearTimeout(toastTimer);
  });

  const installedById = createMemo(() => Object.fromEntries(st.installed.map((m) => [m.id, m])));
  const catalogById = createMemo(() => Object.fromEntries(st.catalog.map((m) => [m.id, m])));
  const loadedMem = (id) => {
    const l = st.health && (st.health.loadedModels || []).find((m) => m.id === id);
    return l ? l.memMB : 0;
  };
  const visibleCatalog = createMemo(() => (st.filter ? st.catalog.filter((m) => tasksOf(m).includes(st.filter)) : st.catalog));
  const storage = createMemo(() => storageOf(st.installed));
  const profile = () => (st.info && st.info.profile) || recommendedProfile(st.hardware);
  const lang = () => langCode();

  function stateText(state, model, entry) {
    const pct = (entry ? Math.round((entry.progress || 0) * 100) : 0) + "%";
    if (state === "downloading") return S.fmt("state_downloading", pct);
    if (state === "paused") return S.fmt("state_paused", pct);
    if (state === "active") return loadedMem(model.id) ? S.fmt("state_active", formatMB(loadedMem(model.id), lang())) : S.state_activeNoMem;
    if (state === "update") return S.fmt("state_update", (catalogById()[model.id] || {}).version || "");
    if (state === "failed") {
      const code = (entry && entry.error) || "";
      return S["failed_" + code] && S["failed_" + code] !== "failed_" + code ? S["failed_" + code] : S.state_failed;
    }
    return S["state_" + state];
  }

  function Actions(props) {
    const blocked = () => props.state === "available" && installBlock(props.model, st.policy, null);
    return (
      <div class="aim-actions">
        <For each={actionsFor(props.state).filter((a) => props.only ? props.only.includes(a) : true)}>
          {(a) => (
            <button
              type="button"
              class="aim-btn"
              classList={{ "aim-btn-primary": a === "install" || a === "update" || a === "retry" }}
              disabled={(a === "install" && !!blocked()) || st.policy.allOff}
              onClick={() => act(a, props.model)}
              aria-label={S[a === "retry" ? "retryInstall" : a] + " " + (props.model.name || props.model.id)}
            >
              {S[a === "retry" ? "retryInstall" : a]}
            </button>
          )}
        </For>
      </div>
    );
  }

  function Progress(props) {
    return (
      <Show when={["queued", "downloading", "paused", "verifying", "unpacking"].includes(props.state)}>
        <div
          class="aim-progress"
          classList={{ "aim-progress-indeterminate": props.state === "verifying" || props.state === "unpacking" || props.state === "queued" }}
          role="progressbar"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={Math.round(((props.entry && props.entry.progress) || 0) * 100)}
        >
          <div class="aim-progress-bar" style={{ width: Math.round(((props.entry && props.entry.progress) || 0) * 100) + "%" }} />
        </div>
      </Show>
    );
  }

  function CatalogCard(props) {
    const m = () => props.model;
    const entry = () => st.installs[m().id];
    const state = () => cardState(m(), installedById()[m().id], entry());
    const fit = () => fitOf(m(), st.hardware, st.policy);
    const block = () => installBlock(m(), st.policy, null);
    const ev = () => evaluatedSi(m());
    return (
      <article class="aim-card" aria-label={m().name}>
        <header class="aim-card-head">
          <div>
            <h3 class="aim-h3">{m().name}</h3>
            <span class="aim-muted aim-small">{S.fmt("version", m().version)}</span>
          </div>
          <Badge kind={"fit-" + fit()}>{S["fit_" + fit()]}</Badge>
        </header>
        <dl class="aim-facts">
          <div><dt>{S.tasks}</dt><dd>{tasksOf(m()).map((t) => S["task_" + t] || t).join(", ")}</dd></div>
          <div><dt>{S.languages}</dt><dd>{(m().languages || []).join(", ")}</dd></div>
          <div><dt>{S.download}</dt><dd>{formatMB(m().sizeMB, lang())}</dd></div>
          <div><dt>{S.ram}</dt><dd>{S.fmt("needsRam", formatMB(m().ramMB, lang()))}</dd></div>
          <div><dt>{S.license}</dt><dd>{m().license || "—"}</dd></div>
          <div>
            <dt>{S.evalSi}</dt>
            <dd>
              {ev() ? S.fmt(ev().metric === "wer" ? "evalWer" : ev().metric === "mos" ? "evalMos" : "evalAccuracy",
                String(ev().metric === "mos" ? ev().value : Math.round(ev().value * 100))) : S.evalNone}
            </dd>
          </div>
        </dl>
        <div class="aim-badges">
          <Show when={st.policy.managed}>
            <Show when={block() === "notApproved"} fallback={<Badge kind="ok">{S.approved}</Badge>}>
              <Badge kind="lock">{S.notApproved}</Badge>
            </Show>
          </Show>
          <Show when={!st.policy.managed && block() === "notApproved"}>
            <Badge kind="lock">{S.notApproved}</Badge>
          </Show>
          <Show when={block() === "memoryCap"}><Badge kind="lock">{S.memoryCap}</Badge></Show>
          <Show when={block() === "featureOff"}><Badge kind="lock">{S.featureOff}</Badge></Show>
        </div>
        <Progress state={state()} entry={entry()} />
        <div class="aim-card-foot">
          <span class="aim-state" aria-live="polite">{stateText(state(), m(), entry())}</span>
          <Actions state={state()} model={m()} only={["install", "pause", "resume", "cancel", "retry", "update"]} />
        </div>
      </article>
    );
  }

  function InstalledRow(props) {
    const m = () => props.model;
    const cat = () => catalogById()[m().id] || { id: m().id, name: m().id, version: m().version };
    const entry = () => st.installs[m().id];
    const state = () => cardState(catalogById()[m().id], m(), entry());
    return (
      <li class="aim-row">
        <div class="aim-row-main">
          <span class="aim-row-title">{cat().name}</span>
          <span class="aim-muted aim-small">
            {S.fmt("version", m().version)} · {formatMB(m().sizeMB, lang())} · {tasksOf(m()).map((t) => S["task_" + t] || t).join(", ")}
          </span>
          <span class="aim-state" classList={{ "aim-state-active": state() === "active" }}>{stateText(state(), m(), entry())}</span>
          <Progress state={state()} entry={entry()} />
        </div>
        <Actions state={state()} model={{ ...cat(), id: m().id }} />
      </li>
    );
  }

  const taskSelectId = (t) => "aim-default-" + t;

  return (
    <div class="aim-page" lang={lang()}>
      <p class="aim-muted aim-intro">{S.intro}</p>

      <Show when={st.policy.managed}>
        <div class="aim-banner" role="note">{st.policy.allOff ? S.allOff : S.managedBanner}</div>
      </Show>

      <Show when={st.phase === "loading"}>
        <div class="aim-state-box" role="status" aria-live="polite">
          <span class="aim-spinner" aria-hidden="true" />
          <span>{st.starting ? S.starting : S.loading}</span>
        </div>
      </Show>

      <Show when={st.phase === "down"}>
        <div class="aim-state-box aim-state-box-col" role="status">
          <h2 class="aim-h2">{S.downTitle}</h2>
          <p class="aim-muted">{st.reason === "start-failed" || st.reason === "timeout" ? S.startFailed : S.downText}</p>
          <div class="aim-actions">
            <button type="button" class="aim-btn aim-btn-primary" disabled={st.policy.allOff} onClick={() => start(true)}>{S.start}</button>
            <button type="button" class="aim-btn" onClick={copyReport}>{S.copyReport}</button>
          </div>
        </div>
      </Show>

      <Show when={st.phase === "unavailable"}>
        <div class="aim-state-box aim-state-box-col" role="status">
          <p>{st.reason === "disabled-by-policy" ? S.allOff : st.reason === "no-desktop" ? S.noDesktop : S.notInstalled}</p>
        </div>
      </Show>

      <Show when={st.phase === "error"}>
        <div class="aim-state-box aim-state-box-col aim-error" role="alert">
          <h2 class="aim-h2">{S.errorTitle}</h2>
          <p class="aim-muted">{st.reason}</p>
          <button type="button" class="aim-btn aim-btn-primary" onClick={() => start(false)}>{S.retry}</button>
        </div>
      </Show>

      <Show when={st.phase === "ready"}>
        <Section id="aim-computer" title={S.computer} aside={<span class="aim-muted aim-small">{S.fmt("serviceRunning", (st.info && st.info.serviceVersion) || "")}</span>}>
          <div class="aim-hw">
            <dl class="aim-facts aim-facts-wide">
              <div><dt>{S.cpu}</dt><dd>{st.hardware.cpu ? st.hardware.cpu.model + " · " + st.hardware.cpu.cores : "—"}</dd></div>
              <div><dt>{S.ram}</dt><dd>{formatMB(st.hardware.ramMB, lang())}</dd></div>
              <div>
                <dt>{S.gpu}</dt>
                <dd>
                  {(st.hardware.gpus || []).length ? st.hardware.gpus.map((g) => g.name + " (" + formatMB(g.vramMB, lang()) + ", " + g.backend + ")").join("; ") : S.noGpu}
                  <Show when={!st.policy.gpuAllowed}><span class="aim-lock aim-lock-block">{S.gpuOffByOrg}</span></Show>
                </dd>
              </div>
            </dl>
            <div class="aim-profile">
              <span class="aim-muted aim-small">{S.recommended}</span>
              <div class="aim-profiles" role="list">
                <For each={["lite", "standard", "advanced"]}>
                  {(p) => (
                    <span role="listitem" class="aim-profile-chip" classList={{ "aim-profile-chip-on": profile() === p }} aria-current={profile() === p ? "true" : undefined}>
                      {S["profile_" + p]}
                    </span>
                  )}
                </For>
              </div>
              <p class="aim-small">{S["profileText_" + profile()]}</p>
            </div>
          </div>
        </Section>

        <Section
          id="aim-catalog"
          title={S.catalog}
          aside={
            <select class="aim-select" aria-label={S.tasks} value={st.filter} onChange={(e) => set("filter", e.currentTarget.value)}>
              <option value="">{S.filterAll}</option>
              <For each={TASKS}>{(t) => <option value={t}>{S["task_" + t]}</option>}</For>
            </select>
          }
        >
          <Show when={visibleCatalog().length} fallback={<p class="aim-empty">{S.emptyCatalog}</p>}>
            <div class="aim-grid">
              <For each={visibleCatalog()}>{(m) => <CatalogCard model={m} />}</For>
            </div>
          </Show>
        </Section>

        <Section id="aim-installed" title={S.installed}>
          <Show when={st.installed.length} fallback={<p class="aim-empty">{S.emptyInstalled}</p>}>
            <ul class="aim-list">
              <For each={st.installed}>{(m) => <InstalledRow model={m} />}</For>
            </ul>
          </Show>
        </Section>

        <Section id="aim-defaults" title={S.defaults} text={S.defaultsText}>
          <div class="aim-defaults">
            <For each={TASKS}>
              {(task) => {
                const locked = () => st.policy.features[task] === false;
                const opts = () => defaultOptions(task, st.installed, st.policy, st.offlineOnly);
                return (
                  <div class="aim-default">
                    <label for={taskSelectId(task)} class="aim-default-label">{S["task_" + task]}</label>
                    <select
                      id={taskSelectId(task)}
                      class="aim-select"
                      disabled={locked()}
                      value={locked() ? "auto" : st.defaults[task]}
                      onChange={(e) => saveDefaults({ ...st.defaults, [task]: e.currentTarget.value })}
                    >
                      <For each={opts()}>
                        {(o) => (
                          <option value={o.value}>
                            {o.kind === "auto" ? S.auto : o.kind === "cloud" ? S.cloud : (catalogById()[o.value] || {}).name || o.value}
                          </option>
                        )}
                      </For>
                    </select>
                    <Show when={locked()}><span class="aim-lock">{S.managed}</span></Show>
                  </div>
                );
              }}
            </For>
          </div>
        </Section>

        <Section id="aim-storage" title={S.storage}>
          <dl class="aim-facts aim-facts-wide">
            <div><dt>{S.folder}</dt><dd class="aim-path">{storage().path || "—"}</dd></div>
            <div><dt>{S.used}</dt><dd>{formatMB(storage().usedMB, lang())}</dd></div>
          </dl>
          <Show when={st.storageJob}>
            <p class="aim-state" aria-live="polite">{S.fmt("moving", Math.round(st.storageJob.progress * 100) + "%")}</p>
            <Progress state="downloading" entry={st.storageJob} />
          </Show>
          <Show
            when={st.moveOpen}
            fallback={
              <div class="aim-actions">
                <button type="button" class="aim-btn" disabled={!!st.storageJob} onClick={() => set("moveOpen", true)}>{S.move}</button>
              </div>
            }
          >
            <form class="aim-move" onSubmit={(e) => { e.preventDefault(); moveStorage(); }}>
              <label for="aim-move-path" class="aim-default-label">{S.moveTo}</label>
              <input id="aim-move-path" class="aim-input" placeholder={S.movePlaceholder} value={st.movePath} onInput={(e) => set("movePath", e.currentTarget.value)} />
              <button type="submit" class="aim-btn aim-btn-primary" disabled={!st.movePath.trim()}>{S.moveStart}</button>
              <button type="button" class="aim-btn" onClick={() => set("moveOpen", false)}>{S.cancel}</button>
            </form>
          </Show>
        </Section>

        <Section id="aim-import" title={S.importExport} text={S.importText}>
          <div class="aim-actions">
            <input ref={fileInput} type="file" accept=".wsmodel" class="aim-hidden" onChange={(e) => importFile(e.currentTarget.files[0])} />
            <button type="button" class="aim-btn" disabled={st.policy.allOff} onClick={() => fileInput.click()}>{S.import}</button>
            <select class="aim-select" aria-label={S.exportPick} value="" disabled={!st.installed.length} onChange={(e) => { const v = e.currentTarget.value; e.currentTarget.value = ""; if (v) exportModel(v); }}>
              <option value="">{S.exportPick}</option>
              <For each={st.installed}>{(m) => <option value={m.id}>{(catalogById()[m.id] || {}).name || m.id}</option>}</For>
            </select>
          </div>
        </Section>

        <Section id="aim-privacy" title={S.privacy}>
          <div class="aim-toggles">
            <Toggle label={S.learning} text={S.learningText} checked={st.privacy.learning} onChange={(v) => setPrivacy("learning", v)} />
            <Toggle label={S.keepRecordings} text={S.keepRecordingsText} checked={st.privacy.keepRecordings} onChange={(v) => setPrivacy("keepRecordings", v)} />
            <Toggle
              label={S.offlineOnly}
              text={S.offlineOnlyText}
              checked={st.offlineOnly}
              disabled={offlineOnlyLocked(st.policy)}
              locked={offlineOnlyLocked(st.policy)}
              onChange={setOfflineOnly}
            />
          </div>
          <div class="aim-actions">
            <button type="button" class="aim-btn" onClick={() => clearData("cache")}>{S.clearCache}</button>
            <button type="button" class="aim-btn" onClick={() => clearData("recordings")}>{S.clearRecordings}</button>
            <button type="button" class="aim-btn" onClick={() => clearData("learned")}>{S.clearLearned}</button>
          </div>
        </Section>

        <Section id="aim-diagnostics" title={S.diagnostics} text={S.diagnosticsText}>
          <div class="aim-actions">
            <button type="button" class="aim-btn" onClick={copyReport}>{S.copyReport}</button>
          </div>
        </Section>
      </Show>

      <Show when={st.toast}>
        <div class="aim-toast" role="status" aria-live="polite">{st.toast}</div>
      </Show>
    </div>
  );
}
