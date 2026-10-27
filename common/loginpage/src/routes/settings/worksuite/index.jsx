/* Settings › WorkSuite (SHL-08, G-16): accounts, Drive, updates, managed settings, about; organisation-set values locked (ADM-01) */
import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { L } from "@/worksuite/lang.js";
import "@/worksuite/core.js";
import { hostOf } from "@/worksuite/cards.jsx";
import { SignInDialog } from "@/worksuite/dialogs.jsx";
import { AccountWizard } from "@/worksuite/account-wizard.jsx";
import { versionInfo, updateStatus, execUpdateAction, openAbout } from "@/services/about";
import { command } from "@/sdk/bridge";
import { t } from "@/services/l10n";
import { settings, setSettings } from "@/stores/settings";
import { isOptsChanged, applySettings, pendingApplyText, needsRestart } from "@/services/settings-sync";
import { DOC_PREFS, docPrefOptions, setDocPref } from "@/worksuite/doc-prefs.js";
import {
  policy, serverLocked, updates, updateReady, updateProgress, setUpdateChannel, setUpdateAuto, checkForUpdates, restartToUpdate,
  downloadUpdate, cancelUpdateDownload,
  openIn, setOpenIn, prefServer, setPrefServer, initWorkSuiteShell,
} from "@/worksuite/shell.js";
import { parseReleaseNotes } from "@/worksuite/shell-logic.js";
import { formatBytes, mergeAccounts, updatePhase } from "@/worksuite/settings-logic.js";
import { PolicyBanner, PolicyCard } from "@/worksuite/ShellParts.jsx";
import {
  AccountCard, Avatar, Icon, LockHint, Segmented, ServerInput, SettingsLayout, SettingsRow, SettingsSection, SettingsToggle, UpdateCard, WsButton,
} from "@/worksuite/ui/components.jsx";
import "@/worksuite/worksuite.css";
import "./worksuite-settings.css";

const WS = () => window.WorkSuite;
const SECTION_KEY = "ws:settings:section";

function via(account) {
  if (account.broker || account.via === "os") return L.wsViaOsShort;
  if (account.cloud) return L.wsCloudPersonal.replace("$1", account.cloud.name || hostOf(account.server)) + " · " + L.wsViaCloud;
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
  const [cardNotes, setCardNotes] = createSignal({}); // account id → a note on its card ("already added")
  const [unreachable, setUnreachable] = createSignal({}); // server → true when it did not answer
  const [wizard, setWizard] = createSignal(null); // {server} while "Add account" is open
  const [focusId, setFocusId] = createSignal(null);
  const [clouds, setClouds] = createSignal(WS().cloudAccounts()); // WorkSuite Cloud accounts (Personal)
  const [storage, setStorage] = createSignal({}); // cloud account id → {used, limit}
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
    setClouds(WS().cloudAccounts());
  };
  /* Each WorkSuite Cloud account as Cloud sees it now (its workspace's state) and its storage, once per visit */
  const checkClouds = () => WS().cloudAccounts().filter((c) => !c.signedOut).forEach((c) => {
    WS().refreshCloud(c).then((fresh) => WS().cloudStorage(fresh)).then(
      (u) => setStorage({ ...storage(), [c.id]: u }),
      () => {},
    );
  });
  const findDesktop = () => {
    setLooking(true);
    WS().desktopAccounts().then((list) => setDesktop(list || []), () => setDesktop([])).finally(() => setLooking(false));
  };
  onMount(() => {
    initWorkSuiteShell();
    ["signedin", "changed"].forEach((e) => WS().on(e, refresh));
    findDesktop();
    probeServers();
    checkClouds();
  });
  onCleanup(() => ["signedin", "changed"].forEach((e) => WS().off(e, refresh)));

  const known = createMemo(() => mergeAccounts(accounts(), desktop()));

  /* "Server unreachable": each signed-in account's server, asked once when the page opens */
  function probeServers() {
    const servers = WS().accounts().filter((a) => !a.signedOut).map((a) => a.server).filter((s, i, all) => all.indexOf(s) === i);
    servers.forEach((server) => WS().checkServer(server).then(
      () => setUnreachable({ ...unreachable(), [server]: false }),
      () => setUnreachable({ ...unreachable(), [server]: true }),
    ));
  }

  const setOne = (get, set, id, v) => set({ ...get(), [id]: v });

  /* Reconnect: the kept session first (silent refresh), the wizard only when that is not enough */
  async function connect(a) {
    setOne(errors, setErrors, a.id, "");
    if (a.desktopOnly) return setSigningIn({ desktopAccount: a.desktop, id: a.id });
    setOne(busy, setBusy, a.id, "signin");
    const r = await WS().reconnect(a).catch(() => ({ signIn: true }));
    const b = { ...busy() };
    delete b[a.id];
    setBusy(b);
    if (r.ok) {
      setUnreachable({ ...unreachable(), [a.server]: false });
      return refresh();
    }
    if (r.unreachable) {
      setUnreachable({ ...unreachable(), [a.server]: true });
      return setOne(errors, setErrors, a.id, L.wsxUnreachableMsg.replace("$1", hostOf(a.server)));
    }
    if (a.desktop) return setSigningIn({ desktopAccount: a.desktop, id: a.id });
    // a WorkSuite Cloud workspace signs in again through WorkSuite Cloud
    if (a.cloud && WS().cloudAllowed()) return setWizard({ server: "", cloud: true });
    setWizard({ server: a.server });
  }

  async function signOutCloud(c) {
    setOne(busy, setBusy, c.id, "signout");
    setOne(errors, setErrors, c.id, "");
    try {
      await WS().signOutCloud(c);
    } catch (e) {
      setOne(errors, setErrors, c.id, (e && e.message) || L.wsErrServer);
    } finally {
      const b = { ...busy() };
      delete b[c.id];
      setBusy(b);
      refresh();
    }
  }

  const cloudNote = (c) => {
    if (c.signedOut) return L.wsCloudExpired;
    return ({ "setting-up": L.wsCloudSettingUp, failed: L.wsCloudFailed, "verify-email": L.wsCloudVerifyEmail, none: L.wsCloudNoOrg,
              "read-only": L.wsCloudReadOnly })[c.state] || "";
  };
  const cloudMeta = (c) => {
    const org = (c.orgs || []).find((o) => o.id === c.org);
    const u = storage()[c.id];
    return [c.user.email, org && org.name, u && u.limit ? L.wsCloudStorage.replace("$1", formatBytes(u.used)).replace("$2", formatBytes(u.limit)) : ""]
      .filter(Boolean).join(" · ");
  };

  function wizardClosed(result) {
    setWizard(null);
    refresh();
    findDesktop();
    if (result && result.id) {
      if (result.duplicate) setOne(cardNotes, setCardNotes, result.id, L.wsxAlreadyAdded);
      setFocusId(null);
      queueMicrotask(() => setFocusId(result.id));
    }
  }

  async function run(account, kind) {
    setBusy({ ...busy(), [account.id]: kind });
    setErrors({ ...errors(), [account.id]: "" });
    try {
      await (kind === "remove" ? WS().remove(account) : WS().signOutOnly(account));
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
    { id: "documents", label: L.wsxNavDocuments, icon: "documents" },
    { id: "updates", label: L.wsUpdates, icon: "updates" },
    { id: "advanced", label: L.wsxNavAdvanced, icon: "advanced" },
    { id: "about", label: L.wsxNavAbout, icon: "about" },
  ];

  /* ---- updates ---- */
  const versions = () => splitVersion(versionInfo()?.version || updates().version || "");
  const channel = () => policy().updateChannel || updates().channel || "stable";
  const auto = () => (policy().updateAuto !== undefined ? policy().updateAuto : !!updates().auto);
  const phase = () => updatePhase(updates(), updateReady(), updateStatus(), updateProgress());
  /* "ws-download": the app's own download with progress (macOS Sparkle, Windows); others: the update service */
  const updateAction = (action) => (action === "ws-download" ? downloadUpdate() : execUpdateAction());
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
                           actions={<WsButton variant="primary" icon="plus" disabled={!!signingIn() || !!wizard()} onClick={() => setWizard({ server: "" })}>{L.wsxAddAccount}</WsButton>}>
            <Show when={known().length} fallback={
              <Show when={!looking()} fallback={<div class="wsx-skeleton" role="status" aria-label={L.wsLoading} />}>
                <div class="wsx-empty">
                  {L.wsNoAccounts}
                  <WsButton variant="link" onClick={() => setWizard({ server: "" })}>{L.wsSignInTitle}</WsButton>
                </div>
              </Show>
            }>
              <div class="wsx-accounts">
                <For each={known()}>
                  {(a) => (
                    <AccountCard account={a} isDefault={a.id === activeId() && !a.signedOut} multiple={accounts().filter((x) => !x.signedOut).length > 1}
                                 unreachable={!a.signedOut && !a.desktopOnly && !!unreachable()[a.server]}
                                 busy={busy()[a.id] || (signingIn() && signingIn().id === a.id ? "signin" : null)}
                                 error={errors()[a.id]} note={cardNotes()[a.id]} focused={focusId() === a.id}
                                 via={a.desktopOnly ? L.wsViaDesktop : a.signedOut ? (a.desktop ? L.wsViaDesktop : "") : via(a)}
                                 onConnect={() => connect(a)}
                                 onSwitch={() => WS().setActive(a.id)}
                                 onSignOut={() => run(a, "signout")}
                                 onRemove={() => run(a, "remove")} />
                  )}
                </For>
              </div>
              <Show when={looking()}><p class="wsx-hint" role="status">{L.wsxLookingDesktop}</p></Show>
            </Show>
            <p class="wsx-hint">{L.wsxSignOutNote2}</p>
            <Show when={clouds().length}>
              <h4 class="wsx-label wss-cloud-title">{L.wsCloudTitle}</h4>
              <p class="wsx-hint">{L.wsCloudDesc}</p>
              <div class="wsx-accounts">
                <For each={clouds()}>
                  {(c) => (
                    <div class="wsx-account" data-cloud-account={c.id}>
                      <Avatar name={c.user.name} />
                      <div class="wsx-account-text">
                        <div class="wsx-account-name"><span class="wsx-ellipsis">{c.user.name}</span></div>
                        <div class="wsx-account-meta wsx-ellipsis" title={c.user.email || ""}>{cloudMeta(c)}</div>
                        <Show when={cloudNote(c)}><div class="wsx-msg wsx-tone-info"><Icon name="about" />{cloudNote(c)}</div></Show>
                        <Show when={errors()[c.id]}><div class="wsx-msg wsx-tone-danger" role="alert"><Icon name="alert" />{errors()[c.id]}</div></Show>
                      </div>
                      <div class="wsx-account-actions">
                        <WsButton small variant="primary" disabled={!!busy()[c.id] || !!wizard()} onClick={() => setWizard({ server: "", cloud: true })}>
                          {c.signedOut ? L.wsxSignInAgain : L.wsCloudOpen}
                        </WsButton>
                        <WsButton small variant="ghost" busy={busy()[c.id] === "signout"} disabled={!!busy()[c.id]} onClick={() => signOutCloud(c)}>{L.wsCloudSignOut}</WsButton>
                      </div>
                    </div>
                  )}
                </For>
              </div>
              <p class="wsx-hint">{L.wsCloudSignOutNote}</p>
            </Show>
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

        <Show when={section() === "documents"}>
          {/* the same store and Apply as Settings › General (worksuite/doc-prefs.js): no copy of the values */}
          <SettingsSection title={L.wsxNavDocuments} description={L.wsxDocumentsDesc}>
            <For each={DOC_PREFS}>
              {(pref) => (
                <SettingsRow label={t(pref.labelKey)} labelId={"wss-doc-" + pref.key}
                             hint={pref.key === "launchMode" ? L.wsxDocOpenHint : L.wsxDocSpellHint}>
                  <Segmented labelledBy={"wss-doc-" + pref.key} value={settings[pref.key]}
                             onChange={(v) => setDocPref(setSettings, pref.key, v)}
                             options={docPrefOptions(pref.key, t)} />
                </SettingsRow>
              )}
            </For>
            <div class="wss-apply" role="status" aria-live="polite">
              <div class="wss-apply-text">
                <Show when={isOptsChanged()}><span class="wsx-hint">{L.wsxDocPending}</span></Show>
                <Show when={needsRestart()}><span class="wsx-hint wss-restart">{L.wsxDocRestart}</span></Show>
              </div>
              <WsButton variant="primary" disabled={!isOptsChanged()} onClick={applySettings}>{pendingApplyText() ?? t("setBtnApply")}</WsButton>
            </div>
            <p class="wsx-hint">
              {L.wsxDocInGeneral}: <a class="wsx-link" href="#/settings/general">{L.wsxNavGeneral}</a>
            </p>
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
                          onCheck={checkForUpdates} onRestart={restartToUpdate} onAction={updateAction}
                          onCancel={cancelUpdateDownload} />
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
                           actions={<WsButton variant="secondary" icon="about" onClick={() => openAbout({ appname: "WorkSuite Office", version: versionInfo()?.version || updates().version || "" })}>{L.wsxAboutMore}</WsButton>}>
            <dl class="wsx-kv">
              <dt>{L.wsxProduct}</dt><dd>{versionInfo()?.appname || "WorkSuite Office"}</dd>
              <dt>{L.wsxDeveloper}</dt><dd>{L.wsxCompany}</dd>
              <dt>{L.wsxVersion}</dt><dd>{versions().version || "—"}</dd>
              <Show when={versions().build}><dt>{L.wsxBuildLabel}</dt><dd>{versions().build}</dd></Show>
              <Show when={versions().extra}><dt>{L.wsxPackage}</dt><dd>{versions().extra}</dd></Show>
              <dt>{L.wsxWebsite}</dt>
              <dd><a class="wsx-link" href={versionInfo()?.link || "https://" + (versionInfo()?.site || "worksuitecloud.com")} target="_blank" rel="noreferrer">{versionInfo()?.site || "worksuitecloud.com"}</a></dd>
              <Show when={licence()}>
                <dt>{L.wsxLicence}</dt>
                <dd><a class="wsx-link" href="#" onClick={(e) => { e.preventDefault(); command("open:license", licence().url); }}>{licence().text}</a></dd>
              </Show>
            </dl>
          </SettingsSection>
        </Show>
      </SettingsLayout>

      <Show when={wizard()}>
        <AccountWizard server={serverLocked() ? policy().server : wizard().server} locked={serverLocked()} desktop={desktop()}
                       known={[...accounts().map((a) => a.server), ...desktop().map((d) => d.server), WS().DEFAULT_SERVER]}
                       cloud={!!wizard().cloud} onClose={wizardClosed} />
      </Show>
      <Show when={signingIn()}>
        <SignInDialog desktopAccount={signingIn().desktopAccount} onClose={() => { setSigningIn(null); refresh(); findDesktop(); }} />
      </Show>
    </div>
  );
}
