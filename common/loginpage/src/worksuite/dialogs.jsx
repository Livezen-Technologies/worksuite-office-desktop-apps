/*
 * "Sign in to WorkSuite" and "New document in WorkSuite Drive", the two
 * dialogs of the WorkSuite section. Same flow as the 9.x start page.
 */
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { Button, Dialog } from "@/components";
import { L } from "./lang.js";
import { ContinueCard, hostOf } from "./cards.jsx";

const WS = () => window.WorkSuite;

// WorkSuite Desktop answers in seconds; a browser sign-in can take a while (two-step verification)
const WAITS = { desktop: 2 * 60 * 1000, browser: 5 * 60 * 1000 };

export function Frame(props) {
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <Dialog.Content class="ws-dlg" classList={{ "ws-dlg-wide-panel": !!props.wide }}>
        <div class="ws-dlg-head">
          <Dialog.Title class="ws-dlg-title">{props.title}</Dialog.Title>
          <Dialog.CloseButton class="ws-dlg-x" aria-label={L.wsCancel}>
            <svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" /></svg>
          </Dialog.CloseButton>
        </div>
        <div class="ws-dlg-body">{props.children}</div>
      </Dialog.Content>
    </Dialog>
  );
}

export function SignInDialog(props) {
  const [server, setServer] = createSignal(WS().DEFAULT_SERVER);
  const [error, setError] = createSignal("");
  const [custom, setCustom] = createSignal(false);
  const [url, setUrl] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [wait, setWait] = createSignal(null); // { desktop: bool, text, timedOut }
  const [codeOpen, setCodeOpen] = createSignal(false);
  const [code, setCode] = createSignal("");
  const [codeError, setCodeError] = createSignal("");
  const [desktops, setDesktops] = createSignal([]);
  let timer, lastDesktop = null, signedIn = false;

  const knownSignedOut = () => WS().accounts().filter((a) => a.signedOut);

  function waiting(target, viaDesktop) {
    clearTimeout(timer);
    setServer(target);
    setCodeOpen(false);
    setCode("");
    setCodeError("");
    setWait({ desktop: viaDesktop, text: viaDesktop ? L.wsWaitDesktop : L.wsWaitBrowser, timedOut: false });
    // never a spinner forever: say what to do, with a way to try again
    timer = setTimeout(() => {
      if (viaDesktop) {
        WS().cancelSignIn();
        setWait({ desktop: true, text: L.wsDesktopTimeout, timedOut: true });
      } else {
        setWait({ desktop: false, text: L.wsBrowserTimeout, timedOut: true });
      }
    }, viaDesktop ? WAITS.desktop : WAITS.browser);
  }

  function backToStart(msg) {
    clearTimeout(timer);
    setWait(null);
    setError(msg || "");
  }

  async function start(target) {
    setError("");
    try {
      waiting(await WS().signIn(target), false);
    } catch (e) {
      backToStart(e.message);
    }
  }

  async function startDesktop(account) {
    setError("");
    lastDesktop = account;
    try {
      waiting(await WS().signInWithDesktop(account), true);
    } catch (e) {
      backToStart(e.message);
    }
  }

  async function signInClick() {
    if (custom() && url().trim()) {
      const candidate = WS().normalizeServer(url());
      if (!candidate) return setError(L.wsErrServerNotFound);
      setBusy(true);
      try {
        const found = await WS().checkServer(candidate);
        if (!found.office) throw new Error(L.wsErrServerOld);
        setServer(candidate);
      } catch (e) {
        return setError(e.message);
      } finally {
        setBusy(false);
      }
    }
    start(server());
  }

  function useCode() {
    const ok = WS().finishWithCode(code());
    setCodeError(ok ? "" : L.wsErrCode);
  }

  onMount(() => {
    const live = WS().accounts().filter((a) => !a.signedOut).map((a) => a.id);
    WS().desktopAccounts().then((list) => setDesktops(list.filter((d) => !live.includes(d.server + "|" + d.user.id))));

    const done = () => { signedIn = true; props.onClose(); };
    const failed = (e) => backToStart(e.message);
    WS().on("signedin", done);
    WS().on("error", failed);
    onCleanup(() => {
      clearTimeout(timer);
      if (!signedIn && WS().pendingSignIn()) WS().cancelSignIn();
      WS().off("signedin", done);
      WS().off("error", failed);
    });

    if (props.desktopAccount) startDesktop(props.desktopAccount);
  });

  return (
    <Frame title={L.wsSignInTitle} onClose={props.onClose}>
      <Show when={!wait()}>
        <p class="ws-dlg-descr">{L.wsSignInDescr}</p>
        <div class="ws-dlg-cards">
          <For each={desktops()}>
            {(d) => <ContinueCard primary name={d.user.name} via={L.wsViaDesktop}
                                  org={[d.user.organization, hostOf(d.server)].filter(Boolean).join(" · ")} onClick={() => startDesktop(d)} />}
          </For>
          <For each={knownSignedOut()}>
            {(a) => <ContinueCard name={a.user.name} org={[a.user.organization, hostOf(a.server)].filter(Boolean).join(" · ")}
                                  onClick={() => start(a.server)} />}
          </For>
        </div>
        <Show when={custom()}>
          <input type="text" class="ws-input" spellcheck={false} placeholder={L.wsServerPlaceholder} value={url()} autofocus
                 onInput={(e) => setUrl(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && signInClick()} />
        </Show>
        <Button variant={desktops().length ? "outline" : "accent"} class="ws-dlg-wide" disabled={busy()} onClick={signInClick}>
          {L.wsSignInButton}
        </Button>
        <Show when={!custom()}>
          <p class="ws-dlg-server">
            {L.wsServerIs.replace("$1", hostOf(server()))} ·{" "}
            <a href="#" onClick={(e) => { e.preventDefault(); setCustom(true); }}>{L.wsOtherServer}</a>
          </p>
        </Show>
        <Show when={error()}><p class="ws-error" role="alert">{error()}</p></Show>
      </Show>

      <Show when={wait()}>
        <div class="ws-wait">
          <Show when={!wait().timedOut}><div class="ws-spinner" aria-hidden="true" /></Show>
          <p class="ws-wait-text">{wait().text}</p>
          <p class="ws-dlg-server">{hostOf(server())}</p>
          <Show when={!wait().desktop}>
            <Show when={codeOpen()} fallback={
              <a href="#" class="ws-link" onClick={(e) => { e.preventDefault(); setCodeOpen(true); }}>{L.wsHaveCode}</a>
            }>
              <div class="ws-code-row">
                <input type="text" class="ws-input" spellcheck={false} autocomplete="off" placeholder={L.wsCodePlaceholder} autofocus
                       value={code()} onInput={(e) => setCode(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && useCode()} />
                <Button variant="accent" onClick={useCode}>{L.wsCodeContinue}</Button>
              </div>
            </Show>
            <Show when={codeError()}><p class="ws-error" role="alert">{codeError()}</p></Show>
          </Show>
          <div class="ws-dlg-buttons">
            <Show when={wait().desktop && wait().timedOut}>
              <Button variant="accent" onClick={() => lastDesktop && startDesktop(lastDesktop)}>{L.wsTryAgain}</Button>
            </Show>
            <Show when={!wait().desktop}>
              <Button onClick={() => start(server())}>{L.wsOpenAgain}</Button>
            </Show>
            <Show when={wait().desktop}>
              <Button onClick={() => start(server())}>{L.wsUseBrowser}</Button>
            </Show>
            <Button onClick={props.onClose}>{L.wsCancel}</Button>
          </div>
        </div>
      </Show>
    </Frame>
  );
}

/*
 * Save in: a folder of WorkSuite Drive, browsed from My Drive (S05). `onChange(id)` gets the folder chosen
 * (null: the top of My Drive). Shared by New, New from template and Move to….
 */
export function FolderPicker(props) {
  const [listing, setListing] = createSignal(null);
  const [listError, setListError] = createSignal("");

  async function browse(id) {
    props.onChange(id);
    setListing(null);
    setListError("");
    try {
      setListing(await WS().folders(props.account, id));
    } catch (e) {
      setListError(e.message);
    }
  }

  const crumbs = () => [{ id: null, name: L.wsMyDrive }].concat((listing() && listing().breadcrumb) || []);
  const folders = () => ((listing() && listing().folders) || []).filter((f) => !props.exclude || String(f.id) !== String(props.exclude));

  onMount(() => browse(props.start || null));

  return (
    <div class="ws-picker">
      <div class="ws-crumbs">
        <For each={crumbs()}>
          {(c, i) => (
            <>
              <Show when={i() > 0}><span class="sep">›</span></Show>
              <Show when={i() < crumbs().length - 1} fallback={<span>{c.name}</span>}>
                <a href="#" onClick={(e) => { e.preventDefault(); browse(c.id || null); }}>{c.name}</a>
              </Show>
            </>
          )}
        </For>
      </div>
      <div class="ws-picker-list">
        <Show when={listing()} fallback={<Show when={listError()} fallback={<div class="ws-spinner small" />}><p class="ws-error">{listError()}</p></Show>}>
          <Show when={folders().length} fallback={<p class="ws-muted">{L.wsNoFolders}</p>}>
            <For each={folders()}>
              {(f) => (
                <button class="ws-picker-item" onClick={() => browse(f.id)}>
                  <svg class="icon"><use href="#folder-small" /></svg>{f.name}
                </button>
              )}
            </For>
          </Show>
        </Show>
      </div>
    </div>
  );
}

const TEMPLATE_ICON = { word: "docx", cell: "xlsx", slide: "pptx" };

/*
 * New document / spreadsheet / presentation in WorkSuite Drive (S05), from a template (T07, DOC-06, G-18):
 * the server's office/templates gallery — the company's templates with their category chips, and Blank —
 * then a name and Save in. A server without the gallery gets the blank dialog it had.
 */
export function NewDialog(props) {
  const untitled = { word: L.wsUntitledDocument, cell: L.wsUntitledSpreadsheet, slide: L.wsUntitledPresentation }[props.type];
  const title = { word: L.wsNewDocument, cell: L.wsNewSpreadsheet, slide: L.wsNewPresentation }[props.type];
  const blankName = { word: L.wsBlankDocument, cell: L.wsBlankSpreadsheet, slide: L.wsBlankPresentation }[props.type];
  const [name, setName] = createSignal(untitled);
  const [folder, setFolder] = createSignal(null);
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [gallery, setGallery] = createSignal(null); // null: none (blank only), [] while loading
  const [category, setCategory] = createSignal("");
  const [picked, setPicked] = createSignal(null); // null: Blank
  let nameEdited = false;

  const companyTemplates = () => (gallery() || []).filter((t) => t.scope !== "system");
  const categories = () => [...new Set(companyTemplates().map((t) => t.category).filter(Boolean))];
  const shown = () => companyTemplates().filter((t) => !category() || t.category === category());
  const companyName = () => {
    const ids = [...new Set(companyTemplates().map((t) => String(t.organization_id)))];
    const list = (WS().accounts().find((a) => a.id === props.account.id) || {}).companies || [];
    const names = ids.map((id) => (list.find((c) => String(c.id) === id) || {}).name).filter(Boolean);
    return names.length ? names.join(", ") : props.account.user.organization || "";
  };

  function pick(t) {
    setPicked(t);
    if (!nameEdited) setName(t ? t.name : untitled);
  }

  async function create() {
    const n = name().trim();
    if (!n) return setError(L.wsErrName);
    setBusy(true);
    try {
      const file = gallery() !== null
        ? await WS().createFromTemplate(props.account, props.type, picked(), n, folder())
        : await WS().create(props.account, props.type, n, folder());
      props.onClose();
      props.onCreated && props.onCreated(file);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  onMount(() => {
    WS().templates(props.account, props.type).then((list) => setGallery(list), () => setGallery(null));
    if (!(WS().accounts().find((a) => a.id === props.account.id) || {}).companies) WS().companies(props.account).catch(() => {});
  });

  return (
    <Frame title={title} onClose={props.onClose} wide={companyTemplates().length > 0}>
      <Show when={companyTemplates().length}>
        <p class="ws-dlg-descr">
          {companyName() ? L.wsTemplatesFrom.replace("$1", companyName()).replace("$2", hostOf(props.account.server)) : L.wsTemplates}
        </p>
        <Show when={categories().length}>
          <div class="ws-chips" role="tablist">
            <button role="tab" classList={{ selected: !category() }} onClick={() => setCategory("")}>{L.wsAll}</button>
            <For each={categories()}>
              {(c) => <button role="tab" classList={{ selected: category() === c }} onClick={() => setCategory(c)}>{c}</button>}
            </For>
          </div>
        </Show>
        <div class="ws-templates">
          <button class="ws-template" classList={{ selected: !picked() }} onClick={() => pick(null)}>
            <span class="ws-template-art"><svg class="icon"><use href={`#${TEMPLATE_ICON[props.type]}`} /></svg></span>
            <span class="ws-template-name">{blankName}</span>
          </button>
          <For each={shown()}>
            {(t) => (
              <button class="ws-template" classList={{ selected: picked() && picked().id === t.id }} onClick={() => pick(t)} title={t.name}>
                <span class="ws-template-art"><svg class="icon"><use href={`#${t.extension || TEMPLATE_ICON[props.type]}`} /></svg></span>
                <span class="ws-template-name">{t.name}</span>
              </button>
            )}
          </For>
        </div>
      </Show>
      <label class="ws-label">{L.wsName}</label>
      <input type="text" class="ws-input" spellcheck={false} value={name()} autofocus
             ref={(el) => setTimeout(() => el.select(), 0)}
             onInput={(e) => { nameEdited = true; setName(e.currentTarget.value); }} onKeyDown={(e) => e.key === "Enter" && create()} />
      <label class="ws-label">{L.wsSaveIn}</label>
      <FolderPicker account={props.account} onChange={setFolder} />
      <Show when={error()}><p class="ws-error" role="alert">{error()}</p></Show>
      <div class="ws-dlg-buttons">
        <Button variant="accent" disabled={busy()} onClick={create}>{L.wsCreate}</Button>
        <Button onClick={props.onClose}>{L.wsCancel}</Button>
      </div>
    </Frame>
  );
}
