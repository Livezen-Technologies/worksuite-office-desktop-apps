/*
 * Settings › AI & MCP Connectors: AI providers (OpenAI-compatible, Ollama, custom), the default for the
 * Office AI features, MCP servers (stdio, Streamable HTTP), tool permissions and the activity log.
 * Rules in logic.js, protocol in mcp-client.js, state and the permission gate in service.js.
 */
import { For, Show, createSignal, onMount } from "solid-js";
import { Section } from "../ai-models/AiModelsPage.jsx";
import { Frame } from "@/worksuite/dialogs.jsx";
import { S, errorText } from "./strings.js";
import {
  AUTH_TYPES, OLLAMA_URL, PROVIDER_KINDS, availableModels, formatEnv, joinArgs, locationOf, newId, normalizeProvider,
  normalizeServer, parseEnv, permissionList, resultText, splitArgs, validateProvider, validateServer,
} from "./logic.js";
import {
  callTool, checkStore, clearLog, modelsOf, nativeAvailable, policy, removeProvider, removeServer, revokeAll,
  revokePermission, saveProvider, saveServer, setDefault, setServerEnabled, state, testProvider, testServer,
} from "./service.js";
import "../ai-models/ai-models.css";
import "@/worksuite/worksuite.css";
import "./connectors.css";

function Badge(props) {
  return <span class={"aim-badge aim-badge-" + props.kind}>{props.children}</span>;
}

function StatusBadge(props) {
  const kind = () => ({ ok: "ok", error: "fit-no", testing: "fit-tight", disabled: "lock" })[props.status] || "lock";
  return <Badge kind={kind()}>{S["status_" + (props.status || "unknown")]}</Badge>;
}

function Field(props) {
  return (
    <label class="aic-field">
      <span>{props.label}</span>
      {props.children}
      <Show when={props.hint}>
        <span class="aim-muted aim-small">{props.hint}</span>
      </Show>
      <Show when={props.error}>
        <span class="aic-field-error" role="alert">{props.error}</span>
      </Show>
    </label>
  );
}

const when = (t) => (t ? new Date(t).toLocaleString() : "");
const fieldError = (errors, field) => {
  const e = errors.find((x) => x[0] === field);
  return e ? S["invalid_" + field + "_" + e[1]] : "";
};

/* ---- providers ---------------------------------------------------------- */

function ProviderDialog(props) {
  const p0 = normalizeProvider(props.provider || { kind: "openai" });
  const [kind, setKind] = createSignal(p0.kind);
  const [name, setName] = createSignal(p0.name);
  const [baseUrl, setBaseUrl] = createSignal(p0.baseUrl);
  const [authType, setAuthType] = createSignal(p0.auth.type);
  const [header, setHeader] = createSignal(p0.auth.header || "X-API-Key");
  const [key, setKey] = createSignal("");
  const [removeKey, setRemoveKey] = createSignal(false);
  const [manual, setManual] = createSignal(p0.manualModels.join(", "));
  const [editors, setEditors] = createSignal(props.provider ? p0.useInEditors : true);
  const [errors, setErrors] = createSignal([]);
  const [failure, setFailure] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const onKind = (k) => {
    setKind(k);
    if (k === "ollama") {
      setAuthType("none");
      if (!baseUrl()) setBaseUrl(OLLAMA_URL);
      if (!name()) setName("Ollama");
    } else if (authType() === "none" && !props.provider) setAuthType("bearer");
  };

  const draft = () =>
    normalizeProvider({
      ...p0,
      kind: kind(),
      name: name(),
      baseUrl: baseUrl(),
      auth: { type: authType(), header: header() },
      manualModels: manual().split(",").map((x) => x.trim()).filter(Boolean),
      useInEditors: editors(),
    });

  async function save(e) {
    e.preventDefault();
    const d = draft();
    const errs = validateProvider(d, state.providers);
    setErrors(errs);
    if (errs.length) return;
    setBusy(true);
    setFailure("");
    try {
      const saved = await saveProvider(d, d.auth.type === "none" ? "" : key(), removeKey());
      props.onClose();
      testProvider(saved.id);
    } catch (err) {
      setFailure(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Frame title={props.provider ? S.edit : S.addProvider} wide onClose={props.onClose}>
      <form class="aic-form aic-scope" onSubmit={save}>
        <Field label={S.name} error={fieldError(errors(), "name")}>
          <input class="aim-input" value={name()} onInput={(e) => setName(e.currentTarget.value)} />
        </Field>
        <Field label={S.transport}>
          <select class="aim-select" value={kind()} onChange={(e) => onKind(e.currentTarget.value)}>
            <For each={PROVIDER_KINDS}>{(k) => <option value={k}>{S["kind_" + k]}</option>}</For>
          </select>
        </Field>
        <Field label={S.baseUrl} hint={S["baseUrlHint_" + kind()]} error={fieldError(errors(), "baseUrl")}>
          <input class="aim-input aic-mono" value={baseUrl()} onInput={(e) => setBaseUrl(e.currentTarget.value)} spellcheck={false} />
        </Field>
        <Show when={kind() !== "ollama"}>
          <Field label={S.auth}>
            <select class="aim-select" value={authType()} onChange={(e) => setAuthType(e.currentTarget.value)}>
              <For each={["none", "bearer", "header"]}>{(a) => <option value={a}>{S["auth_" + a]}</option>}</For>
            </select>
          </Field>
          <Show when={authType() === "header"}>
            <Field label={S.headerName} error={fieldError(errors(), "header")}>
              <input class="aim-input aic-mono" value={header()} onInput={(e) => setHeader(e.currentTarget.value)} />
            </Field>
          </Show>
          <Show when={authType() !== "none"}>
            <Field label={S.apiKey} hint={p0.hasSecret ? S.apiKeySaved : ""}>
              <input class="aim-input" type="password" autocomplete="off" value={key()} onInput={(e) => setKey(e.currentTarget.value)} />
            </Field>
            <Show when={p0.hasSecret}>
              <label class="aic-check">
                <input type="checkbox" checked={removeKey()} onChange={(e) => setRemoveKey(e.currentTarget.checked)} />
                <span>{S.removeKey}</span>
              </label>
            </Show>
          </Show>
          <Field label={S.manualModels} hint={S.manualModelsHint}>
            <input class="aim-input aic-mono" value={manual()} onInput={(e) => setManual(e.currentTarget.value)} />
          </Field>
        </Show>
        <label class="aic-check">
          <input type="checkbox" checked={editors()} onChange={(e) => setEditors(e.currentTarget.checked)} />
          <span>
            {S.useInEditors}
            <br />
            <span class="aim-muted aim-small">{S.useInEditorsText}</span>
          </span>
        </label>
        <Show when={failure()}>
          <p class="aic-error" role="alert">{failure()}</p>
        </Show>
        <div class="aim-actions aic-end">
          <button type="button" class="aim-btn" onClick={props.onClose}>{S.cancel}</button>
          <button type="submit" class="aim-btn aim-btn-primary" disabled={busy()}>{S.save}</button>
        </div>
      </form>
    </Frame>
  );
}

function ProvidersSection(props) {
  const [editing, setEditing] = createSignal(null);
  const [open, setOpen] = createSignal({});
  const disabled = () => !props.usable;
  const rt = (id) => state.providerRuntime[id] || {};

  const defProvider = () => (state.def && state.def.providerId) || "";
  const defModel = () => (state.def && state.def.model) || "";
  const onDefProvider = (id) => {
    if (!id) return setDefault(null);
    setDefault({ providerId: id, model: modelsOf(id)[0] || "" });
  };

  return (
    <>
      <Section
        id="aic-default"
        title={S.defaultProvider}
        text={S.defaultText}
      >
        <div class="aim-defaults">
          <label class="aim-default">
            <span class="aim-default-label">{S.provider}</span>
            <select class="aim-select" value={defProvider()} disabled={disabled()} onChange={(e) => onDefProvider(e.currentTarget.value)}>
              <option value="">{S.none}</option>
              <For each={state.providers}>{(p) => <option value={p.id}>{p.name}</option>}</For>
            </select>
          </label>
          <label class="aim-default">
            <span class="aim-default-label">{S.models}</span>
            <select
              class="aim-select"
              value={defModel()}
              disabled={disabled() || !defProvider()}
              onChange={(e) => setDefault({ providerId: defProvider(), model: e.currentTarget.value })}
            >
              <Show when={!modelsOf(defProvider()).length}>
                <option value="">{S.noModels}</option>
              </Show>
              <For each={modelsOf(defProvider())}>{(m) => <option value={m}>{m}</option>}</For>
            </select>
          </label>
        </div>
      </Section>

      <Section
        id="aic-providers"
        title={S.providers}
        text={S.providersText}
        aside={<button type="button" class="aim-btn" disabled={disabled()} onClick={() => setEditing({})}>{S.addProvider}</button>}
      >
        <Show when={state.providers.length} fallback={<p class="aim-empty">{S.noProviders}</p>}>
          <ul class="aim-list">
            <For each={state.providers}>
              {(p) => (
                <li class="aim-row">
                  <div class="aim-row-main">
                    <span class="aim-row-title">{p.name}</span>
                    <span class="aim-badges">
                      <Badge kind="lock">{S["kind_" + p.kind]}</Badge>
                      <Badge kind="lock">{S[locationOf(p.baseUrl)]}</Badge>
                      <StatusBadge status={rt(p.id).status} />
                      <Show when={availableModels(p).length}>
                        <Badge kind="lock">{S.fmt("modelsCount", String(availableModels(p).length))}</Badge>
                      </Show>
                    </span>
                    <span class="aim-muted aim-small aic-mono">{p.baseUrl}</span>
                    <Show when={rt(p.id).error}>
                      <p class="aic-error">{rt(p.id).error.code === "models" ? S.err_models : errorText(rt(p.id).error)}</p>
                    </Show>
                    <Show when={open()[p.id]}>
                      <Show when={availableModels(p).length} fallback={<p class="aim-muted">{S.noModels}</p>}>
                        <p class="aic-mono">{availableModels(p).join(", ")}</p>
                      </Show>
                    </Show>
                  </div>
                  <div class="aim-actions">
                    <button type="button" class="aim-btn" onClick={() => setOpen((o) => ({ ...o, [p.id]: !o[p.id] }))}>{S.models}</button>
                    <button type="button" class="aim-btn" disabled={disabled() || rt(p.id).status === "testing"} onClick={() => testProvider(p.id)}>
                      {rt(p.id).status === "testing" ? S.testing : S.test}
                    </button>
                    <button type="button" class="aim-btn" disabled={disabled()} onClick={() => setEditing(p)}>{S.edit}</button>
                    <button type="button" class="aim-btn" disabled={disabled()} onClick={() => window.confirm(S.fmt("removeConfirm", p.name)) && removeProvider(p.id)}>
                      {S.remove}
                    </button>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Section>
      <Show when={editing()}>
        <ProviderDialog provider={editing().id ? editing() : null} onClose={() => setEditing(null)} />
      </Show>
    </>
  );
}

/* ---- MCP servers -------------------------------------------------------- */

function ServerDialog(props) {
  const s0 = normalizeServer(props.server || { id: newId("mcp") });
  const [name, setName] = createSignal(s0.name);
  const [transport, setTransport] = createSignal(s0.transport);
  const [command, setCommand] = createSignal(s0.command ? joinArgs([s0.command, ...s0.args]) : "");
  const [cwd, setCwd] = createSignal(s0.cwd);
  const [env, setEnv] = createSignal(formatEnv(s0.env));
  const [secretEnv, setSecretEnv] = createSignal(s0.secretEnv.map((n) => ({ name: n, value: "", saved: true })));
  const [url, setUrl] = createSignal(s0.url);
  const [authType, setAuthType] = createSignal(s0.auth.type);
  const [header, setHeader] = createSignal(s0.auth.header || "X-API-Key");
  const [key, setKey] = createSignal("");
  const [removeKey, setRemoveKey] = createSignal(false);
  const [timeout, setTimeoutS] = createSignal(String(s0.timeoutMs / 1000));
  const [errors, setErrors] = createSignal([]);
  const [failure, setFailure] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  async function save(e) {
    e.preventDefault();
    const parts = splitArgs(command());
    const envParsed = parseEnv(env());
    const secrets = secretEnv().filter((x) => x.name.trim());
    const d = normalizeServer({
      ...s0,
      name: name(),
      transport: transport(),
      command: parts[0] || "",
      args: parts.slice(1),
      cwd: cwd(),
      env: envParsed.env,
      secretEnv: secrets.map((x) => x.name.trim()),
      url: url(),
      auth: { type: transport() === "stdio" ? "none" : authType(), header: header() },
      timeoutMs: Number(timeout()) * 1000,
    });
    const errs = validateServer(d, state.servers);
    setErrors(errs);
    if (envParsed.bad.length) {
      setFailure(S.fmt("invalid_env", envParsed.bad.join(", ")));
      return;
    }
    if (errs.length) return;
    setBusy(true);
    setFailure("");
    try {
      const envValues = {};
      for (const x of secrets) if (x.value) envValues[x.name.trim()] = x.value;
      const removed = s0.secretEnv.filter((n) => !d.secretEnv.includes(n));
      const saved = await saveServer(d, { auth: d.auth.type === "none" ? "" : key(), removeAuth: removeKey(), env: envValues, removeEnv: removed });
      props.onClose();
      if (saved.enabled) testServer(saved.id);
    } catch (err) {
      setFailure(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const setSecretAt = (i, patch) => setSecretEnv((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <Frame title={props.server ? S.edit : S.addServer} wide onClose={props.onClose}>
      <form class="aic-form aic-scope" onSubmit={save}>
        <Field label={S.name} error={fieldError(errors(), "name")}>
          <input class="aim-input" value={name()} onInput={(e) => setName(e.currentTarget.value)} />
        </Field>
        <Field label={S.transport}>
          <select class="aim-select" value={transport()} onChange={(e) => setTransport(e.currentTarget.value)}>
            <option value="stdio">{S.transport_stdio}</option>
            <option value="streamable-http">{S["transport_streamable-http"]}</option>
          </select>
        </Field>
        <Show
          when={transport() === "stdio"}
          fallback={
            <>
              <Field label={S.url} hint={S.urlHint + " " + S.sseLegacy} error={fieldError(errors(), "url")}>
                <input class="aim-input aic-mono" value={url()} onInput={(e) => setUrl(e.currentTarget.value)} spellcheck={false} />
              </Field>
              <Field label={S.auth} error={fieldError(errors(), "auth")}>
                <select class="aim-select" value={authType()} onChange={(e) => setAuthType(e.currentTarget.value)}>
                  <For each={AUTH_TYPES}>{(a) => <option value={a} disabled={a === "oauth"}>{S["auth_" + a]}</option>}</For>
                </select>
              </Field>
              <Show when={authType() === "oauth"}>
                <p class="aic-warn">{S.oauthSoon}</p>
              </Show>
              <Show when={authType() === "header"}>
                <Field label={S.headerName} error={fieldError(errors(), "header")}>
                  <input class="aim-input aic-mono" value={header()} onInput={(e) => setHeader(e.currentTarget.value)} />
                </Field>
              </Show>
              <Show when={authType() === "bearer" || authType() === "header"}>
                <Field label={S.apiKey} hint={s0.hasSecret ? S.apiKeySaved : ""}>
                  <input class="aim-input" type="password" autocomplete="off" value={key()} onInput={(e) => setKey(e.currentTarget.value)} />
                </Field>
                <Show when={s0.hasSecret}>
                  <label class="aic-check">
                    <input type="checkbox" checked={removeKey()} onChange={(e) => setRemoveKey(e.currentTarget.checked)} />
                    <span>{S.removeKey}</span>
                  </label>
                </Show>
              </Show>
            </>
          }
        >
          <Field label={S.command} hint={S.commandHint} error={fieldError(errors(), "command")}>
            <input class="aim-input aic-mono" value={command()} onInput={(e) => setCommand(e.currentTarget.value)} spellcheck={false} />
          </Field>
          <Field label={S.cwd}>
            <input class="aim-input aic-mono" value={cwd()} onInput={(e) => setCwd(e.currentTarget.value)} spellcheck={false} />
          </Field>
          <Field label={S.env} hint={S.envHint}>
            <textarea value={env()} onInput={(e) => setEnv(e.currentTarget.value)} spellcheck={false} />
          </Field>
          <div class="aic-field">
            <span>{S.secretEnv}</span>
            <span class="aim-muted aim-small">{S.secretEnvHint}</span>
            <For each={secretEnv()}>
              {(x, i) => (
                <div class="aic-pair">
                  <input class="aim-input aic-mono" aria-label={S.secretEnvName} placeholder={S.secretEnvName} value={x.name} disabled={x.saved}
                    onInput={(e) => setSecretAt(i(), { name: e.currentTarget.value })} />
                  <div class="aim-actions">
                    <input class="aim-input" type="password" autocomplete="off" aria-label={S.secretEnvValue}
                      placeholder={x.saved ? S.fmt("secretEnvSaved", x.name) : S.secretEnvValue} value={x.value}
                      onInput={(e) => setSecretAt(i(), { value: e.currentTarget.value })} />
                    <button type="button" class="aim-btn" onClick={() => setSecretEnv((l) => l.filter((_, j) => j !== i()))}>{S.remove}</button>
                  </div>
                </div>
              )}
            </For>
            <div>
              <button type="button" class="aim-btn" onClick={() => setSecretEnv((l) => [...l, { name: "", value: "", saved: false }])}>+</button>
            </div>
          </div>
        </Show>
        <Field label={S.timeout}>
          <input class="aim-input" type="number" min="5" max="300" value={timeout()} onInput={(e) => setTimeoutS(e.currentTarget.value)} />
        </Field>
        <Show when={failure()}>
          <p class="aic-error" role="alert">{failure()}</p>
        </Show>
        <div class="aim-actions aic-end">
          <button type="button" class="aim-btn" onClick={props.onClose}>{S.cancel}</button>
          <button type="submit" class="aim-btn aim-btn-primary" disabled={busy()}>{S.save}</button>
        </div>
      </form>
    </Frame>
  );
}

function RunToolDialog(props) {
  const [args, setArgs] = createSignal("{}");
  const [out, setOut] = createSignal(null);
  const [busy, setBusy] = createSignal(false);
  async function run(e) {
    e.preventDefault();
    let parsed;
    try {
      parsed = JSON.parse(args() || "{}");
    } catch {
      setOut({ error: S.argsBad });
      return;
    }
    setBusy(true);
    setOut(null);
    try {
      const r = await callTool(props.server.id, props.tool.name, parsed);
      setOut({ text: resultText(r), isError: !!(r && r.isError) });
    } catch (err) {
      setOut({ error: errorText(err) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Frame title={props.tool.name} wide onClose={props.onClose}>
      <form class="aic-form aic-scope" onSubmit={run}>
        <Show when={props.tool.description}>
          <p class="aic-muted">{props.tool.description}</p>
        </Show>
        <Show when={props.tool.inputSchema}>
          <pre class="aic-pre">{JSON.stringify(props.tool.inputSchema, null, 2)}</pre>
        </Show>
        <Field label={S.argsJson}>
          <textarea value={args()} onInput={(e) => setArgs(e.currentTarget.value)} spellcheck={false} />
        </Field>
        <Show when={out()}>
          <Show when={out().error} fallback={<><span class="aic-h3">{S.result}</span><Show when={out().isError}><p class="aic-warn">{S.toolError}</p></Show><pre class="aic-pre">{out().text}</pre></>}>
            <p class="aic-error" role="alert">{out().error}</p>
          </Show>
        </Show>
        <div class="aim-actions aic-end">
          <button type="button" class="aim-btn" onClick={props.onClose}>{S.close}</button>
          <button type="submit" class="aim-btn aim-btn-primary" disabled={busy()}>{S.run}</button>
        </div>
      </form>
    </Frame>
  );
}

function ServerDetail(props) {
  const rt = () => state.runtime[props.server.id] || {};
  const found = () => rt().found;
  const list = (key, render) => (
    <div class="aic-detail">
      <h3 class="aic-h3">{S[key]}</h3>
      <Show when={!(found().errors && found().errors[key])} fallback={<p class="aim-muted">{S.listFailed}</p>}>
        <Show when={found()[key].length} fallback={<p class="aim-muted">{S.nothing}</p>}>
          <ul class="aic-items"><For each={found()[key]}>{render}</For></ul>
        </Show>
      </Show>
    </div>
  );
  return (
    <Show when={found()}>
      <Show when={rt().info}>
        <span class="aim-muted aim-small">{S.fmt("serverInfo", rt().info.name, rt().info.version, rt().info.protocol)} · {S.fmt("checked", when(rt().checkedAt))}</span>
      </Show>
      {list("tools", (t) => (
        <li class="aic-item">
          <div class="aic-item-main">
            <span class="aic-mono">{t.name}</span>
            <Show when={t.description}><span class="aim-muted aim-small">{t.description}</span></Show>
            <span class="aim-badges">
              <Show when={t.readOnly}><Badge kind="ok">{S.readOnly}</Badge></Show>
              <Show when={t.destructive}><Badge kind="fit-tight">{S.destructive}</Badge></Show>
            </span>
          </div>
          <button type="button" class="aim-btn" disabled={!props.server.enabled || !props.usable} onClick={() => props.onRun(t)}>{S.tryTool}</button>
        </li>
      ))}
      {list("resources", (r) => (
        <li class="aic-item">
          <div class="aic-item-main">
            <span>{r.name}</span>
            <span class="aic-mono aim-muted">{r.uri}{r.mimeType ? " · " + r.mimeType : ""}</span>
          </div>
        </li>
      ))}
      {list("prompts", (p) => (
        <li class="aic-item">
          <div class="aic-item-main">
            <span class="aic-mono">{p.name}</span>
            <Show when={p.description}><span class="aim-muted aim-small">{p.description}</span></Show>
          </div>
        </li>
      ))}
    </Show>
  );
}

function ServersSection(props) {
  const [editing, setEditing] = createSignal(null);
  const [running, setRunning] = createSignal(null);
  const [open, setOpen] = createSignal({});
  const rt = (id) => state.runtime[id] || {};
  const blocked = (s) => !props.usable || (s.transport !== "stdio" && !policy().external);
  const status = (s) => (!s.enabled ? "disabled" : rt(s.id).status || "unknown");

  return (
    <>
      <Section
        id="aic-servers"
        title={S.servers}
        text={S.serversText}
        aside={<button type="button" class="aim-btn" disabled={!props.usable} onClick={() => setEditing({})}>{S.addServer}</button>}
      >
        <Show when={state.servers.length} fallback={<p class="aim-empty">{S.noServers}</p>}>
          <ul class="aim-list">
            <For each={state.servers}>
              {(s) => (
                <li class="aim-row">
                  <div class="aim-row-main">
                    <span class="aim-row-title">{s.name}</span>
                    <span class="aim-badges">
                      <Badge kind="lock">{s.transport === "stdio" ? S.transport_stdio : S["transport_streamable-http"]}</Badge>
                      <Badge kind="lock">{s.transport === "stdio" ? S.local : S[locationOf(s.url)]}</Badge>
                      <StatusBadge status={status(s)} />
                      <Show when={rt(s.id).found}>
                        <Badge kind="lock">{rt(s.id).found.tools.length + " " + S.tools.toLowerCase()}</Badge>
                      </Show>
                    </span>
                    <span class="aim-muted aim-small aic-mono">{s.transport === "stdio" ? joinArgs([s.command, ...s.args]) : s.url}</span>
                    <Show when={rt(s.id).error}>
                      <p class="aic-error" role="alert">{errorText(rt(s.id).error)}</p>
                    </Show>
                  </div>
                  <div class="aim-actions">
                    <input type="checkbox" role="switch" class="aim-switch" aria-label={S.enabled} checked={s.enabled} disabled={blocked(s)}
                      onChange={(e) => setServerEnabled(s.id, e.currentTarget.checked)} />
                    <button type="button" class="aim-btn" disabled={!rt(s.id).found} onClick={() => setOpen((o) => ({ ...o, [s.id]: !o[s.id] }))}>{S.tools}</button>
                    <button type="button" class="aim-btn" disabled={blocked(s) || !s.enabled || rt(s.id).status === "testing"} onClick={() => testServer(s.id)}>
                      {rt(s.id).status === "testing" ? S.testing : S.test}
                    </button>
                    <button type="button" class="aim-btn" disabled={!props.usable} onClick={() => setEditing(s)}>{S.edit}</button>
                    <button type="button" class="aim-btn" disabled={!props.usable} onClick={() => window.confirm(S.fmt("removeConfirm", s.name)) && removeServer(s.id)}>{S.remove}</button>
                  </div>
                  <Show when={open()[s.id]}>
                    <div class="aic-detail">
                      <ServerDetail server={s} usable={!blocked(s)} onRun={(t) => setRunning({ server: s, tool: t })} />
                    </div>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Section>
      <Show when={editing()}>
        <ServerDialog server={editing().id ? editing() : null} onClose={() => setEditing(null)} />
      </Show>
      <Show when={running()}>
        <RunToolDialog server={running().server} tool={running().tool} onClose={() => setRunning(null)} />
      </Show>
    </>
  );
}

/* ---- permissions and log ------------------------------------------------ */

function PermissionsSection() {
  const rows = () => permissionList(state.perms, state.servers);
  return (
    <Section
      id="aic-perms"
      title={S.permissions}
      text={S.permissionsText}
      aside={<Show when={rows().length}><button type="button" class="aim-btn" onClick={revokeAll}>{S.revokeAll}</button></Show>}
    >
      <Show when={rows().length} fallback={<p class="aim-empty">{S.noPermissions}</p>}>
        <ul class="aim-list">
          <For each={rows()}>
            {(r) => (
              <li class="aim-row">
                <div class="aim-row-main">
                  <span class="aic-mono">{r.tool}</span>
                  <span class="aim-muted aim-small">{r.server}</span>
                </div>
                <button type="button" class="aim-btn" onClick={() => revokePermission(r.serverId, r.tool)}>{S.revoke}</button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </Section>
  );
}

function LogSection() {
  const [copied, setCopied] = createSignal(false);
  const text = () => state.log.map((e) => `${new Date(e.t).toISOString()} [${e.server}] ${e.kind}: ${e.text}`).join("\n");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <Section
      id="aic-log"
      title={S.log}
      text={S.logText}
      aside={
        <div class="aim-actions">
          <Show when={copied()}><span class="aim-muted aim-small" role="status">{S.copied}</span></Show>
          <button type="button" class="aim-btn" disabled={!state.log.length} onClick={copy}>{S.copyLog}</button>
          <button type="button" class="aim-btn" disabled={!state.log.length} onClick={clearLog}>{S.clearLog}</button>
        </div>
      }
    >
      <Show when={state.log.length} fallback={<p class="aim-empty">{S.logEmpty}</p>}>
        <ul class="aic-log" aria-live="polite">
          <For each={[...state.log].reverse()}>
            {(e) => (
              <li>
                <span class="aic-log-time">{new Date(e.t).toLocaleTimeString()}</span>
                <span classList={{ ["aic-log-kind-" + e.kind]: true }}>{e.server ? e.server + " · " + e.kind : e.kind}</span>
                <span class="aic-log-text aic-mono">{e.text}</span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </Section>
  );
}

export default function ConnectorsPage() {
  const pol = policy();
  onMount(() => {
    checkStore().catch(() => {});
  });
  const desktop = () => nativeAvailable() && state.nativeOk !== false;
  const usable = () => desktop() && pol.ai;
  return (
    <div class="aim-page aic-scope">
      <p class="aim-intro aim-muted">{S.intro}</p>
      <Show when={!desktop()}><p class="aim-banner">{S.noDesktop}</p></Show>
      <Show when={!pol.ai}><p class="aim-banner">{S.aiOff}</p></Show>
      <Show when={pol.ai && !pol.external}><p class="aim-banner">{S.externalOff}</p></Show>
      <Show when={state.store === "file"}><p class="aic-warn">{S.storeFile}</p></Show>
      <ProvidersSection usable={usable() && pol.external} />
      <ServersSection usable={usable()} />
      <PermissionsSection />
      <LogSection />
    </div>
  );
}
