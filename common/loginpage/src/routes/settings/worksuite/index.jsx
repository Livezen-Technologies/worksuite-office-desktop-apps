/* Settings › WorkSuite (SHL-08, G-16): accounts, Drive, updates, managed settings, about; organisation-set values locked (ADM-01) */
import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { L } from "@/worksuite/lang.js";
import "@/worksuite/core.js";
import { hostOf } from "@/worksuite/cards.jsx";
import { SignInDialog } from "@/worksuite/dialogs.jsx";
import { versionInfo, updateStatus, execUpdateAction, openAbout } from "@/services/about";
import { command } from "@/sdk/bridge";
import {
  policy, serverLocked, updates, updateReady, setUpdateChannel, setUpdateAuto, checkForUpdates, restartToUpdate,
  openIn, setOpenIn, prefServer, setPrefServer, initWorkSuiteShell,
} from "@/worksuite/shell.js";
import { parseReleaseNotes } from "@/worksuite/shell-logic.js";
import { mergeAccounts, updatePhase } from "@/worksuite/settings-logic.js";
import { PolicyBanner, PolicyCard } from "@/worksuite/ShellParts.jsx";
import {
  AccountCard, LockHint, Segmented, ServerInput, SettingsLayout, SettingsRow, SettingsSection, SettingsToggle, UpdateCard, WsButton,
} from "@/worksuite/ui/components.jsx";
import "@/worksuite/worksuite.css";
import "./worksuite-settings.css";

const WS = () => window.WorkSuite;
const SECTION_KEY = "ws:settings:section";

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

/* "10.1.3.42 (x64 msi)" → {version: "10.1.3", build: "42", extra: "x64 msi"} */
function splitVersion(raw) {
  const m = /^\s*([\d.]+)\s*(?:\((.*)\))?/.exec(String(raw || ""));
  if (!m) return { version: String(raw || ""), build: "", extra: "" };
  const parts = m[1].split(".");
  return { version: parts.slice(0, 3).join("."), build: parts[3] || "", extra: m[2] || "" };
}

function licenceOf(html) {
  const a = /<a\s([\s\S]*?)>([\s\S]*?)<\/a>/i.exec(String(html || ""));
  if (!a) return null;
  const url = (/window\.open\(['"]([^'"]+)['"]\)/i.exec(a[1]) || /href=["']([^"'#][^"']*)["']/i.exec(a[1]) || [])[1];
  return url ? { url, text: a[2].replace(/<[^>]+>/g, "").trim() } : null;
}

export default function WorkSuiteSettings() {
  const [accounts, setAccounts] = createSignal(WS().accounts());
  const [activeId, setActiveId] = createSignal(WS().active() && WS().active().id);
  const [desktop, setDesktop] = createSignal([]);
  const [looking, setLooking] = createSignal(true);
  const [signingIn, setSigningIn] = createSignal(null); // {desktopAccount, id} while the sign-in dialog is open
  const [busy, setBusy] = createSignal({}); // account id → "signout" | "remove"
  const [errors, setErrors] = createSignal({});
  const [section, setSectionSig] = createSignal((() => {
    try { return sessionStorage.getItem(SECTION_KEY) || "accounts"; } catch { return "accounts"; }
  })());
  const setSection = (s) => {
    setSectionSig(s);
    try { sessionStorage.setItem(SECTION_KEY, s); } catch {}
  };

  const refresh = () => {
    setAccounts(WS().accounts());
    setActiveId(WS().active() && WS().active().id);
  };
  const findDesktop = () => {
    setLooking(true);
    WS().desktopAccounts().then((list) => setDesktop(list || []), () => setDesktop([])).finally(() => setLooking(false));
  };
  onMount(() => {
    initWorkSuiteShell();
    ["signedin", "changed"].forEach((e) => WS().on(e, refresh));
    findDesktop();
  });
  onCleanup(() => ["signedin", "changed"].forEach((e) => WS().off(e, refresh)));

  const known = createMemo(() => mergeAccounts(accounts(), desktop()));

  async function run(account, kind) {
    setBusy({ ...busy(), [account.id]: kind });
    setErrors({ ...errors(), [account.id]: "" });
    try {
      await WS().signOut(account);
    } catch (e) {
      setErrors({ ...errors(), [account.id]: (e && e.message) || L.wsErrServer });
    } finally {
      const b = { ...busy() };
      delete b[account.id];
      setBusy(b);
      refresh();
      findDesktop();
    }
  }

  const sections = () => [
    { id: "general", label: L.wsxNavGeneral, icon: "general", href: "/settings/general" },
    { id: "accounts", label: L.wsAccounts, icon: "accounts" },
    { id: "drive", label: L.wsTitle, icon: "drive" },
    { id: "updates", label: L.wsUpdates, icon: "updates" },
    { id: "advanced", label: L.wsxNavAdvanced, icon: "advanced" },
    { id: "about", label: L.wsxNavAbout, icon: "about" },
  ];

  /* ---- updates ---- */
  const versions = () => splitVersion(versionInfo()?.version || updates().version || "");
  const channel = () => policy().updateChannel || updates().channel || "stable";
  const auto = () => (policy().updateAuto !== undefined ? policy().updateAuto : !!updates().auto);
  const phase = () => updatePhase(updates(), updateReady(), updateStatus());
  const lastCheck = () => updates().lastCheck
    ? L.wsLastChecked.replace("$1", when(updates().lastCheck)).replace("$2", updates().host || "download.worksuitecloud.com")
    : L.wsNeverChecked;
  const notes = () => parseReleaseNotes((updateReady() && updateReady().notes) || "");

  const effectiveServer = () => (serverLocked() ? policy().server : WS().DEFAULT_SERVER);
  const active = () => accounts().find((a) => a.id === activeId());
  const licence = () => licenceOf(versionInfo()?.edition);

  return (
    <div class="wss-page">
      <PolicyBanner />
      <SettingsLayout label={L.wsxSettingsNav} sections={sections()} active={section()} onSelect={setSection}>
        <Show when={section() === "accounts"}>
          <SettingsSection title={L.wsAccounts} description={L.wsxAccountsDesc}
                           actions={<WsButton variant="primary" icon="accounts" disabled={!!signingIn()} onClick={() => setSigningIn({ desktopAccount: null })}>{L.wsxAddAccount}</WsButton>}>
            <Show when={known().length} fallback={
              <Show when={!looking()} fallback={<div class="wsx-skeleton" role="status" aria-label={L.wsLoading} />}>
                <div class="wsx-empty">
                  {L.wsNoAccounts}
                  <WsButton variant="link" onClick={() => setSigningIn({ desktopAccount: null })}>{L.wsSignInTitle}</WsButton>
                </div>
              </Show>
            }>
              <div class="wsx-accounts">
                <For each={known()}>
                  {(a) => (
                    <AccountCard account={a} isDefault={a.id === activeId() && !a.signedOut}
                                 busy={busy()[a.id] || (signingIn() && signingIn().id === a.id ? "signin" : null)}
                                 error={errors()[a.id]}
                                 via={a.desktopOnly ? L.wsViaDesktop : a.signedOut ? (a.desktop ? L.wsViaDesktop : "") : via(a)}
                                 onSetDefault={accounts().length > 1 ? () => WS().setActive(a.id) : null}
                                 onSignIn={() => setSigningIn({ desktopAccount: a.desktop || null, id: a.id })}
                                 onSignOut={() => run(a, "signout")}
                                 onRemove={() => run(a, "remove")} />
                  )}
                </For>
              </div>
              <Show when={looking()}><p class="wsx-hint" role="status">{L.wsxLookingDesktop}</p></Show>
            </Show>
            <p class="wsx-hint">{L.wsxSignOutNote}</p>
          </SettingsSection>
        </Show>

        <Show when={section() === "drive"}>
          <SettingsSection title={L.wsTitle} description={L.wsxDriveDesc}>
            <Show when={!serverLocked()} fallback={
              <SettingsRow label={L.wsDefaultServer} locked hint={L.wsAskIt}>
                <span class="wsx-label">{hostOf(policy().server)}</span>
              </SettingsRow>
            }>
              <ServerInput label={L.wsDefaultServer} value={prefServer() || ""} placeholder={hostOf(WS().BUILT_IN_SERVER)}
                           placeholderServer={WS().BUILT_IN_SERVER} hint={L.wsxServerHint}
                           onSave={(v) => setPrefServer(v)} test={(s) => WS().checkServer(s)} />
            </Show>
            <dl class="wsx-kv">
              <dt>{L.wsxNewSignIns}</dt><dd>{hostOf(effectiveServer())}</dd>
              <dt>{L.wsxConnectedTo}</dt>
              <dd>{active() && !active().signedOut ? active().user.name + " · " + hostOf(active().server) : L.wsxNotConnected}</dd>
            </dl>
            <div class="wsx-row wsx-row-stack">
              <div class="wsx-row-label"><span class="wsx-label" id="wss-openin">{L.wsOpenDriveIn}</span></div>
              <Segmented variant="cards" labelledBy="wss-openin" value={openIn()} onChange={setOpenIn}
                         options={[
                           { value: "office", label: L.wsOpenInOffice, description: L.wsxOpenInOfficeDesc },
                           { value: "browser", label: L.wsOpenInBrowser, description: L.wsxOpenInBrowserDesc },
                         ]} />
            </div>
          </SettingsSection>
        </Show>

        <Show when={section() === "updates"}>
          <SettingsSection title={L.wsUpdates}>
            <Show when={phase().phase !== "unavailable"} fallback={
              <>
                <p class="wsx-hint">{L.wsUpdatesUnavailable}</p>
                <dl class="wsx-kv"><dt>{L.wsxVersion}</dt><dd>{versions().version}{versions().build ? " · " + L.wsxBuild.replace("$1", versions().build) : ""}</dd></dl>
              </>
            }>
              <UpdateCard phase={phase()} version={versions().version} build={versions().build} lastCheck={lastCheck()} notes={notes()}
                          onCheck={checkForUpdates} onRestart={restartToUpdate} onAction={() => execUpdateAction()} />
              <SettingsRow label={L.wsUpdateChannel} locked={policy().locked.updateChannel} hint={L.wsxChannelHint} labelId="wss-channel">
                <Segmented labelledBy="wss-channel" value={channel()} disabled={policy().locked.updateChannel}
                           onChange={(v) => setUpdateChannel(v)}
                           options={[{ value: "stable", label: L.wsChannelStable }, { value: "beta", label: L.wsChannelBeta }]} />
              </SettingsRow>
              <SettingsToggle label={L.wsAutoInstall} description={L.wsxAutoHint} checked={auto()} locked={policy().locked.updateAuto}
                              onChange={(v) => setUpdateAuto(v)} />
            </Show>
          </SettingsSection>
        </Show>

        <Show when={section() === "advanced"}>
          <SettingsSection title={L.wsxNavAdvanced} description={L.wsxAdvancedDesc}>
            <dl class="wsx-kv">
              <dt>{L.wsxManaged}</dt>
              <dd>{policy().managed ? (policy().organization ? L.wsManagedBy.replace("$1", policy().organization) : L.wsManagedByOrg) : L.wsxNotManaged}</dd>
              <dt>{L.wsxSecrets}</dt><dd>{WS().secretStoreKind ? WS().secretStoreKind() || "—" : "—"}</dd>
              <Show when={active() && WS().capability(active())}>
                <dt>{L.wsxServerModules}</dt>
                <dd>{Object.entries(WS().capability(active()).versions || {}).map(([k, v]) => k + " " + v).join(", ") || "—"}</dd>
              </Show>
            </dl>
            <Show when={policy().managed}><LockHint when /></Show>
          </SettingsSection>
          <PolicyCard />
        </Show>

        <Show when={section() === "about"}>
          <SettingsSection title={L.wsxNavAbout}
                           actions={<WsButton variant="secondary" icon="about" onClick={openAbout}>{L.wsxAboutMore}</WsButton>}>
            <dl class="wsx-kv">
              <dt>{L.wsxProduct}</dt><dd>{versionInfo()?.appname || "WorkSuite Office"}</dd>
              <dt>{L.wsxVersion}</dt><dd>{versions().version || "—"}</dd>
              <Show when={versions().build}><dt>{L.wsxBuildLabel}</dt><dd>{versions().build}</dd></Show>
              <Show when={versions().extra}><dt>{L.wsxPackage}</dt><dd>{versions().extra}</dd></Show>
              <Show when={versionInfo()?.site}>
                <dt>{L.wsxWebsite}</dt>
                <dd><a class="wsx-link" href={versionInfo().link || "https://" + versionInfo().site} target="_blank" rel="noreferrer">{versionInfo().site}</a></dd>
              </Show>
              <Show when={licence()}>
                <dt>{L.wsxLicence}</dt>
                <dd><a class="wsx-link" href="#" onClick={(e) => { e.preventDefault(); command("open:license", licence().url); }}>{licence().text}</a></dd>
              </Show>
            </dl>
          </SettingsSection>
        </Show>
      </SettingsLayout>

      <Show when={signingIn()}>
        <SignInDialog desktopAccount={signingIn().desktopAccount} onClose={() => { setSigningIn(null); refresh(); findDesktop(); }} />
      </Show>
    </div>
  );
}
