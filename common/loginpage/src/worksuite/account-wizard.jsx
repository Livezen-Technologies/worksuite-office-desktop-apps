/*
 * Add account: server → connectivity → choose (WorkSuite Desktop "Continue as" or another account) →
 * authenticate (the existing browser / WorkSuite Desktop hand-off of core.js) → verify → saved.
 * The steps are account-wizard-logic.js; this runs their effects. No password and no token is seen here.
 */
import { For, Match, Show, Switch, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { Dialog } from "@/components";
import { L } from "./lang.js";
import { hostOf } from "./cards.jsx";
import { initialWizard, stepIndex, wizardReducer, STEPS } from "./account-wizard-logic.js";
import { Avatar, Icon, Spinner, StatusBadge, WsButton } from "./ui/components.jsx";

const WS = () => window.WorkSuite;
const WAITS = { desktop: 2 * 60 * 1000, browser: 5 * 60 * 1000 };

/* props: onClose(result: {id, duplicate} | null), server (prefill), locked, known (servers to pick), desktop (Desktop accounts) */
export function AccountWizard(props) {
  const [st, setSt] = createSignal(initialWizard({ server: props.server || "", locked: props.locked }));
  const [code, setCode] = createSignal("");
  const [codeOpen, setCodeOpen] = createSignal(false);
  const [codeError, setCodeError] = createSignal("");
  let timer, before = [], finished = false;

  const ctx = () => ({ defaultServer: WS().DEFAULT_SERVER, desktop: props.desktop || [], accounts: WS().accounts() });
  const send = (ev) => setSt(wizardReducer(st(), ev, ctx()));

  /* effects of entering a state */
  createEffect(() => {
    const s = st();
    if (s.step === "checking") {
      const server = s.server;
      WS().checkServer(server).then(
        (r) => st().step === "checking" && st().server === server && send({ type: "PROBE_OK", office: r.office, name: r.name }),
        (e) => st().step === "checking" && st().server === server && send({ type: "PROBE_FAIL", message: e.message }),
      );
    }
  });

  function startAuth() {
    const s = st();
    clearTimeout(timer);
    before = WS().accounts().filter((a) => !a.signedOut).map((a) => a.id);
    const viaDesktop = s.via === "desktop";
    (viaDesktop ? WS().signInWithDesktop(s.pick) : WS().signIn(s.server)).then(
      () => { timer = setTimeout(() => { if (viaDesktop) WS().cancelSignIn(); send({ type: "AUTH_TIMEOUT" }); }, viaDesktop ? WAITS.desktop : WAITS.browser); },
      (e) => send({ type: "AUTH_ERROR", message: e.message }),
    );
  }
  createEffect((prev) => {
    const s = st();
    const key = s.step === "auth" && s.auth && s.auth.state === "waiting" ? s.via + ":" + (s.pick ? s.pick.user.id : "") + ":" + Date.now() : null;
    if (key && !prev) startAuth();
    return key;
  });

  createEffect(() => {
    const s = st();
    if (s.step === "verify") {
      WS().companies(s.account).then((orgs) => send({ type: "VERIFY_OK", orgs }), (e) => send({ type: "VERIFY_FAIL", message: e.message }));
    }
  });

  onMount(() => {
    const signedin = (account) => {
      clearTimeout(timer);
      if (st().step === "auth") send({ type: "SIGNED_IN", account, existed: before.includes(account.id) });
    };
    const error = (e) => st().step === "auth" && (clearTimeout(timer), send({ type: "AUTH_ERROR", message: e.message }));
    WS().on("signedin", signedin);
    WS().on("error", error);
    onCleanup(() => {
      clearTimeout(timer);
      WS().off("signedin", signedin);
      WS().off("error", error);
      if (!finished && WS().pendingSignIn()) WS().cancelSignIn();
    });
  });

  function cancelAuth() {
    clearTimeout(timer);
    if (WS().pendingSignIn()) WS().cancelSignIn();
    send({ type: "CANCEL" });
  }
  function close() {
    const s = st();
    finished = s.step === "done";
    props.onClose(s.step === "done" ? { id: s.duplicate || (s.account && s.account.id), duplicate: !!s.duplicate } : null);
  }
  function useCode() {
    const ok = WS().finishWithCode(code());
    setCodeError(ok ? "" : L.wsErrCode);
  }

  const serverError = () => ({ https: L.wsxErrHttps, format: L.wsxErrFormat })[st().error] || "";
  const knownServers = () => (props.known || []).filter((s, i, all) => s && all.indexOf(s) === i).slice(0, 4);
  const stepTitle = () => [L.wsxStepServer, L.wsxStepCheck, L.wsxStepChoose, L.wsxStepAuth, L.wsxStepVerify][stepIndex(st()) - 1];

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <Dialog.Content class="wsx-wizard" aria-describedby={undefined}>
        <div class="wsx-wizard-head">
          <Show when={["result", "choose", "auth"].includes(st().step) && !(st().step === "auth" && st().auth.state === "waiting")}>
            <button type="button" class="wsx-btn wsx-btn-ghost wsx-btn-sm wsx-btn-icon" aria-label={L.wsxBack} onClick={() => send({ type: "BACK" })}>
              <Icon name="back" />
            </button>
          </Show>
          <div class="wsx-wizard-titles">
            <Dialog.Title class="wsx-h2">{L.wsxAddAccount}</Dialog.Title>
            <p class="wsx-hint">{L.wsxStepOf.replace("$1", stepIndex(st())).replace("$2", STEPS.length)} · {stepTitle()}</p>
          </div>
          <Dialog.CloseButton class="wsx-btn wsx-btn-ghost wsx-btn-sm wsx-btn-icon" aria-label={L.wsCancel}>
            <Icon name="close" />
          </Dialog.CloseButton>
        </div>
        <ol class="wsx-steps" aria-hidden="true">
          <For each={STEPS}>{(_, i) => <li classList={{ "is-done": i() + 1 < stepIndex(st()) || st().step === "done", "is-current": i() + 1 === stepIndex(st()) && st().step !== "done" }} />}</For>
        </ol>

        <div class="wsx-wizard-body">
          <Switch>
            <Match when={st().step === "server" || st().step === "checking"}>
              <form class="wsx-wizard-form" onSubmit={(e) => { e.preventDefault(); send({ type: "SUBMIT" }); }}>
                <label class="wsx-label" for="wsx-wiz-server">{L.wsxServerAddress}</label>
                <input id="wsx-wiz-server" class="wsx-input" spellcheck={false} autocomplete="off" inputmode="url" autofocus
                       placeholder={hostOf(WS().DEFAULT_SERVER)} value={hostOf(st().server)} readOnly={st().locked || st().step === "checking"}
                       aria-invalid={serverError() ? "true" : "false"} aria-describedby="wsx-wiz-server-msg"
                       onInput={(e) => send({ type: "INPUT", value: e.currentTarget.value })} />
                <div id="wsx-wiz-server-msg" aria-live="polite">
                  <Show when={serverError()} fallback={<p class="wsx-hint">{st().locked ? L.wsSetByOrg : L.wsxServerHint}</p>}>
                    <p class="wsx-msg wsx-tone-danger"><Icon name="alert" />{serverError()}</p>
                  </Show>
                </div>
                <Show when={!st().locked && knownServers().length}>
                  <div class="wsx-chips" role="group" aria-label={L.wsxKnownServers}>
                    <For each={knownServers()}>
                      {(s) => <button type="button" class="wsx-chip-btn" aria-pressed={st().server === s ? "true" : "false"}
                                      onClick={() => send({ type: "INPUT", value: s })}>{hostOf(s)}</button>}
                    </For>
                  </div>
                </Show>
                <div class="wsx-wizard-actions">
                  <WsButton type="submit" variant="primary" busy={st().step === "checking"}>{st().step === "checking" ? L.wsxChecking2 : L.wsxNext}</WsButton>
                </div>
              </form>
            </Match>

            <Match when={st().step === "result"}>
              <div class="wsx-result" role="status">
                <Show when={st().probe.ok}>
                  <p class="wsx-msg wsx-tone-success"><Icon name="check" />{L.wsxTestOk.replace("$1", st().probe.name).replace("$2", hostOf(st().server))}</p>
                </Show>
                <Show when={st().probe.old}>
                  <p class="wsx-msg wsx-tone-warning"><Icon name="alert" />{L.wsxTestOld.replace("$1", hostOf(st().server))}</p>
                </Show>
                <Show when={st().probe.error !== undefined}>
                  <p class="wsx-msg wsx-tone-danger"><Icon name="alert" />{st().probe.error || L.wsxTestFailed}</p>
                </Show>
              </div>
              <div class="wsx-wizard-actions">
                <WsButton variant="ghost" onClick={() => send({ type: "BACK" })}>{L.wsxBack}</WsButton>
                <Show when={st().probe.ok} fallback={<WsButton variant="primary" icon="updates" onClick={() => send({ type: "RETRY" })}>{L.wsxRetry}</WsButton>}>
                  <WsButton variant="primary" onClick={() => send({ type: "CONTINUE" })}>{L.wsxNext}</WsButton>
                </Show>
              </div>
            </Match>

            <Match when={st().step === "choose"}>
              <p class="wsx-hint">{L.wsxChooseHint.replace("$1", hostOf(st().server))}</p>
              <div class="wsx-choices">
                <For each={st().desktop}>
                  {(d) => (
                    <button type="button" class="wsx-choice" onClick={() => send({ type: "CHOOSE_DESKTOP", account: d })}>
                      <Avatar name={d.user.name} />
                      <span class="wsx-choice-text">
                        <span class="wsx-account-name">{L.wsContinueAs.replace("$1", d.user.name)}</span>
                        <span class="wsx-hint">{[d.user.organization, L.wsViaDesktop].filter(Boolean).join(" · ")}</span>
                      </span>
                      <Icon name="chevron" class="wsx-choice-go" />
                    </button>
                  )}
                </For>
                <button type="button" class="wsx-choice" onClick={() => send({ type: "CHOOSE_BROWSER" })}>
                  <span class="wsx-avatar"><Icon name="accounts" /></span>
                  <span class="wsx-choice-text">
                    <span class="wsx-account-name">{st().desktop.length ? L.wsxSignInAnother : L.wsSignInButton}</span>
                    <span class="wsx-hint">{L.wsxBrowserHint}</span>
                  </span>
                  <Icon name="chevron" class="wsx-choice-go" />
                </button>
              </div>
            </Match>

            <Match when={st().step === "auth"}>
              <div class="wsx-auth" aria-live="polite">
                <Switch>
                  <Match when={st().auth.state === "waiting"}>
                    <Spinner class="wsx-spinner-lg" />
                    <p class="wsx-auth-text">{st().via === "desktop" ? L.wsWaitDesktop : L.wsWaitBrowser}</p>
                    <p class="wsx-hint">{hostOf(st().server)}</p>
                    <Show when={st().via === "browser"}>
                      <Show when={codeOpen()} fallback={<button type="button" class="wsx-link" onClick={() => setCodeOpen(true)}>{L.wsHaveCode}</button>}>
                        <div class="wsx-server-line">
                          <input class="wsx-input" spellcheck={false} autocomplete="off" placeholder={L.wsCodePlaceholder} aria-label={L.wsCodePlaceholder}
                                 value={code()} onInput={(e) => setCode(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && useCode()} />
                          <WsButton variant="primary" onClick={useCode}>{L.wsCodeContinue}</WsButton>
                        </div>
                        <Show when={codeError()}><p class="wsx-msg wsx-tone-danger" role="alert">{codeError()}</p></Show>
                      </Show>
                    </Show>
                  </Match>
                  <Match when={st().auth.state === "timeout"}>
                    <p class="wsx-msg wsx-tone-warning"><Icon name="alert" />{st().via === "desktop" ? L.wsDesktopTimeout : L.wsBrowserTimeout}</p>
                  </Match>
                  <Match when={st().auth.state === "error"}>
                    <p class="wsx-msg wsx-tone-danger" role="alert"><Icon name="alert" />{st().auth.message || L.wsErrNetwork}</p>
                  </Match>
                </Switch>
              </div>
              <div class="wsx-wizard-actions">
                <WsButton variant="ghost" onClick={cancelAuth}>{L.wsCancel}</WsButton>
                <Show when={st().auth.state !== "waiting"}>
                  <WsButton variant="primary" onClick={() => send({ type: "RETRY" })}>{L.wsTryAgain}</WsButton>
                </Show>
                <Show when={st().auth.state === "waiting" && st().via === "browser"}>
                  <WsButton variant="secondary" onClick={() => WS().signIn(st().server).catch((e) => send({ type: "AUTH_ERROR", message: e.message }))}>{L.wsOpenAgain}</WsButton>
                </Show>
              </div>
            </Match>

            <Match when={st().step === "verify"}>
              <div class="wsx-auth" role="status">
                <Spinner class="wsx-spinner-lg" />
                <p class="wsx-auth-text">{L.wsxVerifying}</p>
              </div>
            </Match>

            <Match when={st().step === "done"}>
              <div class="wsx-done" role="status">
                <Show when={st().account}>
                  <div class="wsc-account">
                    <Avatar name={st().account.user.name} src={st().account.user.avatar} />
                    <div class="wsc-account-text">
                      <span class="wsx-account-name wsx-ellipsis">{st().account.user.name}</span>
                      <span class="wsx-hint wsx-ellipsis">{[st().account.user.organization, hostOf(st().account.server)].filter(Boolean).join(" · ")}</span>
                    </div>
                    <StatusBadge status="signed-in" />
                  </div>
                </Show>
                <p class="wsx-msg wsx-tone-success"><Icon name="check" />{st().duplicate ? L.wsxAlreadyAdded : L.wsxAdded}</p>
                <Show when={st().orgs && st().orgs.length}>
                  <p class="wsx-hint">{L.wsxOrgs.replace("$1", st().orgs.map((o) => o.name).join(", "))}</p>
                </Show>
                <Show when={st().warning}>
                  <p class="wsx-msg wsx-tone-warning"><Icon name="alert" />{L.wsxVerifyWarn}</p>
                </Show>
              </div>
              <div class="wsx-wizard-actions">
                <WsButton variant="primary" onClick={close}>{L.wsxDone}</WsButton>
              </div>
            </Match>
          </Switch>
        </div>
      </Dialog.Content>
    </Dialog>
  );
}
