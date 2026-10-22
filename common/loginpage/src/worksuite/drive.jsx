/*
 * WorkSuite Drive in the app (G-09, G-06): Move to… (DRV-08), Version history (DRV-09, T03), Share (DRV-10, T04)
 * and opening a worksuiteoffice://open link as one of the signed-in accounts (LNK-04/05, T10). Every rule is the
 * server's: these only show what it answers and hide what it does not offer.
 */
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { Button } from "@/components";
import { L } from "./lang.js";
import { Frame, FolderPicker } from "./dialogs.jsx";
import { hostOf, initials, when } from "./cards.jsx";

const WS = () => window.WorkSuite;

/* ------------------------------------------------------------------ Move to… */

export function MoveDialog(props) {
  const [folder, setFolder] = createSignal(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");

  async function move() {
    setBusy(true);
    setError("");
    try {
      await WS().move(props.account, props.file, folder());
      props.onClose();
      props.onDone && props.onDone(L.wsMoved);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Frame title={L.wsMoveTitle.replace("$1", props.file.name)} onClose={props.onClose}>
      <label class="ws-label">{L.wsMoveTo}</label>
      <FolderPicker account={props.account} onChange={setFolder} />
      <Show when={error()}><p class="ws-error" role="alert">{error()}</p></Show>
      <div class="ws-dlg-buttons">
        <Button variant="accent" disabled={busy()} onClick={move}>{L.wsMoveHere}</Button>
        <Button onClick={props.onClose}>{L.wsCancel}</Button>
      </div>
    </Frame>
  );
}

/* ------------------------------------------------------------------ Version history */

const CLIENTS = () => ({ office: L.wsFromOffice, desktop: L.wsFromDesktop, web: L.wsFromWeb, mobile: L.wsFromMobile });

export function VersionsDialog(props) {
  const [list, setList] = createSignal(null);
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const canRestore = () => props.file.level !== "view";

  async function load() {
    setError("");
    try {
      setList(await WS().versions(props.account, props.file));
    } catch (e) {
      setList([]);
      setError(e.message);
    }
  }

  async function restore(v) {
    setBusy(true);
    setError("");
    try {
      await WS().restoreVersion(props.account, props.file, v);
      await load();
      props.onDone && props.onDone(L.wsRestored.replace("$1", v.version));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function openOld(v) {
    WS().openVersion(props.account, props.file, v).catch((e) => setError(e.message));
  }

  const meta = (v) => [v.author, when(v.at), CLIENTS()[v.client] || v.label].filter(Boolean).join(" · ");

  onMount(load);

  return (
    <Frame title={L.wsVersionHistory} onClose={props.onClose} wide>
      <p class="ws-dlg-descr ws-strong">{props.file.name}</p>
      <div class="ws-versions">
        <Show when={list()} fallback={<div class="ws-spinner small" />}>
          <For each={list()}>
            {(v) => (
              <div class="ws-version" classList={{ current: v.current }}>
                <div class="ws-version-text">
                  <span class="ws-version-name">
                    {L.wsVersionN.replace("$1", v.version)}
                    <Show when={v.current}><span class="ws-badge">{L.wsCurrent}</span></Show>
                  </span>
                  <span class="ws-version-meta">{meta(v)}</span>
                </div>
                <Show when={!v.current}>
                  <div class="ws-version-actions">
                    <Show when={v.openable}><Button class="ws-btn-small" onClick={() => openOld(v)}>{L.menuFileOpen}</Button></Show>
                    <Show when={canRestore() && v.id !== null}>
                      <Button class="ws-btn-small" disabled={busy()} onClick={() => restore(v)}>{L.wsRestore}</Button>
                    </Show>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </div>
      <Show when={error()}><p class="ws-error" role="alert">{error()}</p></Show>
      <p class="ws-muted">{L.wsRestoreNote}</p>
      <div class="ws-dlg-buttons">
        <Button onClick={props.onClose}>{L.wsClose}</Button>
      </div>
    </Frame>
  );
}

/* ------------------------------------------------------------------ Share */

/* Drive's levels as the dialog names them. "comment" only where the server offers it. */
const ROLE_LABEL = () => ({ edit: L.wsRoleEditor, comment: L.wsRoleCommenter, view: L.wsRoleViewer, full: L.wsRoleFull });

function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(() => true, () => fallbackCopy(text));
  } catch (e) { /* below */ }
  return Promise.resolve(fallbackCopy(text));
}

function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
  ta.remove();
  return ok;
}

export function ShareDialog(props) {
  const [info, setInfo] = createSignal(null);
  const [error, setError] = createSignal("");
  const [q, setQ] = createSignal("");
  const [found, setFound] = createSignal([]);
  const [adding, setAdding] = createSignal([]);
  const [role, setRole] = createSignal("edit");
  const [notify, setNotify] = createSignal(true);
  const [busy, setBusy] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  let searchTimer, seq = 0;

  const levels = () => {
    const offered = info() && Array.isArray(info().levels) ? info().levels : null;
    return ["edit", "comment", "view"].filter((l) => (offered ? offered.includes(l) : l !== "comment"));
  };
  const company = () => info() && info().item && info().item.company;
  const isCompanyGrant = (g) => company() && g.principal && g.principal.type === "organization" && String(g.principal.id) === String(company().id);
  const people = () => ((info() && info().grants) || []).filter((g) => g.effect === "allow" && !isCompanyGrant(g));
  const companyGrant = () => ((info() && info().grants) || []).find((g) => g.effect === "allow" && isCompanyGrant(g)) || null;
  const mayShare = () => info() && info().may && info().may.share;

  async function load() {
    try {
      const a = await WS().access(props.account, props.file);
      setInfo(a);
      const d = a && a.notify_defaults;
      if (d && typeof d === "object" && typeof d.share === "boolean") setNotify(d.share);
    } catch (e) {
      setError(e.message);
    }
  }

  function search(text) {
    setQ(text);
    clearTimeout(searchTimer);
    if (text.trim().length < 2) return setFound([]);
    const mine = ++seq;
    searchTimer = setTimeout(async () => {
      try {
        const r = await WS().principals(props.account, props.file, text.trim());
        if (mine !== seq) return;
        const all = [].concat(r.people || [], r.teams || [], r.departments || [], r.companies || []);
        setFound(all.filter((p) => !adding().some((x) => x.type === p.type && x.id === p.id)));
      } catch (e) {
        if (mine === seq) setFound([]);
      }
    }, 250);
  }

  function add(p) {
    setAdding([...adding(), p]);
    setFound([]);
    setQ("");
  }

  async function shareNow() {
    setBusy(true);
    setError("");
    try {
      for (const p of adding()) await WS().grant(props.account, props.file, p, role(), notify());
      setAdding([]);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function change(g, level) {
    setError("");
    try {
      if (level === "") await WS().revokeGrant(props.account, props.file, g.id);
      else await WS().changeGrant(props.account, props.file, g.id, level);
    } catch (e) {
      setError(e.message);
    }
    load();
  }

  /* General access: Restricted, or everybody in the file's company with view (a link never grants more) */
  async function general(value) {
    setError("");
    try {
      const g = companyGrant();
      if (value === "company" && !g)
        await WS().grant(props.account, props.file, { type: "organization", id: company().id }, "view", false);
      if (value === "restricted" && g) await WS().revokeGrant(props.account, props.file, g.id);
    } catch (e) {
      setError(e.message);
    }
    load();
  }

  async function copyLink() {
    if (await copyText(WS().fileLink(props.account, props.file))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  onMount(load);
  onCleanup(() => clearTimeout(searchTimer));

  const Person = (p) => (
    <div class="ws-person">
      <span class="ws-avatar small" aria-hidden="true">{initials(p.name)}</span>
      <span class="ws-person-text">
        <span class="ws-person-name">{p.name}</span>
        <Show when={p.detail}><span class="ws-person-detail">{p.detail}</span></Show>
      </span>
      {p.children}
    </div>
  );

  return (
    <Frame title={L.wsShareTitle.replace("$1", props.file.name)} onClose={props.onClose} wide>
      <Show when={info()} fallback={<Show when={error()} fallback={<div class="ws-spinner small" />}><p class="ws-error">{error()}</p></Show>}>
        <Show when={mayShare()} fallback={<p class="ws-dlg-descr">{L.wsShareNotAllowed}</p>}>
          <div class="ws-share-add">
            <div class="ws-share-search">
              <For each={adding()}>
                {(p) => (
                  <span class="ws-chip">{p.name}
                    <button aria-label={L.wsRemove} onClick={() => setAdding(adding().filter((x) => x !== p))}>×</button>
                  </span>
                )}
              </For>
              <input type="text" class="ws-input" spellcheck={false} placeholder={L.wsAddPeople} value={q()}
                     onInput={(e) => search(e.currentTarget.value)} />
            </div>
            <select class="ws-select" value={role()} onChange={(e) => setRole(e.currentTarget.value)} aria-label={L.wsRole}>
              <For each={levels()}>{(l) => <option value={l}>{ROLE_LABEL()[l]}</option>}</For>
            </select>
          </div>
          <Show when={found().length}>
            <div class="ws-share-found">
              <For each={found()}>
                {(p) => (
                  <button class="ws-share-hit" onClick={() => add(p)}>
                    <Person name={p.name} detail={p.held || p.detail} />
                  </button>
                )}
              </For>
            </div>
          </Show>
          <Show when={adding().length}>
            <label class="ws-check">
              <input type="checkbox" checked={notify()} onChange={(e) => setNotify(e.currentTarget.checked)} />
              {L.wsNotifyPeople}
            </label>
            <div class="ws-dlg-buttons start">
              <Button variant="accent" disabled={busy()} onClick={shareNow}>{L.wsShare}</Button>
            </div>
          </Show>

          <h4 class="ws-subtitle">{L.wsPeopleWithAccess}</h4>
          <div class="ws-people">
            <Show when={info().item && info().item.owner}>
              <Person name={(info().item.owner.name || "") + (String(info().item.owner.id) === String(props.account.user.id) ? " " + L.wsYou : "")}
                      detail={info().item.owner.email || info().item.owner.detail}>
                <span class="ws-role-fixed">{L.wsOwnerRole}</span>
              </Person>
            </Show>
            <For each={people()}>
              {(g) => (
                <Person name={g.principal.name} detail={g.principal.detail}>
                  <Show when={g.editable} fallback={<span class="ws-role-fixed">{ROLE_LABEL()[g.level] || g.level}</span>}>
                    <select class="ws-select" value={g.level} onChange={(e) => change(g, e.currentTarget.value)} aria-label={L.wsRole}>
                      <For each={levels().includes(g.level) ? levels() : [g.level].concat(levels())}>
                        {(l) => <option value={l}>{ROLE_LABEL()[l] || l}</option>}
                      </For>
                      <option value="">{L.wsRemoveAccess}</option>
                    </select>
                  </Show>
                </Person>
              )}
            </For>
          </div>

          <Show when={company()}>
            <h4 class="ws-subtitle">{L.wsGeneralAccess}</h4>
            <div class="ws-general">
              <select class="ws-select" value={companyGrant() ? "company" : "restricted"} onChange={(e) => general(e.currentTarget.value)}
                      disabled={!!companyGrant() && !companyGrant().editable}>
                <option value="restricted">{L.wsRestricted}</option>
                <option value="company">{L.wsAnyoneIn.replace("$1", company().name)}</option>
              </select>
              <span class="ws-muted">{companyGrant() ? L.wsCanViewLink : L.wsRestrictedNote}</span>
            </div>
          </Show>
        </Show>
        <Show when={error()}><p class="ws-error" role="alert">{error()}</p></Show>
      </Show>
      <div class="ws-dlg-buttons spread">
        <Button onClick={copyLink}>{copied() ? L.wsLinkCopied : L.wsCopyLink}</Button>
        <Button variant="accent" onClick={props.onClose}>{L.wsDone}</Button>
      </div>
    </Frame>
  );
}

/* ------------------------------------------------------------------ Open from a link */

/*
 * Which signed-in account opens a worksuiteoffice://open link (LNK-04): those on the link's server, the link's
 * own (its uid) first and chosen. A src copy (LNK-05, a mail attachment) is said to be a copy, not in Drive.
 */
export function OpenLinkDialog(props) {
  const [choice, setChoice] = createSignal(props.initial ? props.initial.id : props.candidates[0] && props.candidates[0].id);
  const companyName = (a) => {
    const org = props.link.org && String(a.user.id) === String(props.link.uid) ? props.link.org : WS().companyOf(a);
    const c = org && (a.companies || []).find((x) => String(x.id) === String(org));
    return (c && c.name) || a.user.organization || "";
  };
  const ext = () => (WS().extOf(props.link.name) || "").toUpperCase();

  return (
    <Frame title={props.link.src ? L.wsOpenCopyTitle : L.wsOpenLinkTitle} onClose={props.onClose}>
      <div class="ws-link-file">
        <span class="ws-ext-badge">{ext() || "DOC"}</span>
        <span class="ws-card-text">
          <span class="ws-continue-name">{props.link.name || L.wsUntitledDocument}</span>
          <Show when={props.link.src}><span class="ws-continue-org">{L.wsCopyNotInDrive}</span></Show>
        </span>
      </div>
      <label class="ws-label">{L.wsOpenAs}</label>
      <div class="ws-dlg-cards" role="radiogroup">
        <For each={props.candidates}>
          {(a) => (
            <button class="ws-account-card" role="radio" aria-checked={choice() === a.id} classList={{ "is-primary": choice() === a.id }}
                    onClick={() => setChoice(a.id)}>
              <span class="ws-avatar" aria-hidden="true">{initials(a.user.name)}</span>
              <span class="ws-card-text">
                <span class="ws-continue-name">{a.user.name}
                  <Show when={props.link.uid && String(a.user.id) === String(props.link.uid)}><span class="ws-badge">{L.wsFromLink}</span></Show>
                </span>
                <span class="ws-continue-org">{[companyName(a), hostOf(a.server)].filter(Boolean).join(" · ")}</span>
              </span>
            </button>
          )}
        </For>
      </div>
      <Show when={props.link.uid && !props.candidates.some((a) => String(a.user.id) === String(props.link.uid))}>
        <p class="ws-muted">{L.wsLinkOtherAccount} <a href="#" onClick={(e) => { e.preventDefault(); props.onSignIn(); }}>{L.wsAddAccount}</a></p>
      </Show>
      <Show when={props.link.src}><p class="ws-muted">{L.wsCopyNote}</p></Show>
      <Show when={props.error}><p class="ws-error" role="alert">{props.error}</p></Show>
      <div class="ws-dlg-buttons">
        <Button onClick={props.onClose}>{L.wsCancel}</Button>
        <Button variant="accent" disabled={!choice()} onClick={() => props.onOpen(props.candidates.find((a) => a.id === choice()))}>{L.menuFileOpen}</Button>
      </div>
    </Frame>
  );
}
