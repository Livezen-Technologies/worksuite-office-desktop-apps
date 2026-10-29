/*
 * The WorkSuite Drive section's account area: the compact "Connect your WorkSuite account" card when no
 * account is signed in, and the connection summary above the file list when one is. Signing in stays the
 * existing flows (core.js): WorkSuite Desktop hand-off, WorkSuite OS broker, the browser.
 */
import { For, Show } from "solid-js";
import { DropdownMenu } from "@/components";
import { L } from "./lang.js";
import { hostOf } from "./cards.jsx";
import { accountStatus } from "./settings-logic.js";
import { AccountCombobox, Avatar, Icon, IconButton, OrgPicker, StatusBadge, WsButton } from "./ui/components.jsx";

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
 * The full-width Drive account panel for a known account: "connected" or "expired" (accountPanelState).
 * Expired shows a compact warning and Reconnect, which signs the SAME saved account in again (the account is
 * never deleted for it). The account menu: switch account, add account, Manage accounts, Disconnect (confirmed).
 * props: state, account, known, companies, companyId, onCompany(id|null), onSelect(account), onAdd(), onManage(),
 *        onDisconnect(), onReconnect(), reconnecting, error, onRefresh(), refreshing
 */
export function AccountPanel(props) {
  const a = () => props.account;
  const others = () => props.known.filter((x) => x.id !== a().id);
  const expired = () => props.state === "expired";
  const status = () => (props.reconnecting ? "connecting" : expired() ? "expired" : "signed-in");

  return (
    <div class="wsh-account" classList={{ "is-expired": expired() }} aria-busy={props.reconnecting ? "true" : "false"}>
      <DropdownMenu>
        <DropdownMenu.Trigger class="wsh-account-trigger" aria-label={L.wshAccountMenu.replace("$1", a().user.name)}>
          <span class="wsh-avatar-wrap">
            <Avatar name={a().user.name} src={a().user.avatar} />
            <span class="wsh-presence" classList={{ "is-off": expired() }} aria-hidden="true" />
          </span>
          <span class="wsh-account-text">
            <span class="wsx-account-name wsx-ellipsis">{a().user.name}</span>
            <span class="wsx-hint wsx-ellipsis">{hostOf(a().server)} · {expired() ? L.wsxSessionExpired : L.wsxConnected}</span>
          </span>
          <Icon name="chevron" class="wsx-combo-caret" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content class="wsh-account-menu">
          <div class="wsh-menu-head">
            <Avatar small name={a().user.name} src={a().user.avatar} />
            <span class="wsh-account-text">
              <span class="wsx-account-name wsx-ellipsis">{a().user.name}</span>
              <span class="wsx-hint wsx-ellipsis">{[a().user.email, hostOf(a().server)].filter(Boolean).join(" · ")}</span>
            </span>
          </div>
          <Show when={others().length}>
            <DropdownMenu.Separator />
            <div class="wsh-menu-label">{L.wsxSwitchAccount}</div>
            <For each={others()}>
              {(x) => (
                <DropdownMenu.Item class="wsh-menu-account" onSelect={() => props.onSelect(x)}>
                  <Avatar small name={x.user.name} src={x.user.avatar} />
                  <span class="wsx-ellipsis wsh-menu-account-name">{x.user.name} · {hostOf(x.server)}</span>
                  <StatusBadge status={x.desktopOnly ? "desktop" : accountStatus(x)} />
                </DropdownMenu.Item>
              )}
            </For>
          </Show>
          <DropdownMenu.Item onSelect={props.onAdd}>{L.wshAddAnother}</DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item onSelect={props.onManage}>{L.wshManageAccounts}</DropdownMenu.Item>
          <DropdownMenu.Item class="negative" onSelect={props.onDisconnect}>{L.wshDisconnectDots}</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu>

      <Show when={!expired()} fallback={
        <div class="wsh-expired" aria-live="polite">
          <p class="wsx-msg wsx-tone-warning" role={props.error ? undefined : "status"}><Icon name="alert" />
            {props.reconnecting ? L.wsxConnectingHint : L.wshExpiredShort.replace("$1", hostOf(a().server))}
          </p>
          <Show when={props.error}><p class="wsx-msg wsx-tone-danger" role="alert"><Icon name="alert" />{props.error}</p></Show>
        </div>
      }>
        <span class="wsh-divider" aria-hidden="true" />
        <Show when={props.companies.length > 1} fallback={
          <Show when={props.companies.length === 1}><span class="wsh-org-one wsx-hint wsx-ellipsis"><Icon name="building" />{props.companies[0].name}</span></Show>
        }>
          <OrgPicker companies={props.companies} value={props.companyId} onChange={props.onCompany} />
        </Show>
      </Show>

      <Show when={!expired()}><span class="wsh-account-spacer" /></Show>
      {props.tools}
      <Show when={expired()} fallback={
        <Show when={!props.noRefresh}><IconButton icon="refresh" label={L.wshRefresh} busy={props.refreshing} onClick={props.onRefresh} /></Show>
      }>
        <StatusBadge status={status()} />
        <WsButton variant="warning" small icon="refresh" busy={props.reconnecting} onClick={props.onReconnect}>{L.wshReconnect}</WsButton>
      </Show>
    </div>
  );
}
