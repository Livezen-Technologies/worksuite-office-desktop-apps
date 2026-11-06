/*
 * Settings › AI & MCP Connectors: state, MCP sessions and the permission gate, shared by the page
 * (ConnectorsPage.jsx) and the confirmation dialog (ConfirmHost.jsx, always mounted in the shell).
 *
 * window.WorkSuiteMcp, for AI agents in the start page:
 *   servers()                         enabled servers with their discovered tools
 *   callTool(serverId, tool, args, {agent})   → the tools/call result; asks the person first unless they
 *                                       chose "Always allow this tool for this server"; rejects with
 *                                       {code:"denied"} when they say no
 *   confirm("modify-document"|"read-file", {agent, target}) → true | false, asked every time
 */
import { createStore, produce } from "solid-js/store";
import { createNative } from "./native.js";
import { McpError, McpSession, httpTransport, stdioTransport } from "./mcp-client.js";
import {
  LS, allowAlways, appendLog, availableModels, isAlwaysAllowed, modelsRequest, normalizeProvider, normalizeServer,
  parseModels, publishToEditors, revoke, secretKey, summarizeDiscovery, transportSpec,
} from "./logic.js";

function readLS(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function writeLS(key, value) {
  try {
    if (value === undefined || value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked: lasts for this session */
  }
}

/* ADM-01 (worksuite/ai.js): AI off, or only WorkSuite AI allowed */
export function policy() {
  const p = (typeof window !== "undefined" && window.WorkSuitePolicy) || {};
  const val = (v) => (typeof v === "function" ? v() !== false : v !== false);
  const ai = val(p.allowAi);
  return { ai, external: ai && val(p.allowExternalAi) };
}

let native = null;
const sessions = new Map();

const [state, setState] = createStore({
  servers: readLS(LS.servers, []).map(normalizeServer),
  providers: readLS(LS.providers, []).map(normalizeProvider),
  def: readLS(LS.def, null),
  perms: readLS(LS.permissions, {}),
  log: readLS(LS.log, []),
  runtime: {},
  providerRuntime: {},
  store: null,
  nativeOk: null,
  pending: null,
});
export { state };

export function nativeAvailable() {
  if (!native) native = createNative();
  return !!native;
}

function persistServers() {
  writeLS(LS.servers, state.servers.map((s) => ({ ...s })));
}
function persistProviders() {
  writeLS(LS.providers, state.providers.map((p) => ({ ...p, models: [...p.models] })));
}

export function log(server, kind, text) {
  setState("log", (l) => appendLog(l, { server, kind, text }));
  writeLS(LS.log, state.log);
}
export function clearLog() {
  setState("log", []);
  writeLS(LS.log, []);
}

function setRuntime(id, patch) {
  setState("runtime", id, (r) => ({ ...r, ...patch }));
}

/* ---- secrets: written and removed, never read back (cworksuitemcp.h) ---- */

async function secretSet(key, value) {
  const r = await native.call({ op: "secret-set", key, value });
  if (r.store) setState("store", r.store);
  if (!r.ok) throw new McpError("secret-store", r.detail || r.error || "");
}
async function secretDelete(key) {
  if (native) await native.call({ op: "secret-delete", key });
}

/* whether this desktop build answers "ws-mcp" at all (the macOS app does not yet) */
export async function checkStore() {
  if (!nativeAvailable()) return setState("nativeOk", false);
  const r = await native.call({ op: "secret-has", key: "ai:probe" }, 1500);
  setState("nativeOk", r.error !== "timeout");
  if (r.store) setState("store", r.store);
}

/* ---- MCP servers ------------------------------------------------------ */

async function closeSession(id) {
  const s = sessions.get(id);
  sessions.delete(id);
  if (s) await s.close().catch(() => {});
}

/*
 * secrets: {auth?: string, env?: {NAME: value}, removeAuth?: bool, removeEnv?: [NAME]}; empty values keep
 * what is saved.
 */
export async function saveServer(raw, secrets) {
  if (!nativeAvailable()) throw new McpError("no-desktop");
  const s = normalizeServer(raw);
  const sec = secrets || {};
  if (sec.auth) {
    await secretSet(secretKey.serverAuth(s.id), sec.auth);
    s.hasSecret = true;
  } else if (sec.removeAuth || s.auth.type === "none") {
    await secretDelete(secretKey.serverAuth(s.id));
    s.hasSecret = false;
  }
  for (const [name, value] of Object.entries(sec.env || {})) if (value) await secretSet(secretKey.serverEnv(s.id, name), value);
  for (const name of sec.removeEnv || []) await secretDelete(secretKey.serverEnv(s.id, name));

  await closeSession(s.id);
  const i = state.servers.findIndex((x) => x.id === s.id);
  setState("servers", produce((list) => (i < 0 ? list.push(s) : (list[i] = s))));
  setRuntime(s.id, { status: "unknown", error: null });
  persistServers();
  log(s.name, "info", i < 0 ? "added" : "settings changed");
  return s;
}

export async function removeServer(id) {
  const s = state.servers.find((x) => x.id === id);
  if (!s) return;
  await closeSession(id);
  await secretDelete(secretKey.serverAuth(id));
  for (const name of s.secretEnv) await secretDelete(secretKey.serverEnv(id, name));
  setState("servers", (l) => l.filter((x) => x.id !== id));
  setState("perms", (p) => revoke(p, id));
  writeLS(LS.permissions, state.perms);
  persistServers();
  log(s.name, "info", "removed");
}

export async function setServerEnabled(id, enabled) {
  const i = state.servers.findIndex((x) => x.id === id);
  if (i < 0) return;
  if (!enabled) await closeSession(id);
  setState("servers", i, "enabled", enabled);
  persistServers();
  log(state.servers[i].name, "info", enabled ? "enabled" : "disabled");
}

async function sessionFor(id) {
  const existing = sessions.get(id);
  if (existing && !existing.closedWith) return existing;
  const s = state.servers.find((x) => x.id === id);
  if (!s) throw new McpError("bad-config", "no such server");
  if (!nativeAvailable()) throw new McpError("no-desktop");
  if (s.transport !== "stdio" && !policy().external) throw new McpError("forbidden", "policy");
  const onLog = (kind, text) => log(s.name, kind, text);
  const spec = transportSpec(s);
  const t = s.transport === "stdio" ? stdioTransport(native, spec, onLog) : httpTransport(native, spec, onLog);
  const session = new McpSession(t, {
    timeoutMs: s.timeoutMs,
    onLog,
    onClose: (e) => {
      if (sessions.get(id) === session) sessions.delete(id);
      if (e && e.code === "exited") setRuntime(id, { status: "error", error: { code: e.code, detail: e.detail } });
    },
  });
  sessions.set(id, session);
  try {
    await session.connect();
  } catch (e) {
    sessions.delete(id);
    await session.close().catch(() => {});
    throw e;
  }
  return session;
}

export async function testServer(id) {
  const s = state.servers.find((x) => x.id === id);
  if (!s) return;
  setRuntime(id, { status: "testing", error: null });
  log(s.name, "info", "testing connection");
  await closeSession(id);
  try {
    const session = await sessionFor(id);
    const found = summarizeDiscovery(await session.discover());
    const info = session.server || {};
    setRuntime(id, {
      status: "ok",
      checkedAt: Date.now(),
      info: { name: (info.serverInfo && info.serverInfo.name) || "", version: (info.serverInfo && info.serverInfo.version) || "", protocol: info.protocolVersion },
      found,
      error: null,
    });
    log(s.name, "info", `found ${found.tools.length} tools, ${found.resources.length} resources, ${found.prompts.length} prompts`);
  } catch (e) {
    setRuntime(id, { status: "error", checkedAt: Date.now(), error: { code: e.code || "rpc", detail: e.detail || e.message } });
    log(s.name, "error", e.message);
  }
}

/* ---- the permission gate ------------------------------------------------ */

/* req: {kind:"tool"|"modify-document"|"read-file", agent, server, serverId, tool, args, destructive, target} */
export function confirm(req) {
  return new Promise((resolve) => {
    const prev = state.pending;
    if (prev) prev.resolve(false);
    setState("pending", { ...req, resolve });
  });
}

export function answer(allowed, always) {
  const p = state.pending;
  if (!p) return;
  setState("pending", null);
  if (allowed && always && p.kind === "tool") {
    setState("perms", (x) => allowAlways(x, p.serverId, p.tool));
    writeLS(LS.permissions, state.perms);
  }
  p.resolve(!!allowed);
}

export function revokePermission(serverId, tool) {
  setState("perms", (x) => revoke(x, serverId, tool));
  writeLS(LS.permissions, state.perms);
}
export function revokeAll() {
  setState("perms", {});
  writeLS(LS.permissions, {});
}

export async function callTool(serverId, tool, args, opts) {
  const s = state.servers.find((x) => x.id === serverId);
  if (!s || !s.enabled) throw new McpError("bad-config", "server not enabled");
  if (!policy().ai) throw new McpError("forbidden", "policy");
  const found = state.runtime[serverId] && state.runtime[serverId].found;
  const def = found && found.tools.find((t) => t.name === tool);
  const agent = (opts && opts.agent) || "";
  if (!isAlwaysAllowed(state.perms, serverId, tool)) {
    const ok = await confirm({ kind: "tool", agent, server: s.name, serverId, tool, args, destructive: !!(def && def.destructive) });
    if (!ok) {
      log(s.name, "denied", tool + (agent ? " (" + agent + ")" : ""));
      throw new McpError("denied", tool);
    }
  }
  log(s.name, "call", tool + (agent ? " by " + agent : ""));
  const session = await sessionFor(serverId);
  try {
    const result = await session.callTool(tool, args, s.timeoutMs);
    log(s.name, result && result.isError ? "error" : "result", tool + (result && result.isError ? ": tool error" : ": done"));
    return result;
  } catch (e) {
    log(s.name, "error", tool + ": " + e.message);
    throw e;
  }
}

/* ---- AI providers ------------------------------------------------------- */

const keysThisSession = {};

function publish() {
  const providers = policy().external ? state.providers : [];
  const before = readLS(LS.published, []);
  const r = publishToEditors(readLS("providers", []), providers, before, keysThisSession);
  writeLS("providers", r.list);
  writeLS(LS.published, r.published);
  // the editors' current provider was ours and is gone: no current provider, the editors pick again
  const cur = readLS("current-provider", null);
  if (cur && before.includes(cur.name) && !r.published.includes(cur.name)) {
    writeLS("current-provider", undefined);
    writeLS("current-model", undefined);
  }
}

export async function saveProvider(raw, key, removeKey) {
  if (!nativeAvailable()) throw new McpError("no-desktop");
  const p = normalizeProvider(raw);
  if (key) {
    await secretSet(secretKey.providerAuth(p.id), key);
    keysThisSession[p.id] = key;
    p.hasSecret = true;
  } else if (removeKey || p.auth.type === "none") {
    await secretDelete(secretKey.providerAuth(p.id));
    delete keysThisSession[p.id];
    p.hasSecret = false;
  }
  const i = state.providers.findIndex((x) => x.id === p.id);
  setState("providers", produce((list) => (i < 0 ? list.push(p) : (list[i] = p))));
  persistProviders();
  publish();
  return p;
}

export async function removeProvider(id) {
  await secretDelete(secretKey.providerAuth(id));
  delete keysThisSession[id];
  setState("providers", (l) => l.filter((x) => x.id !== id));
  if (state.def && state.def.providerId === id) setDefault(null);
  persistProviders();
  publish();
}

export async function testProvider(id) {
  const p = state.providers.find((x) => x.id === id);
  if (!p || !nativeAvailable()) return;
  setState("providerRuntime", id, { status: "testing", error: null });
  const req = modelsRequest(p);
  const r = await native.call({ op: "http", method: req.method, url: req.url, headers: { Accept: "application/json" }, auth: req.auth, timeoutMs: 15000 }, 15000);
  let error = null;
  let models = null;
  if (!r.ok) {
    const code = !r.status ? r.error || "network" : r.status === 401 ? "auth" : r.status === 403 ? "forbidden" : r.status === 404 ? "http-404" : "http";
    error = { code, detail: r.detail || (r.status ? "HTTP " + r.status : "") };
    // an endpoint without /models still works with the models typed in
    if (r.status === 404 && p.manualModels.length) error = null;
  } else {
    models = parseModels(p.kind, r.body);
    if (!models) error = { code: "models", detail: "" };
  }
  const i = state.providers.findIndex((x) => x.id === id);
  if (models && i >= 0) {
    setState("providers", i, "models", models);
    persistProviders();
  }
  setState("providerRuntime", id, { status: error ? "error" : "ok", error, checkedAt: Date.now() });
}

/* the default for the Office AI features: the editors' "current-provider"/"current-model" (worksuite/ai.js) */
export function setDefault(def) {
  setState("def", def);
  writeLS(LS.def, def);
  if (!def) return;
  const p = state.providers.find((x) => x.id === def.providerId);
  if (!p || !p.useInEditors || !policy().external) return;
  publish();
  const entry = readLS("providers", []).find((e) => e && e.name === p.name);
  if (!entry) return;
  writeLS("current-provider", entry);
  writeLS("current-model", { id: def.model, name: def.model, provider: "openaicompatible" });
}

export function modelsOf(id) {
  const p = state.providers.find((x) => x.id === id);
  return p ? availableModels(p) : [];
}

/* ---- the agent API ------------------------------------------------------ */

export function installAgentApi() {
  if (typeof window === "undefined" || window.WorkSuiteMcp) return;
  window.WorkSuiteMcp = {
    servers: () =>
      state.servers.filter((s) => s.enabled).map((s) => ({ id: s.id, name: s.name, tools: ((state.runtime[s.id] && state.runtime[s.id].found) || { tools: [] }).tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) })),
    discover: (id) => testServer(id).then(() => state.runtime[id]),
    callTool,
    confirm: (kind, detail) => (kind === "modify-document" || kind === "read-file" ? confirm({ kind, agent: (detail && detail.agent) || "", target: (detail && detail.target) || "" }) : Promise.resolve(false)),
  };
}
