/*
 * WorkSuite UI kit of the start page (Solid): the building blocks of Settings › WorkSuite and the
 * WorkSuite Drive connect card. Styles in components.css, tokens in tokens.css. Icons are sprite
 * symbols (res/img/common-svg/ws-*.svg).
 */
import { For, Show, createEffect, createMemo, createSignal, createUniqueId, onCleanup } from "solid-js";
import { L } from "../lang.js";
import { hostOf, initials } from "../cards.jsx";
import { accountStatus, filterAccounts, nextIndex, validateServer } from "../settings-logic.js";
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

export function Avatar(props) {
  const [broken, setBroken] = createSignal(false);
  createEffect(() => {
    props.src;
    setBroken(false);
  });
  return (
    <span class={"wsx-avatar" + (props.small ? " wsx-avatar-sm" : "")} aria-hidden="true">
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
  desktop: () => L.wsxViaDesktopAvailable,
  connecting: () => L.wsxConnecting,
};
const STATUS_TONE = { "signed-in": "success", expired: "warning", "signed-out": "neutral", desktop: "info", connecting: "info" };

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
 * One account: avatar (photo when the server gave one), name, server, status, and the actions the
 * backend has. props: account, isDefault, busy, error, onSignIn, onSignOut, onRemove, onSetDefault
 */
export function AccountCard(props) {
  const a = () => props.account;
  const status = () => (props.busy === "signin" ? "connecting" : accountStatus(a()));
  return (
    <div class="wsx-account" classList={{ "is-default": props.isDefault }}>
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
        <Show when={props.error}><div class="wsx-msg wsx-tone-danger" role="alert"><Icon name="alert" />{props.error}</div></Show>
      </div>
      <StatusBadge status={status()} />
      <div class="wsx-account-actions">
        <Show when={!props.isDefault && status() === "signed-in" && props.onSetDefault}>
          <WsButton small variant="ghost" disabled={!!props.busy} onClick={props.onSetDefault}>{L.wsxSetDefault}</WsButton>
        </Show>
        <Show when={status() === "expired" || status() === "connecting" || status() === "desktop"}>
          <WsButton small variant="primary" busy={props.busy === "signin"} disabled={!!props.busy} onClick={props.onSignIn}>
            {a().desktopOnly ? L.wsxConnect : L.wsxReconnect}
          </WsButton>
        </Show>
        <Show when={!a().desktopOnly && (status() === "expired" || status() === "connecting")}>
          <WsButton small variant="ghost" busy={props.busy === "remove"} disabled={!!props.busy} onClick={props.onRemove}>{L.wsxRemove}</WsButton>
        </Show>
        <Show when={status() === "signed-in"}>
          <WsButton small variant="secondary" busy={props.busy === "signout"} disabled={!!props.busy} onClick={props.onSignOut}>{L.wsSignOutBtn}</WsButton>
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
  const outside = (e) => root && !root.contains(e.target) && close();
  createEffect(() => {
    if (open()) {
      document.addEventListener("mousedown", outside);
      const i = list().findIndex((a) => a.id === props.selectedId);
      setHi(i < 0 ? 0 : i);
      queueMicrotask(() => input && input.focus());
    } else document.removeEventListener("mousedown", outside);
  });
  onCleanup(() => document.removeEventListener("mousedown", outside));

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
      <Show when={open()}>
        <div class="wsx-combo-pop">
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
      </Show>
    </div>
  );
}
