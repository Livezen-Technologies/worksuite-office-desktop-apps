/*
 * The WorkSuite Drive section's account area: the compact "Connect your WorkSuite account" card when no
 * account is signed in, and the connection summary above the file list when one is. Signing in stays the
 * existing flows (core.js): WorkSuite Desktop hand-off, WorkSuite OS broker, the browser.
 */
import { For, Show } from "solid-js";
import { L } from "./lang.js";
import { hostOf } from "./cards.jsx";
import { accountStatus } from "./settings-logic.js";
import { AccountCombobox, Avatar, Icon, StatusBadge, WsButton } from "./ui/components.jsx";

/*
 * props: known (mergeAccounts list), selected (one of known, or an OS broker pseudo-account), os ({available, account}),
 * connecting, error, onSelect(account), onContinue(), onOtherAccount()
 */
export function ConnectCard(props) {
  const a = () => props.selected;
  const status = () => {
    if (props.connecting) return "connecting";
    if (!a()) return null;
    if (a().os) return "desktop";
    if (a().desktopOnly) return "desktop";
    return accountStatus(a());
  };
  const statusText = () => (a() && a().os ? L.wsViaOs : a() && a().signedOut && a().desktop ? L.wsxViaDesktopAvailable : "");
  const canContinue = () => !!a() && (a().os || a().desktopOnly || !!a().desktop);
  const primaryLabel = () => (canContinue() ? L.wsContinueAs.replace("$1", a().user.name) : a() && a().signedOut ? L.wsxSignInAgain : L.wsSignInTitle);

  return (
    <div class="wsc-card" aria-busy={props.connecting ? "true" : "false"}>
      <div class="wsc-head">
        <h4 class="wsc-title">{L.wsxConnectTitle}</h4>
        <p class="wsc-sub">{L.wsxConnectSub}</p>
      </div>

      <Show when={a()}>
        <Show when={props.known.length > 1} fallback={
          <div class="wsc-account">
            <Avatar name={a().user.name} src={a().user.avatar} />
            <div class="wsc-account-text">
              <span class="wsx-account-name wsx-ellipsis">{a().user.name}</span>
              <span class="wsx-hint wsx-ellipsis">{[a().user.organization, hostOf(a().server)].filter(Boolean).join(" · ")}</span>
            </div>
            <StatusBadge status={status()} />
          </div>
        }>
          <AccountCombobox label={L.wsxChooseAccount} accounts={props.known} selectedId={a().id} onSelect={props.onSelect} />
        </Show>
        <Show when={statusText() && !props.connecting}><p class="wsx-hint wsc-via">{statusText()}</p></Show>
      </Show>

      <div aria-live="polite">
        <Show when={props.connecting}>
          <p class="wsx-msg wsx-tone-info">{L.wsxConnectingHint}</p>
        </Show>
        <Show when={!props.connecting && a() && a().signedOut && !props.error}>
          <p class="wsx-msg wsx-tone-warning"><Icon name="alert" />{L.wsxExpiredMsg.replace("$1", hostOf(a().server))}</p>
        </Show>
        <Show when={!props.connecting && props.error}>
          <p class="wsx-msg wsx-tone-danger" role="alert"><Icon name="alert" />{props.error}</p>
        </Show>
      </div>

      <div class="wsc-actions">
        <WsButton variant="primary" class="wsc-primary" busy={props.connecting} onClick={() => (canContinue() ? props.onContinue() : props.onOtherAccount())}>
          {props.connecting ? L.wsxConnecting : primaryLabel()}
        </WsButton>
        <Show when={!props.noOther && (canContinue() || (a() && a().signedOut))}>
          <WsButton variant="link" disabled={props.connecting} onClick={props.onOtherAccount}>{L.wsxUseAnother}</WsButton>
        </Show>
      </div>

      <p class="wsc-foot"><Icon name="lock" />{L.wsxSecure}</p>
    </div>
  );
}

/*
 * Signed in: who, where, and the account actions. props: account, known, company (name), companies, companyId,
 * onCompany(id|null), onSelect(account), onAdd(), onOpenWeb(), onDisconnect(), disconnecting
 */
export function ConnectionSummary(props) {
  return (
    <div class="wsc-summary">
      <div class="wsc-summary-account">
        <AccountCombobox label={L.wsxSwitchAccount} accounts={props.known} selectedId={props.account.id} onSelect={props.onSelect}
                         footer={[{ id: "add", label: L.wsxAddAccount, run: props.onAdd }]} />
      </div>
      <div class="wsc-summary-meta">
        <span class="wsc-status"><span class="wsc-status-dot" aria-hidden="true" />{L.wsxConnected}</span>
        <Show when={props.companies.length > 1} fallback={<Show when={props.company}><span class="wsx-hint wsx-ellipsis">{props.company}</span></Show>}>
          <div class="wsx-select-wrap wsc-company">
            <select class="wsx-select" aria-label={L.wsCompany} onChange={(e) => props.onCompany(e.currentTarget.value || null)}>
              <option value="" selected={props.companyId === null}>{L.wsAllCompanies}</option>
              <For each={props.companies}>
                {(c) => <option value={String(c.id)} selected={String(props.companyId) === String(c.id)}>{c.name}</option>}
              </For>
            </select>
            <Icon name="chevron" class="wsx-select-caret" />
          </div>
        </Show>
      </div>
      <div class="wsc-summary-actions">
        <WsButton small variant="secondary" icon="external" onClick={props.onOpenWeb}>{L.wsxOpenDrive}</WsButton>
        <WsButton small variant="ghost" busy={props.disconnecting} onClick={props.onDisconnect}
                  title={L.wsSignOut.replace("$1", props.account.user.name + " (" + hostOf(props.account.server) + ")")}>{L.wsxDisconnect}</WsButton>
      </div>
    </div>
  );
}
