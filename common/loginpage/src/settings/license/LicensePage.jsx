/*
 * Settings › WorkSuite Office Pro: the activation wizard (Welcome → Your key → Activating → Done) while Pro is not
 * active, and the licence, its features, Check again and Deactivate once it is. Talks to the local AI service
 * (worksuite-ai) through the ws-ai:endpoint bridge the AI Models screen uses (../ai-models/endpoint.js); the
 * service redeems a WSO-… key at the WorkSuite licence server (download.worksuitecloud.com) and keeps the signed
 * licence. Activating starts the service when it is not running, so nobody has to press "Start AI service" first.
 * Logic is in logic.js, text in strings.js, styling in license.css (theme variables only).
 */
import { For, Show, createMemo, createSignal, onMount } from "solid-js";
import { createStore } from "solid-js/store";
import { requestEndpoint } from "../ai-models/endpoint.js";
import { createLicenseClient } from "./api.js";
import { S, UPGRADE_URL } from "./strings.js";
import { WIZARD_STEPS, cleanKey, failureKey, featureRows, formatDate, formatKeyInput, planState, readyToActivate, reasonKey } from "./logic.js";
import "./license.css";

export default function LicensePage() {
  const [st, set] = createStore({
    phase: "loading", // loading | ready | down | unavailable | error
    reason: "",
    status: null,
    busy: "", // "deactivate" | "refresh" while a call is in flight
    toast: "",
    step: "welcome", // the wizard: welcome | key | activating | done | failed
    progress: "", // while activating: "starting" | "contacting"
    failure: "", // strings-table key, or "" to show failText
    failText: "",
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
    const ep = await requestEndpoint(start);
    if (!ep || !ep.ok) {
      const reason = (ep && ep.reason) || "start-failed";
      const down = reason === "not-running" || reason === "start-failed" || reason === "timeout";
      set({ phase: down ? "down" : "unavailable", reason });
      return false;
    }
    client = createLicenseClient(ep);
    try {
      set({ phase: "ready", status: await client.get() });
      return true;
    } catch (e) {
      set({ phase: e && e.code === "unreachable" ? "down" : "error", reason: (e && e.code) || "" });
      return false;
    }
  }

  onMount(() => connect(false));

  const state = createMemo(() => planState(st.status));
  const rows = createMemo(() => featureRows(st.status));
  const rsKey = createMemo(() => reasonKey(st.status));
  const showWizard = createMemo(() => st.phase === "down" || (st.phase === "ready" && state() !== "pro") || st.step === "done");
  const stepIndex = createMemo(() => WIZARD_STEPS.indexOf(st.step === "failed" ? "activating" : st.step));

  async function activate() {
    const k = cleanKey(key());
    if (!readyToActivate(k)) return;
    set({ step: "activating", failure: "", failText: "" });
    if (!client) {
      set("progress", "starting");
      if (!(await connect(true))) {
        set({ step: "failed", failure: st.phase === "unavailable" ? (st.reason === "not-installed" ? "notInstalled" : "noDesktop") : "failService" });
        return;
      }
    }
    set("progress", "contacting");
    try {
      const status = await client.activate(k);
      set("status", status);
      if (planState(status) === "pro") {
        setKey("");
        set("step", "done");
      } else {
        set({ step: "failed", failure: reasonKey(status) || "reasonGeneric" });
      }
    } catch (e) {
      set({ step: "failed", failure: failureKey(e), failText: (e && e.message) || "" });
    }
  }

  async function deactivate() {
    if (st.busy) return;
    set("busy", "deactivate");
    try {
      set({ status: await client.deactivate(), step: "welcome" });
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
      set("status", await client.refresh());
      toast(S.refreshed);
    } catch (e) {
      toast(S.fmt("actionFailed", (e && (e.message || e.code)) || "?"));
    } finally {
      set("busy", "");
    }
  }

  const stepLabels = [S.wizStepWelcome, S.wizStepKey, S.wizStepActivating, S.wizStepDone];

  return (
    <div class="lic-page">
      <p class="lic-intro">{S.intro}</p>

      <Show when={st.phase === "loading"}>
        <div class="lic-center lic-muted">{S.loading}</div>
      </Show>

      <Show when={st.phase === "unavailable" && st.step !== "failed"}>
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

      <Show when={showWizard()}>
        <section class="lic-section lic-wizard" aria-live="polite">
          <ol class="lic-steps">
            <For each={stepLabels}>
              {(label, i) => (
                <li classList={{ "lic-step": true, "is-done": i() < stepIndex(), "is-current": i() === stepIndex() }}>
                  <span class="lic-step-num">{i() + 1}</span>
                  <span class="lic-step-label">{label}</span>
                </li>
              )}
            </For>
          </ol>

          <Show when={st.step === "welcome"}>
            <h2 class="lic-h2">{S.wizWelcomeTitle}</h2>
            <Show when={state() === "lapsed"}>
              <p class="lic-warn">{S[rsKey()]}</p>
            </Show>
            <p class="lic-muted">{S.wizWelcomeText}</p>
            <div class="lic-actions">
              <button type="button" class="lic-btn lic-btn-accent" onClick={() => set("step", "key")}>{S.wizHaveKey}</button>
              <a class="lic-btn" href={UPGRADE_URL} target="_blank" rel="noreferrer">{S.wizBuy}</a>
            </div>
          </Show>

          <Show when={st.step === "key"}>
            <h2 class="lic-h2">{S.wizKeyTitle}</h2>
            <p class="lic-muted">{S.wizKeyText}</p>
            <textarea
              class="lic-key lic-key-wizard"
              rows="2"
              spellcheck={false}
              autocomplete="off"
              aria-label={S.wizKeyTitle}
              placeholder={S.wizKeyPlaceholder}
              value={key()}
              onInput={(e) => setKey(formatKeyInput(e.currentTarget.value))}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); activate(); } }}
            />
            <div class="lic-actions">
              <button type="button" class="lic-btn" onClick={() => set("step", "welcome")}>{S.wizBack}</button>
              <button type="button" class="lic-btn lic-btn-accent" disabled={!readyToActivate(key())} onClick={activate}>{S.wizActivate}</button>
            </div>
          </Show>

          <Show when={st.step === "activating"}>
            <div class="lic-center">
              <span class="lic-spinner" aria-hidden="true" />
              <p class="lic-muted">{st.progress === "starting" ? S.wizStarting : S.wizContacting}</p>
            </div>
          </Show>

          <Show when={st.step === "failed"}>
            <h2 class="lic-h2">{S.wizFailTitle}</h2>
            <p class="lic-warn">{st.failure ? S[st.failure] : S.fmt("actionFailed", st.failText || "?")}</p>
            <div class="lic-actions">
              <button type="button" class="lic-btn" onClick={() => set("step", "key")}>{S.wizChangeKey}</button>
              <button type="button" class="lic-btn lic-btn-accent" onClick={activate}>{S.wizTryAgain}</button>
            </div>
          </Show>

          <Show when={st.step === "done"}>
            <h2 class="lic-h2">{S.wizDoneTitle}</h2>
            <p class="lic-muted">{S.wizDoneText}</p>
            <ul class="lic-features">
              <For each={rows().filter((r) => r.granted)}>
                {(r) => (
                  <li class="lic-feature">
                    <span class="lic-feature-name">{S["feat_" + r.key] ?? S.fmt("featFallback", r.key)}</span>
                    <span class="lic-chip lic-chip-on">{S.featIncluded}</span>
                  </li>
                )}
              </For>
            </ul>
            <div class="lic-actions">
              <button type="button" class="lic-btn lic-btn-accent" onClick={() => set("step", "welcome")}>{S.wizFinish}</button>
            </div>
          </Show>
        </section>
      </Show>

      <Show when={st.phase === "ready" && state() === "pro" && st.step !== "done"}>
        <section class="lic-section">
          <div class="lic-plan">
            <span class="lic-badge lic-badge-pro">{S.planProTitle}</span>
            <p class="lic-plan-text">{S.planProActive}</p>
          </div>
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
        </section>
      </Show>

      <Show when={st.phase === "ready" && st.step !== "done"}>
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
                  <span class={"lic-chip lic-chip-" + (r.granted ? "on" : "off")}>{r.granted ? S.featIncluded : S.featLocked}</span>
                </li>
              )}
            </For>
          </ul>
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
