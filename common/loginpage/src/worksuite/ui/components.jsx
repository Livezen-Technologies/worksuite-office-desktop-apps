/*
 * WorkSuite UI kit of the start page (Solid): the building blocks of Settings › WorkSuite and the
 * WorkSuite Drive connect card. Styles in components.css, tokens in tokens.css. Icons are sprite
 * symbols (res/img/common-svg/ws-*.svg).
 */
import { For, Show, createEffect, createMemo, createSignal, createUniqueId, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import { L } from "../lang.js";
import { filterCompanies, placePopover } from "../home-logic.js";
import { Frame } from "../dialogs.jsx";
import { hostOf, initials } from "../cards.jsx";
import { accountActions, accountStatus, filterAccounts, nextIndex, validateServer } from "../settings-logic.js";
import { DropdownMenu } from "@/components";
import "./tokens.css";
import "./components.css";

export function Icon(props) {
  return (
    <svg class={"wsx-icon " + (props.class || "")} aria-hidden="true">
      <use href={"#ws-" + props.name} />
    </svg>
  );
}

export function Spinner(props) {
  return <span class={"wsx-spinner " + (props.class || "")} role={props.label ? "status" : undefined} aria-label={props.label} aria-hidden={props.label ? undefined : "true"} />;
}

/* variant: primary | secondary | ghost | danger | link */
export function WsButton(props) {
  return (
    <button
      type={props.type || "button"}
      class={"wsx-btn wsx-btn-" + (props.variant || "secondary") + (props.small ? " wsx-btn-sm" : "") + (props.class ? " " + props.class : "")}
      disabled={props.disabled || props.busy}
      aria-busy={props.busy ? "true" : undefined}
      aria-label={props.ariaLabel}
      title={props.title}
      onClick={(e) => props.onClick && props.onClick(e)}
    >
      <Show when={props.busy}><Spinner /></Show>
      <Show when={!props.busy && props.icon}><Icon name={props.icon} /></Show>
      <span>{props.children}</span>
    </button>
  );
}

export function LockHint(props) {
  return (
    <Show when={props.when}>
      <span class="wsx-lock" title={L.wsAskIt}>
        <Icon name="lock" />
        {L.wsLockedByOrg}
      </span>
    </Show>
  );
}

/* Desktop's avatarTone: the same colour for the same name */
export function avatarTone(name) {
  let h = 0;
  for (const ch of String(name || "?")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 6;
}

export function Avatar(props) {
  const [broken, setBroken] = createSignal(false);
  createEffect(() => {
    props.src;
    setBroken(false);
  });
  return (
    <span class={"wsx-avatar" + (props.small ? " wsx-avatar-sm" : "")} data-tone={avatarTone(props.name)} aria-hidden="true">
      <Show when={props.src && !broken()} fallback={initials(props.name)}>
        <img src={props.src} alt="" draggable={false} onError={() => setBroken(true)} />
      </Show>
    </span>
  );
}

const STATUS_TEXT = {
  "signed-in": () => L.wsxSignedIn,
  expired: () => L.wsxSessionExpired,
  "signed-out": () => L.wsxSignedOut,
  unreachable: () => L.wsxUnreachable,
  desktop: () => L.wsxViaDesktopAvailable,
  connecting: () => L.wsxConnecting,
};
const STATUS_TONE = { "signed-in": "success", expired: "warning", "signed-out": "neutral", unreachable: "danger", desktop: "info", connecting: "info" };

export function StatusBadge(props) {
  return (
    <span class={"wsx-badge wsx-tone-" + (STATUS_TONE[props.status] || "neutral")}>
      <span class="wsx-dot" aria-hidden="true" />
      {(STATUS_TEXT[props.status] || (() => props.status))()}
    </span>
  );
}

/*
 * Settings page frame: a sub-navigation (icons, clear active state) beside the content; in a narrow
 * pane the navigation becomes a select above it. sections: [{id, label, icon, href?}]; href leaves the page.
 */
export function SettingsLayout(props) {
  const selectId = createUniqueId();
  const go = (s) => {
    if (s.href) location.hash = s.href;
    else props.onSelect(s.id);
  };
  const onKey = (e, i) => {
    const n = props.sections.length;
    const j = e.key === "ArrowDown" ? (i + 1) % n : e.key === "ArrowUp" ? (i - 1 + n) % n : -1;
    if (j < 0) return;
    e.preventDefault();
    e.currentTarget.parentElement.parentElement.children[j].firstChild.focus();
  };
  return (
    <div class="wsx-layout-host">
    <div class="wsx-layout">
      <nav class="wsx-subnav" aria-label={props.label}>
        <ul>
          <For each={props.sections}>
            {(s, i) => (
              <li>
                <button type="button" class="wsx-subnav-item" classList={{ "is-active": props.active === s.id }}
                        aria-current={props.active === s.id ? "page" : undefined}
                        onClick={() => go(s)} onKeyDown={(e) => onKey(e, i())}>
                  <Icon name={s.icon} />
                  <span>{s.label}</span>
                  <Show when={s.href}><Icon name="external" class="wsx-subnav-out" /></Show>
                </button>
              </li>
            )}
          </For>
        </ul>
      </nav>
      <div class="wsx-subnav-narrow">
        <label class="wsx-visually-hidden" for={selectId}>{props.label}</label>
        <div class="wsx-select-wrap">
          <select id={selectId} class="wsx-select" value={props.active}
                  onChange={(e) => go(props.sections.find((s) => s.id === e.currentTarget.value))}>
            <For each={props.sections}>{(s) => <option value={s.id} selected={props.active === s.id}>{s.label}</option>}</For>
          </select>
          <Icon name="chevron" class="wsx-select-caret" />
        </div>
      </div>
      <div class="wsx-content">{props.children}</div>
    </div>
    </div>
  );
}

export function SettingsSection(props) {
  const id = createUniqueId();
  return (
    <section class="wsx-section" aria-labelledby={id} id={props.id}>
      <header class="wsx-section-head">
        <div class="wsx-section-titles">
          <h2 class="wsx-h2" id={id}>{props.title}</h2>
          <Show when={props.description}><p class="wsx-section-desc">{props.description}</p></Show>
        </div>
        <Show when={props.actions}><div class="wsx-section-actions">{props.actions}</div></Show>
      </header>
      <div class="wsx-section-body">{props.children}</div>
    </section>
  );
}

/* a labelled row inside a section */
export function SettingsRow(props) {
  return (
    <div class="wsx-row" classList={{ "wsx-row-stack": props.stack }}>
      <div class="wsx-row-label">
        <span class="wsx-label" id={props.labelId}>{props.label}<LockHint when={props.locked} /></span>
        <Show when={props.hint}><span class="wsx-hint">{props.hint}</span></Show>
      </div>
      <div class="wsx-row-control">{props.children}</div>
    </div>
  );
}

export function SettingsToggle(props) {
  const id = createUniqueId();
  return (
    <div class="wsx-toggle-row">
      <div class="wsx-row-label">
        <span class="wsx-label" id={id}>{props.label}<LockHint when={props.locked} /></span>
        <Show when={props.description}><span class="wsx-hint">{props.description}</span></Show>
      </div>
      <button type="button" role="switch" class="wsx-switch" aria-checked={props.checked ? "true" : "false"} aria-labelledby={id}
              disabled={props.disabled || props.locked} onClick={() => props.onChange(!props.checked)}>
        <span class="wsx-switch-thumb" />
      </button>
    </div>
  );
}

/*
 * One choice of a few: radiogroup semantics, roving tabindex, arrow keys / Home / End.
 * variant "segmented" (inline) or "cards" (radio cards with a description).
 * options: [{value, label, description?}]
 */
export function Segmented(props) {
  let root = null;
  const index = () => Math.max(0, props.options.findIndex((o) => o.value === props.value));
  const onKey = (e) => {
    const j = nextIndex(e.key, index(), props.options.length);
    if (j === index() || j < 0) return;
    e.preventDefault();
    props.onChange(props.options[j].value);
    root.querySelectorAll('[role="radio"]')[j].focus();
  };
  return (
    <div ref={(el) => (root = el)} role="radiogroup" aria-label={props.label} aria-labelledby={props.labelledBy} aria-disabled={props.disabled ? "true" : undefined}
         class={props.variant === "cards" ? "wsx-radio-cards" : "wsx-segmented"} onKeyDown={onKey}>
      <For each={props.options}>
        {(o, i) => (
          <button type="button" role="radio" aria-checked={props.value === o.value ? "true" : "false"}
                  tabindex={i() === index() ? 0 : -1} disabled={props.disabled}
                  class={props.variant === "cards" ? "wsx-radio-card" : "wsx-seg"}
                  onClick={() => props.value !== o.value && props.onChange(o.value)}>
            <Show when={props.variant === "cards"} fallback={o.label}>
              <span class="wsx-radio-mark" aria-hidden="true" />
              <span class="wsx-radio-text">
                <span class="wsx-radio-label">{o.label}</span>
                <Show when={o.description}><span class="wsx-hint">{o.description}</span></Show>
              </span>
            </Show>
          </button>
        )}
      </For>
    </div>
  );
}

/*
 * One account: avatar (photo when the server gave one), name, server, status, an inline action
 * (Connect / Sign in / Reconnect) and a menu (Switch to, Sign out, Remove).
 * props: account, isDefault, multiple, unreachable, busy, error, focused, onConnect, onSwitch, onSignOut, onRemove
 */
export function AccountCard(props) {
  const a = () => props.account;
  const acts = () => accountActions(a(), { isDefault: props.isDefault, multiple: props.multiple, unreachable: props.unreachable });
  const status = () => (props.busy === "signin" ? "connecting" : acts().status);
  const primaryLabel = () => ({ connect: L.wsxConnect, signin: L.wsxStepAuth, reconnect: L.wsxReconnect })[acts().primary];
  let el;
  createEffect(() => {
    if (props.focused && el) {
      el.scrollIntoView({ block: "nearest" });
      el.focus();
    }
  });
  return (
    <div class="wsx-account" classList={{ "is-default": props.isDefault, "is-focused": props.focused }} ref={(e) => (el = e)} tabindex="-1"
         data-account={a().id}>
      <Avatar name={a().user.name} src={a().user.avatar} />
      <div class="wsx-account-text">
        <div class="wsx-account-name">
          <span class="wsx-ellipsis">{a().user.name}</span>
          <Show when={props.isDefault}><span class="wsx-chip">{L.wsxDefault}</span></Show>
        </div>
        <div class="wsx-account-meta wsx-ellipsis" title={a().user.email || ""}>
          {[a().user.email, a().user.organization, hostOf(a().server)].filter(Boolean).join(" · ")}
        </div>
        <Show when={props.via}><div class="wsx-hint">{props.via}</div></Show>
        <Show when={props.note}><div class="wsx-msg wsx-tone-info"><Icon name="about" />{props.note}</div></Show>
        <Show when={props.error}><div class="wsx-msg wsx-tone-danger" role="alert"><Icon name="alert" />{props.error}</div></Show>
      </div>
      <StatusBadge status={status()} />
      <div class="wsx-account-actions">
        <Show when={acts().primary}>
          <WsButton small variant="primary" busy={props.busy === "signin"} disabled={!!props.busy} onClick={props.onConnect}>{primaryLabel()}</WsButton>
        </Show>
        <Show when={acts().menu.length}>
          <DropdownMenu>
            <DropdownMenu.Trigger class="wsx-btn wsx-btn-ghost wsx-btn-sm wsx-btn-icon" disabled={!!props.busy}
                                  aria-label={L.wsxMoreActions.replace("$1", a().user.name)}>
              <Show when={props.busy && props.busy !== "signin"} fallback={<Icon name="more" />}><Spinner /></Show>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              <For each={acts().menu}>
                {(m) => (
                  <DropdownMenu.Item class={m === "remove" ? "negative" : ""}
                                     onSelect={() => ({ switch: props.onSwitch, signout: props.onSignOut, remove: props.onRemove })[m]()}>
                    {({ switch: L.wsxSwitchTo, signout: L.wsSignOutBtn, remove: L.wsxRemoveAccount })[m]}
                  </DropdownMenu.Item>
                )}
              </For>
            </DropdownMenu.Content>
          </DropdownMenu>
        </Show>
      </div>
    </div>
  );
}

/*
 * Server address with validation, auto-save (blur / Enter) and a "Test connection" probe.
 * props: value, placeholder, locked, onSave(normalised|""), test(server) → Promise<{name, office}>
 */
export function ServerInput(props) {
  const id = createUniqueId();
  const [text, setText] = createSignal(props.value || "");
  const [touched, setTouched] = createSignal(false);
  const [saved, setSaved] = createSignal(false);
  const [probe, setProbe] = createSignal(null); // {busy} | {ok, text} | {error}
  let savedTimer;
  onCleanup(() => clearTimeout(savedTimer));
  createEffect(() => setText(props.value || ""));

  const check = createMemo(() => validateServer(text()));
  const error = () => (touched() && !check().ok ? (check().error === "https" ? L.wsxErrHttps : L.wsxErrFormat) : "");

  function save() {
    setTouched(true);
    if (!check().ok) return;
    const v = check().value;
    if (v === (props.value || "")) return;
    props.onSave(v);
    setText(v);
    setSaved(true);
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => setSaved(false), 2000);
  }

  async function test() {
    setTouched(true);
    const target = check().ok && check().value ? check().value : props.placeholderServer;
    if (!check().ok || !target) return;
    setProbe({ busy: true });
    try {
      const r = await props.test(target);
      setProbe(r.office ? { ok: true, text: L.wsxTestOk.replace("$1", r.name || "WorkSuite").replace("$2", hostOf(target)) }
                        : { error: L.wsxTestOld.replace("$1", hostOf(target)) });
    } catch (e) {
      setProbe({ error: (e && e.message) || L.wsxTestFailed });
    }
  }

  return (
    <div class="wsx-server">
      <label class="wsx-label" for={id}>{props.label}<LockHint when={props.locked} /></label>
      <div class="wsx-server-line">
        <div class="wsx-input-wrap" classList={{ "is-invalid": !!error() }}>
          <input id={id} class="wsx-input" spellcheck={false} autocomplete="off" inputmode="url"
                 placeholder={props.placeholder} value={text()} readOnly={props.locked}
                 aria-invalid={error() ? "true" : "false"} aria-describedby={id + "-msg"}
                 onInput={(e) => { setText(e.currentTarget.value); setProbe(null); }}
                 onBlur={() => !props.locked && save()}
                 onKeyDown={(e) => e.key === "Enter" && !props.locked && save()} />
          <Show when={saved()}><span class="wsx-saved" role="status"><Icon name="check" />{L.wsxSaved}</span></Show>
        </div>
        <WsButton variant="secondary" busy={probe() && probe().busy} onClick={test}>{L.wsxTestConnection}</WsButton>
      </div>
      <div id={id + "-msg"} aria-live="polite">
        <Show when={error()}><div class="wsx-msg wsx-tone-danger"><Icon name="alert" />{error()}</div></Show>
        <Show when={!error() && probe() && probe().ok}><div class="wsx-msg wsx-tone-success"><Icon name="check" />{probe().text}</div></Show>
        <Show when={!error() && probe() && probe().error}><div class="wsx-msg wsx-tone-danger"><Icon name="alert" />{probe().error}</div></Show>
        <Show when={!error() && !probe() && props.hint}><div class="wsx-hint">{props.hint}</div></Show>
      </div>
    </div>
  );
}

/*
 * Installed version and what the updater is doing. props: phase ({phase, percent, text}), version, build,
 * lastCheck (text), onCheck, onRestart, onAction(action), notes ([{title, items}]), checking
 */
export function UpdateCard(props) {
  const [open, setOpen] = createSignal(false);
  const p = () => props.phase || { phase: "uptodate" };
  const tone = () => ({ uptodate: "success", ready: "info", available: "info", downloading: "info", checking: "neutral", error: "danger" })[p().phase] || "neutral";
  const title = () => {
    switch (p().phase) {
      case "ready": return L.wsxReady.replace("$1", p().version || "");
      case "downloading": return p().text || L.wsxDownloading;
      case "available": return p().text || L.wsxAvailable;
      case "checking": return L.wsxChecking;
      case "error": return p().text || L.wsxUpdateError;
      default: return L.wsxUpToDate;
    }
  };
  return (
    <div class="wsx-update">
      <div class="wsx-update-top">
        <div class={"wsx-update-mark wsx-tone-" + tone()} aria-hidden="true">
          <Show when={p().phase === "checking" || p().phase === "downloading"} fallback={<Icon name={p().phase === "error" ? "alert" : p().phase === "uptodate" ? "check" : "updates"} />}>
            <Spinner />
          </Show>
        </div>
        <div class="wsx-update-text" aria-live="polite">
          <div class="wsx-update-title">{title()}</div>
          <div class="wsx-hint">
            {L.wsxInstalled.replace("$1", props.version || "—")}
            <Show when={props.build}>{" · " + L.wsxBuild.replace("$1", props.build)}</Show>
          </div>
          <div class="wsx-hint">{props.lastCheck}</div>
        </div>
        <div class="wsx-update-actions">
          <Show when={p().phase === "ready"}>
            <WsButton variant="primary" onClick={props.onRestart}>{L.wsRestartToUpdate}</WsButton>
          </Show>
          <Show when={p().phase === "available" && p().action}>
            <WsButton variant="primary" onClick={() => props.onAction(p().action)}>{L.wsxDownload}</WsButton>
          </Show>
          <Show when={p().phase === "downloading" && p().action === "abort"}>
            <WsButton variant="ghost" onClick={() => props.onAction("abort")}>{L.wsCancel}</WsButton>
          </Show>
          <Show when={p().phase === "error"}>
            <WsButton variant="primary" icon="updates" onClick={props.onCheck}>{L.wsxRetry}</WsButton>
          </Show>
          <Show when={p().phase === "uptodate" || p().phase === "checking" || (p().phase === "available" && !p().action)}>
            <WsButton variant="secondary" busy={p().phase === "checking"} onClick={props.onCheck}>{L.wsCheckUpdates}</WsButton>
          </Show>
        </div>
      </div>
      <Show when={p().phase === "downloading"}>
        <div class="wsx-progress" role="progressbar" aria-label={L.wsxDownloading} aria-valuemin="0" aria-valuemax="100"
             aria-valuenow={p().percent ?? undefined}>
          <div class="wsx-progress-bar" classList={{ "is-indeterminate": p().percent == null }} style={{ width: p().percent == null ? "30%" : p().percent + "%" }} />
        </div>
      </Show>
      <Show when={props.notes && props.notes.length}>
        <button type="button" class="wsx-disclosure" aria-expanded={open() ? "true" : "false"} onClick={() => setOpen(!open())}>
          <Icon name="chevron" class={open() ? "is-open" : ""} />
          {L.wsWhatsNew}
        </button>
        <Show when={open()}>
          <div class="wsx-notes">
            <For each={props.notes}>
              {(s) => (
                <>
                  <Show when={s.title}><h3 class="wsx-h3">{s.title}</h3></Show>
                  <ul><For each={s.items}>{(i) => <li>{i}</li>}</For></ul>
                </>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
}

/*
 * Searchable account picker (ARIA combobox + listbox). props: accounts (from mergeAccounts), selectedId,
 * onSelect(account), label, footer (extra options: [{id, label, run}])
 */
export function AccountCombobox(props) {
  const id = createUniqueId();
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [hi, setHi] = createSignal(0);
  let root = null, input = null;
  const list = createMemo(() => filterAccounts(props.accounts || [], query()));
  const extras = () => props.footer || [];
  const count = () => list().length + extras().length;
  const selected = () => (props.accounts || []).find((a) => a.id === props.selectedId);
  const status = (a) => (a.desktopOnly ? "desktop" : accountStatus(a));

  const close = () => { setOpen(false); setQuery(""); };
  createEffect(() => {
    if (open()) {
      const i = list().findIndex((a) => a.id === props.selectedId);
      setHi(i < 0 ? 0 : i);
      queueMicrotask(() => input && input.focus());
    }
  });

  function choose(i) {
    if (i < list().length) props.onSelect(list()[i]);
    else extras()[i - list().length].run();
    close();
  }
  function onKey(e) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setHi(nextIndex(e.key, hi(), count()));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (count()) choose(hi());
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
      root.querySelector(".wsx-combo-trigger").focus();
    } else if (e.key === "Tab") close();
  }

  return (
    <div class="wsx-combo" ref={(el) => (root = el)}>
      <button type="button" class="wsx-combo-trigger" aria-haspopup="listbox" aria-expanded={open() ? "true" : "false"}
              aria-label={props.label} onClick={() => setOpen(!open())}
              onKeyDown={(e) => (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen(true))}>
        <Show when={selected()} fallback={<span class="wsx-hint">{props.placeholder || props.label}</span>}>
          <Avatar small name={selected().user.name} src={selected().user.avatar} />
          <span class="wsx-combo-value">
            <span class="wsx-account-name wsx-ellipsis">{selected().user.name}</span>
            <span class="wsx-hint wsx-ellipsis">{hostOf(selected().server)}</span>
          </span>
        </Show>
        <Icon name="chevron" class="wsx-combo-caret" />
      </button>
      <Popover open={open()} anchor={root} onClose={close} matchWidth class="wsx-combo-pop">
        <div>
          <div class="wsx-combo-search">
            <Icon name="search" />
            <input ref={(el) => (input = el)} role="combobox" aria-expanded="true" aria-controls={id} aria-autocomplete="list"
                   aria-activedescendant={count() ? id + "-" + hi() : undefined} aria-label={L.wsxSearchAccounts}
                   placeholder={L.wsxSearchAccounts} value={query()} spellcheck={false}
                   onInput={(e) => { setQuery(e.currentTarget.value); setHi(0); }} onKeyDown={onKey} />
          </div>
          <ul role="listbox" id={id} class="wsx-combo-list" aria-label={props.label}>
            <For each={list()}>
              {(a, i) => (
                <li role="option" id={id + "-" + i()} aria-selected={a.id === props.selectedId ? "true" : "false"}
                    classList={{ "is-hi": hi() === i(), "is-selected": a.id === props.selectedId }}
                    onMouseEnter={() => setHi(i())} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(i())}>
                  <Avatar small name={a.user.name} src={a.user.avatar} />
                  <span class="wsx-combo-value">
                    <span class="wsx-account-name wsx-ellipsis">{a.user.name}</span>
                    <span class="wsx-hint wsx-ellipsis">{[a.user.organization, hostOf(a.server)].filter(Boolean).join(" · ")}</span>
                  </span>
                  <StatusBadge status={status(a)} />
                  <Show when={a.id === props.selectedId}><Icon name="check" class="wsx-combo-check" /></Show>
                </li>
              )}
            </For>
            <Show when={!list().length}><li class="wsx-combo-empty" role="presentation">{L.wsxNoMatch}</li></Show>
            <For each={extras()}>
              {(x, i) => (
                <li role="option" id={id + "-" + (list().length + i())} aria-selected="false" class="wsx-combo-extra"
                    classList={{ "is-hi": hi() === list().length + i(), "is-first": i() === 0 }}
                    onMouseEnter={() => setHi(list().length + i())} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(list().length + i())}>
                  {x.label}
                </li>
              )}
            </For>
          </ul>
        </div>
      </Popover>
    </div>
  );
}

/*
 * The one floating surface of the WorkSuite screens (pickers, tooltips): portalled to <body> so no panel
 * clips it, placed under its anchor and flipped above when it does not fit (placePopover), above dialogs
 * (--wsx-z-pop). Closes on a click outside it and its anchor, and on Escape (focus goes back to the anchor).
 * props: open, anchor (element), onClose, class, role, matchWidth, passive (a tooltip: no focus, no closing rules)
 */
export function Popover(props) {
  let pop = null;
  const [pos, setPos] = createSignal({ top: -9999, left: -9999, maxHeight: 400, placement: "bottom" });
  const place = () => {
    if (!pop || !props.anchor) return;
    const r = props.anchor.getBoundingClientRect();
    setPos(placePopover(r, { width: pop.offsetWidth, height: pop.offsetHeight }, { width: window.innerWidth, height: window.innerHeight },
                        { rtl: document.body.classList.contains("rtl") }));
  };
  createEffect(() => {
    if (!props.open) return;
    requestAnimationFrame(place);
    const down = (e) => {
      if (pop && !pop.contains(e.target) && !(props.anchor && props.anchor.contains(e.target))) props.onClose && props.onClose();
    };
    const key = (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      props.onClose && props.onClose();
      const focusable = props.anchor && (props.anchor.matches("button") ? props.anchor : props.anchor.querySelector("button"));
      focusable && focusable.focus();
    };
    if (!props.passive) {
      document.addEventListener("mousedown", down, true);
      document.addEventListener("keydown", key, true);
    }
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    onCleanup(() => {
      document.removeEventListener("mousedown", down, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    });
  });
  return (
    <Show when={props.open}>
      <Portal>
        <div ref={(el) => (pop = el)} class={"wsx-pop " + (props.class || "")} role={props.role} id={props.id}
             data-placement={pos().placement}
             style={{ top: pos().top + "px", left: pos().left + "px", "max-height": props.passive ? undefined : pos().maxHeight + "px",
                      "min-width": props.matchWidth && props.anchor ? props.anchor.offsetWidth + "px" : undefined }}>
          {props.children}
        </div>
      </Portal>
    </Show>
  );
}

/* A tooltip anchored to its trigger (never to the mouse): hover or keyboard focus, after a short delay */
export function Tooltip(props) {
  const id = createUniqueId();
  const [open, setOpen] = createSignal(false);
  let host = null, timer;
  const show = () => { clearTimeout(timer); timer = setTimeout(() => setOpen(true), 350); };
  const hide = () => { clearTimeout(timer); setOpen(false); };
  onCleanup(() => clearTimeout(timer));
  return (
    <span class="wsx-tip-host" ref={(el) => (host = el)} onMouseEnter={show} onMouseLeave={hide} onFocusIn={show} onFocusOut={hide}
          onMouseDown={hide} onKeyDown={(e) => e.key === "Escape" && hide()}>
      {props.children}
      <Popover open={open() && !!props.text} anchor={host} passive class="wsx-tip" role="tooltip" id={id}>{props.text}</Popover>
    </span>
  );
}

/* An icon-only button: its label is the accessible name and the anchored tooltip */
export function IconButton(props) {
  return (
    <Tooltip text={props.label}>
      <button type="button" class={"wsx-btn wsx-btn-ghost wsx-btn-sm wsx-btn-icon" + (props.class ? " " + props.class : "")}
              aria-label={props.label} aria-pressed={props.pressed === undefined ? undefined : props.pressed ? "true" : "false"}
              disabled={props.disabled} onClick={(e) => props.onClick && props.onClick(e)}>
        <Show when={props.busy} fallback={<Icon name={props.icon} />}><Spinner /></Show>
      </button>
    </Tooltip>
  );
}

/* List / grid, as two pressed-state buttons */
export function LayoutToggle(props) {
  return (
    <div class="wsx-toggle-group" role="group" aria-label={L.wshLayout}>
      <IconButton icon="list" label={L.wshListView} pressed={props.value === "list"} onClick={() => props.onChange("list")} />
      <IconButton icon="grid" label={L.wshGridView} pressed={props.value === "grid"} onClick={() => props.onChange("grid")} />
    </div>
  );
}

/* A search box; onSearch is called debounced (props.delay, default 250 ms), Escape clears it */
export function SearchBox(props) {
  const [text, setText] = createSignal(props.value || "");
  let timer;
  onCleanup(() => clearTimeout(timer));
  const emit = (v, now) => {
    clearTimeout(timer);
    if (now) props.onSearch(v);
    else timer = setTimeout(() => props.onSearch(v), props.delay ?? 250);
  };
  return (
    <div class={"wsx-searchbox " + (props.class || "")}>
      <Icon name="search" />
      <input type="search" spellcheck={false} placeholder={props.placeholder} aria-label={props.placeholder} value={text()}
             onInput={(e) => { setText(e.currentTarget.value); emit(e.currentTarget.value.trim()); }}
             onKeyDown={(e) => {
               if (e.key === "Enter") emit(text().trim(), true);
               if (e.key === "Escape" && text()) { e.stopPropagation(); setText(""); emit("", true); }
             }} />
      <Show when={text()}>
        <button type="button" class="wsx-searchbox-clear" aria-label={L.wshClearSearch} onClick={() => { setText(""); emit("", true); }}>
          <Icon name="x" />
        </button>
      </Show>
    </div>
  );
}

/* Type chips: All, Documents, Spreadsheets, Presentations, PDF */
export function TypeChips(props) {
  const types = () => [["all", L.wsAll], ["word", L.wsDocuments], ["cell", L.wsSpreadsheets], ["slide", L.wsPresentations], ["pdf", "PDF"]];
  return (
    <div class="wsx-chips" role="group" aria-label={L.wshFileType}>
      <For each={types()}>
        {([value, label]) => (
          <button type="button" class={"wsx-chip-btn wsx-chip-" + value} aria-pressed={props.value === value ? "true" : "false"}
                  onClick={() => props.onChange(value)}>{label}</button>
        )}
      </For>
    </div>
  );
}

/*
 * The organisation selector: only the organisations the server lists for this account, searchable.
 * props: companies [{id, name}], value (id | null = all), onChange(id | null)
 */
export function OrgPicker(props) {
  const id = createUniqueId();
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [hi, setHi] = createSignal(0);
  let root = null, input = null;
  const options = createMemo(() => {
    const found = filterCompanies(props.companies, query());
    return (query() ? [] : [{ id: null, name: L.wsAllCompanies }]).concat(found);
  });
  const current = () => (props.companies || []).find((c) => String(c.id) === String(props.value));
  const close = () => { setOpen(false); setQuery(""); };
  const choose = (o) => { props.onChange(o.id === null ? null : o.id); close(); };
  createEffect(() => {
    if (!open()) return;
    setHi(0);
    queueMicrotask(() => input && input.focus());
  });
  function onKey(e) {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      const n = options().length;
      if (!n) return;
      const i = hi();
      setHi(e.key === "ArrowDown" ? (i + 1) % n : e.key === "ArrowUp" ? (i - 1 + n) % n : e.key === "Home" ? 0 : n - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = options()[hi()];
      o && choose(o);
    } else if (e.key === "Tab") close();
  }
  return (
    <div class="wsx-org" ref={(el) => (root = el)}>
      <button type="button" class="wsx-org-trigger" aria-haspopup="listbox" aria-expanded={open() ? "true" : "false"}
              aria-label={L.wsCompany} onClick={() => setOpen(!open())}>
        <Icon name="building" />
        <span class="wsx-ellipsis">{current() ? current().name : L.wsAllCompanies}</span>
        <span class="wsx-org-count">{(props.companies || []).length}</span>
        <Icon name="chevron" class="wsx-combo-caret" />
      </button>
      <Popover open={open()} anchor={root} onClose={close} matchWidth class="wsx-combo-pop">
        <div class="wsx-combo-search">
          <Icon name="search" />
          <input ref={(el) => (input = el)} role="combobox" aria-expanded="true" aria-controls={id} aria-autocomplete="list"
                 aria-activedescendant={options().length ? id + "-" + hi() : undefined} aria-label={L.wshSearchCompanies}
                 placeholder={L.wshSearchCompanies} value={query()} spellcheck={false}
                 onInput={(e) => { setQuery(e.currentTarget.value); setHi(0); }} onKeyDown={onKey} />
        </div>
        <ul role="listbox" id={id} class="wsx-combo-list" aria-label={L.wsCompany}>
          <For each={options()}>
            {(o, i) => {
              const selected = () => (o.id === null ? props.value === null || props.value === undefined : String(o.id) === String(props.value));
              return (
                <li role="option" id={id + "-" + i()} aria-selected={selected() ? "true" : "false"}
                    classList={{ "is-hi": hi() === i(), "is-selected": selected() }}
                    onMouseEnter={() => setHi(i())} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(o)}>
                  <span class="wsx-ellipsis wsx-org-name">{o.name}</span>
                  <Show when={selected()}><Icon name="check" class="wsx-combo-check" /></Show>
                </li>
              );
            }}
          </For>
          <Show when={!options().length}><li class="wsx-combo-empty" role="presentation">{L.wshNoCompany}</li></Show>
        </ul>
      </Popover>
    </div>
  );
}

/* "Are you sure?" with the action named on its button. props: title, text, confirmLabel, danger, busy, onConfirm, onClose */
export function ConfirmDialog(props) {
  return (
    <Frame title={props.title} onClose={props.onClose}>
      <p class="ws-dlg-descr">{props.text}</p>
      <div class="wsx-confirm-actions">
        <WsButton variant="secondary" onClick={props.onClose}>{L.wsCancel}</WsButton>
        <WsButton variant={props.danger ? "danger" : "primary"} busy={props.busy} onClick={props.onConfirm}>{props.confirmLabel}</WsButton>
      </div>
    </Frame>
  );
}

export function SkeletonRows(props) {
  return (
    <div class="wsx-skeleton" aria-hidden="true">
      <For each={Array.from({ length: props.count || 4 })}>
        {() => <div class="wsx-skeleton-row"><span class="wsx-skeleton-icon" /><span class="wsx-skeleton-line" /><span class="wsx-skeleton-line short" /></div>}
      </For>
    </div>
  );
}

/* props: icon, title, text, action (element) */
export function EmptyState(props) {
  return (
    <div class="wsx-empty" role="status">
      <span class="wsx-empty-icon" aria-hidden="true"><Icon name={props.icon || "drive"} /></span>
      <p class="wsx-empty-title">{props.title}</p>
      <Show when={props.text}><p class="wsx-hint">{props.text}</p></Show>
      <Show when={props.action}><div class="wsx-empty-action">{props.action}</div></Show>
    </div>
  );
}

/* Desktop's Checkbox: a native box; a click on it does not reach the row. props: checked, indeterminate, label, onChange */
export function Checkbox(props) {
  let el;
  createEffect(() => { if (el) el.indeterminate = !!props.indeterminate; });
  return (
    <input ref={(x) => (el = x)} type="checkbox" class={"wsx-checkbox " + (props.class || "")} checked={!!props.checked} tabindex={props.tabindex}
           aria-label={props.label} disabled={props.disabled}
           onClick={(e) => e.stopPropagation()} onDblClick={(e) => e.stopPropagation()}
           onChange={(e) => props.onChange && props.onChange(e.currentTarget.checked, e)} />
  );
}

/* Desktop's InfoBanner. props: tone (primary | warning | danger | success), icon, title, description, children (actions) */
export function InfoBanner(props) {
  return (
    <div class={"wsx-infobanner " + (props.class || "")} data-tone={props.tone || "primary"} role={props.tone === "danger" ? "alert" : "status"}>
      <span class="wsx-infobanner-mark" aria-hidden="true"><Icon name={props.icon || "info"} /></span>
      <span class="wsx-infobanner-text">
        <span class="wsx-infobanner-title">{props.title}</span>
        <Show when={props.description}><span class="wsx-infobanner-desc">{props.description}</span></Show>
      </span>
      <Show when={props.children}><span class="wsx-infobanner-actions">{props.children}</span></Show>
    </div>
  );
}

/* Desktop's ConnectionWarning: a thin line while offline. props: when, text */
export function ConnectionWarning(props) {
  return (
    <Show when={props.when}>
      <div class="wsx-connwarn" role="status"><Icon name="warning" />{props.text}</div>
    </Show>
  );
}

/*
 * Desktop's SyncButton: Refresh that shows it is working, then done or failed for a moment.
 * props: onSync() → Promise, label, busyLabel, doneLabel, failedLabel, iconOnly
 */
export function SyncButton(props) {
  const [state, setState] = createSignal("ready");
  let timer;
  onCleanup(() => clearTimeout(timer));
  const words = () => ({ ready: props.label, syncing: props.busyLabel || props.label, done: props.doneLabel || props.label, failed: props.failedLabel || props.label });
  async function click() {
    if (state() === "syncing") return;
    clearTimeout(timer);
    setState("syncing");
    let ok = true;
    try { await props.onSync(); } catch { ok = false; }
    setState(ok ? "done" : "failed");
    timer = setTimeout(() => setState("ready"), 1600);
  }
  const icon = () => (state() === "done" ? "check" : state() === "failed" ? "warning" : "refresh");
  return (
    <Tooltip text={words()[state()]}>
      <button type="button" class={"wsx-btn wsx-btn-secondary wsx-sync" + (props.iconOnly ? " wsx-btn-icon wsx-btn-square" : "")} data-state={state()}
              aria-busy={state() === "syncing" ? "true" : undefined} aria-label={words()[state()]} onClick={click}>
        <Icon name={icon()} />
        <Show when={!props.iconOnly}><span>{words()[state()]}</span></Show>
      </button>
      <span class="wsx-visually-hidden" role="status" aria-live="polite">{state() === "ready" ? "" : words()[state()]}</span>
    </Tooltip>
  );
}

/*
 * Desktop's Menu for the kit: a Popover of menu items with arrow keys, Home/End, Enter and Escape.
 * props: open, anchor (element) or point {x, y}, onClose, label, items [{id, label, icon, danger, disabled, checked, separator, head}]
 * and onSelect(item).
 */
export function Menu(props) {
  let box;
  const anchor = () => {
    if (props.anchor) return props.anchor;
    if (!props.point) return null;
    return { getBoundingClientRect: () => ({ top: props.point.y, bottom: props.point.y, left: props.point.x, right: props.point.x, width: 0, height: 0 }),
             contains: () => false, matches: () => false, querySelector: () => null };
  };
  const items = () => (box ? [...box.querySelectorAll("[role=menuitem],[role=menuitemcheckbox]")].filter((x) => x.getAttribute("aria-disabled") !== "true") : []);
  createEffect(() => {
    if (props.open) requestAnimationFrame(() => items()[0] && items()[0].focus());
  });
  function onKey(e) {
    const list = items();
    const i = list.indexOf(document.activeElement);
    let j = -1;
    if (e.key === "ArrowDown") j = (i + 1) % list.length;
    else if (e.key === "ArrowUp") j = (i - 1 + list.length) % list.length;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = list.length - 1;
    else if (e.key === "Tab") return props.onClose && props.onClose();
    if (j < 0 || !list.length) return;
    e.preventDefault();
    list[j].focus();
  }
  const pick = (item) => {
    if (item.disabled) return;
    props.onClose && props.onClose();
    props.onSelect && props.onSelect(item);
  };
  return (
    <Popover open={props.open} anchor={anchor()} onClose={props.onClose} class={"wsx-menu " + (props.class || "")}>
      <div role="menu" aria-label={props.label} ref={(el) => (box = el)} onKeyDown={onKey}>
        <For each={props.items || []}>
          {(item) => (
            <Show when={!item.separator} fallback={<div class="wsx-menu-sep" role="separator" />}>
              <Show when={!item.head} fallback={<div class="wsx-menu-head">{item.label}</div>}>
                <button type="button" role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"} tabindex="-1"
                        class={"wsx-menu-item" + (item.danger ? " is-danger" : "")} aria-disabled={item.disabled ? "true" : undefined}
                        aria-checked={item.checked === undefined ? undefined : item.checked ? "true" : "false"} title={item.reason}
                        onClick={() => pick(item)}>
                  <Show when={item.icon}><Icon name={item.icon} /></Show>
                  <span class="wsx-ellipsis">{item.label}</span>
                  <Show when={item.hint}><span class="wsx-menu-hint">{item.hint}</span></Show>
                </button>
              </Show>
            </Show>
          )}
        </For>
      </div>
    </Popover>
  );
}
