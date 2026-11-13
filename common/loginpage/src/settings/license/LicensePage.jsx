/*
 * Settings › WorkSuite Office Pro: check, enter and remove the Pro license, and show which features Pro
 * unlocks. Talks to the local AI service (worksuite-ai) through the same ws-ai:endpoint bridge the AI
 * Models screen uses (../ai-models/endpoint.js); all logic is in logic.js and strings in strings.js.
 * Styling is CSS variables only (license.css), so the page follows the design tokens and both themes.
 */
import { For, Show, createMemo, createSignal, onMount } from "solid-js";
import { createStore } from "solid-js/store";
import { requestEndpoint } from "../ai-models/endpoint.js";
import { createLicenseClient } from "./api.js";
import { S, UPGRADE_URL } from "./strings.js";
import { cleanKey, featureRows, formatDate, planState, reasonKey } from "./logic.js";
import "./license.css";

export default function LicensePage() {
  const [st, set] = createStore({
    phase: "loading", // loading | ready | down | unavailable | error
    reason: "",
    status: null,
    starting: false,
    busy: "", // "activate" | "deactivate" | "refresh" while a call is in flight
    toast: "",
  });
  const [key, setKey] = createSignal("");
  let client = null;
  let toastTimer;

  const toast = (text) => {
    set("toast", text);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set("toast", ""), 4000);
  };

  async function connect(start) {
    set({ phase: "loading", starting: !!start });
    const ep = await requestEndpoint(start);
    set("starting", false);
    if (!ep || !ep.ok) {
      const reason = (ep && ep.reason) || "start-failed";
      const down = reason === "not-running" || reason === "start-failed" || reason === "timeout";
      set({ phase: down ? "down" : "unavailable", reason });
      return;
    }
    client = createLicenseClient(ep);
    await load();
  }

  async function load() {
    try {
      const status = await client.get();
      set({ phase: "ready", status });
    } catch (e) {
      set({ phase: e && e.code === "unreachable" ? "down" : "error", reason: (e && e.code) || "" });
    }
  }

  onMount(() => connect(false));

  const state = createMemo(() => planState(st.status));
  const rows = createMemo(() => featureRows(st.status));
  const rsKey = createMemo(() => reasonKey(st.status));

  async function activate() {
    const k = cleanKey(key());
    if (!k || st.busy) return;
    set("busy", "activate");
    try {
      const status = await client.activate(k);
      set("status", status);
      setKey("");
      toast(S.activated);
    } catch (e) {
      if (e && e.status === 400) toast(e.message ? S.fmt("verifyFailed", e.message) : S.badKey);
      else toast(S.fmt("actionFailed", (e && (e.message || e.code)) || "?"));
    } finally {
      set("busy", "");
    }
  }

  async function deactivate() {
    if (st.busy) return;
    set("busy", "deactivate");
    try {
      const status = await client.deactivate();
      set("status", status);
      toast(S.deactivated);
    } catch (e) {
      toast(S.fmt("actionFailed", (e && (e.message || e.code)) || "?"));
    } finally {
      set("busy", "");
    }
  }

  async function refresh() {
    if (st.busy) return;
    set("busy", "refresh");
    try {
      const status = await client.refresh();
      set("status", status);
      toast(S.refreshed);
    } catch (e) {
      toast(S.fmt("actionFailed", (e && (e.message || e.code)) || "?"));
    } finally {
      set("busy", "");
    }
  }

  return (
    <div class="lic-page">
      <p class="lic-intro">{S.intro}</p>

      <Show when={st.phase === "loading"}>
        <div class="lic-center lic-muted">{st.starting ? S.starting : S.loading}</div>
      </Show>

      <Show when={st.phase === "down"}>
        <section class="lic-section lic-center">
          <h2 class="lic-h2">{S.downTitle}</h2>
          <p class="lic-muted">{S.downText}</p>
          <button type="button" class="lic-btn lic-btn-accent" disabled={st.starting} onClick={() => connect(true)}>
            {st.starting ? S.starting : S.start}
          </button>
        </section>
      </Show>

      <Show when={st.phase === "unavailable"}>
        <section class="lic-section lic-center">
          <p class="lic-muted">{st.reason === "not-installed" ? S.notInstalled : S.noDesktop}</p>
        </section>
      </Show>

      <Show when={st.phase === "error"}>
        <section class="lic-section lic-center">
          <h2 class="lic-h2">{S.errorTitle}</h2>
          <button type="button" class="lic-btn" onClick={() => connect(false)}>{S.retry}</button>
        </section>
      </Show>

      <Show when={st.phase === "ready"}>
        <section class="lic-section">
          <div class="lic-plan">
            <span class={"lic-badge lic-badge-" + (state() === "pro" ? "pro" : state() === "lapsed" ? "bad" : "free")}>
              {state() === "pro" ? S.planProTitle : state() === "lapsed" ? S.planLapsedTitle : S.planFreeTitle}
            </span>
            <p class="lic-plan-text">
              {state() === "pro" ? S.planProActive : state() === "lapsed" ? S[rsKey()] : S.planFreeText}
            </p>
          </div>

          <Show when={state() === "pro"}>
            <dl class="lic-details">
              <Show when={st.status?.issuedTo}>
                <div class="lic-row"><dt>{S.licensedTo}</dt><dd>{st.status.issuedTo}</dd></div>
              </Show>
              <Show when={st.status?.licenseId}>
                <div class="lic-row"><dt>{S.licenseId}</dt><dd class="lic-mono">{st.status.licenseId}</dd></div>
              </Show>
              <div class="lic-row">
                <dt>{S.expires}</dt>
                <dd>{st.status?.expiresAt ? formatDate(st.status.expiresAt) : S.perpetual}</dd>
              </div>
              <div class="lic-row">
                <dt>{S.lastChecked}</dt>
                <dd>{st.status?.lastOnlineOk ? formatDate(st.status.lastOnlineOk) : S.never}</dd>
              </div>
            </dl>
          </Show>
        </section>

        <section class="lic-section">
          <div class="lic-section-head">
            <h2 class="lic-h2">{S.featuresTitle}</h2>
            <Show when={state() !== "pro"}>
              <span class="lic-muted lic-small">{S.featuresFreeNote}</span>
            </Show>
          </div>
          <ul class="lic-features">
            <For each={rows()}>
              {(r) => (
                <li class="lic-feature">
                  <span class="lic-feature-name">{S["feat_" + r.key] ?? S.fmt("featFallback", r.key)}</span>
                  <span class={"lic-chip lic-chip-" + (r.granted ? "on" : "off")}>
                    {r.granted ? S.featIncluded : S.featLocked}
                  </span>
                </li>
              )}
            </For>
          </ul>
        </section>

        <section class="lic-section">
          <Show when={state() !== "pro"}>
            <h2 class="lic-h2">{S.enterTitle}</h2>
            <p class="lic-muted">{S.enterText}</p>
            <div class="lic-entry">
              <textarea
                class="lic-key"
                rows="3"
                spellcheck={false}
                autocomplete="off"
                placeholder={S.keyPlaceholder}
                value={key()}
                onInput={(e) => setKey(e.currentTarget.value)}
              />
              <div class="lic-actions">
                <button
                  type="button"
                  class="lic-btn lic-btn-accent"
                  disabled={!cleanKey(key()) || !!st.busy}
                  onClick={activate}
                >
                  {st.busy === "activate" ? S.activating : S.activate}
                </button>
                <a class="lic-btn lic-btn-link" href={UPGRADE_URL} target="_blank" rel="noreferrer">{S.upgrade}</a>
              </div>
            </div>
          </Show>

          <div class="lic-actions lic-actions-foot">
            <button type="button" class="lic-btn" disabled={!!st.busy} onClick={refresh}>
              {st.busy === "refresh" ? S.refreshing : S.refresh}
            </button>
            <Show when={state() === "pro"}>
              <button type="button" class="lic-btn lic-btn-danger" disabled={!!st.busy} onClick={deactivate}>
                {st.busy === "deactivate" ? S.deactivating : S.deactivate}
              </button>
            </Show>
          </div>
        </section>
      </Show>

      <Show when={st.toast}>
        <div class="lic-toast" role="status">{st.toast}</div>
      </Show>
    </div>
  );
}
