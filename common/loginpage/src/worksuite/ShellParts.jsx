/*
 * WorkSuite parts of the app shell: the Update ready banner and dialog (SHL-09, UPD-04),
 * "Back online — someone saved meanwhile" (DOC-07) and the organisation policy card (ADM-01, CLD-02).
 */
import { For, Show, createSignal, onMount } from "solid-js";
import { Button } from "@/components";
import { L } from "./lang.js";
import { Frame } from "./dialogs.jsx";
import { hostOf } from "./cards.jsx";
import { parseReleaseNotes } from "./shell-logic.js";
import {
  initWorkSuiteShell, updateReady, dismissUpdateReady, restartToUpdate, policy,
  offlineChoice, openNewerVersion, keepBoth, online,
} from "./shell.js";
import "./worksuite.css";

const channelName = (c) => (c === "beta" ? L.wsChannelBeta : L.wsChannelStable);

export function UpdateBanner() {
  const [open, setOpen] = createSignal(false);
  onMount(initWorkSuiteShell);
  const ready = () => updateReady();
  const notes = () => parseReleaseNotes(ready()?.notes || "");

  return (
    <Show when={ready() && ready().version}>
      <Show when={!ready().dismissed}>
        <div class="ws-update-banner" role="status">
          <span class="ws-update-text">{L.wsUpdateBanner.replace("$1", ready().version)}</span>
          <a href="#" class="ws-link" onClick={(e) => { e.preventDefault(); setOpen(true); }}>{L.wsWhatsNew}</a>
          <Button variant="accent" onClick={restartToUpdate}>{L.wsRestartToUpdate}</Button>
        </div>
      </Show>
      <Show when={open()}>
        <Frame title={L.wsUpdateTitle.replace("$1", ready().version)} onClose={() => setOpen(false)}>
          <p class="ws-update-meta">
            <Show when={ready().verified !== false}><span>{L.wsVerified}</span> · </Show>
            <span>{L.wsChannelName.replace("$1", channelName(ready().channel))}</span>
          </p>
          <Show when={ready().signatureChecked && ready().signer}>
            <p class="ws-update-sig">{L.wsSignedBy.replace("$1", ready().signer)}</p>
          </Show>
          <Show when={notes().length}>
            <div class="ws-update-notes">
              <For each={notes()}>
                {(s) => (
                  <>
                    <Show when={s.title}><h3 class="ws-update-h3">{s.title}</h3></Show>
                    <ul><For each={s.items}>{(i) => <li>{i}</li>}</For></ul>
                  </>
                )}
              </For>
            </div>
          </Show>
          <p class="ws-update-meta">{L.wsSavedFirst}</p>
          <div class="ws-dlg-actions">
            <Button variant="outline" onClick={() => { setOpen(false); dismissUpdateReady(); }}>{L.wsLater}</Button>
            <Button variant="accent" onClick={restartToUpdate}>{L.wsRestartToUpdate}</Button>
          </div>
        </Frame>
      </Show>
    </Show>
  );
}

export function OfflineChoiceDialog() {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  onMount(initWorkSuiteShell);
  const c = () => offlineChoice();

  async function both() {
    setBusy(true);
    setError("");
    const r = await keepBoth();
    setBusy(false);
    if (!r.ok) setError(L.wsKeepBothFailed);
  }

  return (
    <Show when={c()}>
      <Frame title={L.wsBackOnline} onClose={() => {}}>
        <p>{L.wsSavedMeanwhile.replace("$1", c().savedBy || L.wsSomeone)}</p>
        <div class="ws-offline-vs">
          <div class="ws-offline-v ws-offline-me">
            <strong>{L.wsYourOffline}</strong>
            <span class="ws-muted">{L.wsStartedFrom.replace("$1", c().edit.baseVersion ?? "?")}</span>
          </div>
          <div class="ws-offline-v">
            <strong>{L.wsVersionN.replace("$1", c().serverVersion ?? "")}</strong>
            <span class="ws-muted">{[c().savedBy, c().savedAt].filter(Boolean).join(" · ")}</span>
          </div>
        </div>
        <p class="ws-muted">{L.wsKeepBothNote.replace("$1", c().copyName)}</p>
        <Show when={error()}><p class="ws-error" role="alert">{error()}</p></Show>
        <div class="ws-dlg-actions">
          <Button variant="outline" disabled={busy()} onClick={openNewerVersion}>{L.wsOpenVersion.replace("$1", c().serverVersion ?? "")}</Button>
          <Button variant="accent" disabled={busy() || !online()} onClick={both}>{L.wsKeepBoth}</Button>
        </div>
      </Frame>
    </Show>
  );
}

function onOff(v) {
  return v ? L.wsOn : L.wsOffWord;
}

/* "Livezen Technologies manages WorkSuite Office on this computer." and what it set */
export function PolicyBanner() {
  onMount(initWorkSuiteShell);
  const p = () => policy();
  return (
    <Show when={p().managed}>
      <div class="ws-managed" role="note">
        {p().organization ? L.wsManagedBy.replace("$1", p().organization) : L.wsManagedByOrg}
      </div>
    </Show>
  );
}

export function PolicyCard() {
  onMount(initWorkSuiteShell);
  const p = () => policy();
  const rows = () => [
    p().server && [L.wsPolicyServer, hostOf(p().server)],
    [L.wsPolicyClouds, onOff(!!p().allowOtherClouds)],
    (p().updateChannel || p().updateAuto !== undefined) && [L.wsPolicyChannel,
      [p().updateChannel && channelName(p().updateChannel), p().updateAuto !== undefined && (p().updateAuto ? L.wsAutomatic : L.wsManual)].filter(Boolean).join(", ")],
    p().usageReports !== undefined && [L.wsPolicyReports, onOff(p().usageReports)],
    p().aiFunctions && [L.wsPolicyAi, { all: L.wsAiAll, worksuite: L.wsAiWorkSuite, off: L.wsOffWord }[p().aiFunctions]],
  ].filter(Boolean);
  return (
    <Show when={p().managed}>
      <section class="ws-policy">
        <h2 class="ws-policy-title">{L.wsPolicyTitle}</h2>
        <div class="ws-policy-grid">
          <For each={rows()}>{([k, v]) => <><span>{k}</span><span class="ws-policy-val">{v}</span></>}</For>
        </div>
        <p class="ws-muted">{L.wsAskIt}</p>
      </section>
    </Show>
  );
}

/* the editor tab's offline indicator, for pages that host one */
export function OfflineBadge() {
  return <Show when={!online()}><span class="ws-offline-badge">{L.wsOfflineTab}</span></Show>;
}
