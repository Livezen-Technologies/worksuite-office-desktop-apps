/* Settings › WorkSuite (SHL-08, G-16): accounts, Drive, updates; organisation-set values locked (ADM-01) */
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { Button, Select, Switch } from "@/components";
import { L } from "@/worksuite/lang.js";
import "@/worksuite/core.js";
import { hostOf, initials } from "@/worksuite/cards.jsx";
import { SignInDialog } from "@/worksuite/dialogs.jsx";
import { versionInfo } from "@/services/about";
import {
  policy, serverLocked, updates, setUpdateChannel, setUpdateAuto, checkForUpdates,
  openIn, setOpenIn, prefServer, setPrefServer, initWorkSuiteShell,
} from "@/worksuite/shell.js";
import { PolicyBanner, PolicyCard } from "@/worksuite/ShellParts.jsx";
import "@/worksuite/worksuite.css";
import "./worksuite-settings.css";

const WS = () => window.WorkSuite;

function Locked(props) {
  return (
    <Show when={props.when}>
      <span class="wss-lock">{L.wsLockedByOrg}</span>
    </Show>
  );
}

function via(account) {
  if (account.broker || account.via === "os") return L.wsViaOsShort;
  if (account.via === "desktop") return L.wsViaDesktopShort;
  return L.wsViaBrowser;
}

function when(epochSeconds) {
  if (!epochSeconds) return "";
  const d = new Date(Number(epochSeconds) * 1000);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleString();
}

export default function WorkSuiteSettings() {
  const [accounts, setAccounts] = createSignal(WS().accounts());
  const [signingIn, setSigningIn] = createSignal(false);
  const [serverText, setServerText] = createSignal(prefServer() || "");

  const refresh = () => setAccounts(WS().accounts());
  onMount(() => {
    initWorkSuiteShell();
    ["signedin", "changed"].forEach((e) => WS().on(e, refresh));
  });
  onCleanup(() => ["signedin", "changed"].forEach((e) => WS().off(e, refresh)));

  async function signOut(account) {
    await WS().signOut(account).catch(() => {});
    refresh();
  }

  function saveServer() {
    const s = WS().normalizeServer(serverText());
    setPrefServer(s || "");
    setServerText(s || "");
  }

  const channelOptions = () => [
    { value: "stable", label: L.wsChannelStable },
    { value: "beta", label: L.wsChannelBeta },
  ];
  const version = () => (versionInfo()?.version || updates().version || "").replace(/\s*\(.*\)$/, "");
  const channel = () => policy().updateChannel || updates().channel || "stable";
  const auto = () => (policy().updateAuto !== undefined ? policy().updateAuto : !!updates().auto);

  return (
    <div class="wss-page">
      <PolicyBanner />
      <section class="wss-sec">
        <div class="wss-head">
          <h2 class="wss-h2">{L.wsAccounts}</h2>
          <Button variant="outline" onClick={() => setSigningIn(true)}>{L.wsAddAccount}</Button>
        </div>
        <Show when={accounts().length} fallback={<p class="wss-muted">{L.wsNoAccounts}</p>}>
          <For each={accounts()}>
            {(a) => (
              <div class="wss-acc">
                <span class="wss-av" aria-hidden="true">{initials(a.user.name)}</span>
                <div class="wss-acc-text">
                  <div class="wss-strong">{a.user.name}</div>
                  <div class="wss-muted">
                    {[a.user.organization, hostOf(a.server), a.signedOut ? L.wsSignedOutShort : via(a)].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <Show when={!a.signedOut}>
                  <Button variant="outline" onClick={() => signOut(a)}>{L.wsSignOutBtn}</Button>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </section>

      <div class="wss-grid">
        <section class="wss-sec">
          <h2 class="wss-h2">{L.wsDrive}</h2>
          <label class="wss-label" for="wss-server">{L.wsDefaultServer}<Locked when={serverLocked()} /></label>
          <Show when={!serverLocked()} fallback={<div class="wss-value">{hostOf(policy().server)}</div>}>
            <input id="wss-server" class="ws-input wss-input" spellcheck={false} placeholder={hostOf(WS().BUILT_IN_SERVER)}
                   value={serverText()} onInput={(e) => setServerText(e.currentTarget.value)}
                   onBlur={saveServer} onKeyDown={(e) => e.key === "Enter" && saveServer()} />
          </Show>
          <div class="wss-label">{L.wsOpenDriveIn}</div>
          <div role="radiogroup" class="wss-radios">
            <For each={[["office", L.wsOpenInOffice], ["browser", L.wsOpenInBrowser]]}>
              {([v, label]) => (
                <label class="wss-radio">
                  <input type="radio" name="wss-openin" checked={openIn() === v} onChange={() => setOpenIn(v)} />
                  {label}
                </label>
              )}
            </For>
          </div>
        </section>

        <section class="wss-sec">
          <h2 class="wss-h2">{L.wsUpdates}</h2>
          <Show when={updates().available !== false} fallback={<p class="wss-muted">{L.wsUpdatesUnavailable}</p>}>
            <Show when={updates().text} fallback={
              <div class="wss-ok">{L.wsUpToDate.replace("$1", version())}</div>
            }>
              <div class="wss-strong">{updates().text}</div>
            </Show>
            <div class="wss-muted">
              {updates().lastCheck
                ? L.wsLastChecked.replace("$1", when(updates().lastCheck)).replace("$2", updates().host || "download.worksuitecloud.com")
                : L.wsNeverChecked}
            </div>
            <div class="wss-row">
              <span class="wss-label">{L.wsUpdateChannel}<Locked when={policy().locked.updateChannel} /></span>
              <Select options={channelOptions()} value={channel()} disabled={policy().locked.updateChannel}
                      onChange={(v) => v && setUpdateChannel(v)} disallowEmptySelection>
                <Select.Trigger class="wss-select" />
                <Select.Content />
              </Select>
            </div>
            <div class="wss-row">
              <Switch checked={auto()} disabled={policy().locked.updateAuto} onChange={(v) => setUpdateAuto(v)}>
                <span class="wss-switch-label">{L.wsAutoInstall}</span>
              </Switch>
              <Locked when={policy().locked.updateAuto} />
            </div>
            <div>
              <Button variant="outline" disabled={updates().busy} onClick={checkForUpdates}>{L.wsCheckUpdates}</Button>
            </div>
          </Show>
        </section>
      </div>

      <PolicyCard />

      <Show when={signingIn()}>
        <SignInDialog desktopAccount={null} onClose={() => { setSigningIn(false); refresh(); }} />
      </Show>
    </div>
  );
}
