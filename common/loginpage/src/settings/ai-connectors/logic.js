/*
 * Settings › AI & MCP Connectors: the page's rules, free of Solid and of the network so node:test can
 * run them (logic.test.mjs). What is kept where:
 *   localStorage "ws:ai:mcp:servers"     MCP servers, no secrets (hasSecret says one is in the OS store)
 *   localStorage "ws:ai:providers"       AI providers, no secrets
 *   localStorage "ws:ai:default"         {providerId, model}
 *   localStorage "ws:ai:mcp:permissions" {serverId: {tool: "always"}}
 *   localStorage "ws:ai:mcp:log"         the activity log (last LOG_MAX entries)
 *   OS secret store (ws-mcp secret-set)  "ai:mcp:<id>:auth", "ai:mcp:<id>:env:<NAME>", "ai:provider:<id>:auth"
 */

export const LS = {
  servers: "ws:ai:mcp:servers",
  providers: "ws:ai:providers",
  def: "ws:ai:default",
  permissions: "ws:ai:mcp:permissions",
  log: "ws:ai:mcp:log",
  published: "ws:ai:connectors:published",
};
export const LOG_MAX = 200;
export const TRANSPORTS = ["stdio", "streamable-http"];
export const AUTH_TYPES = ["none", "bearer", "header", "oauth"];
export const PROVIDER_KINDS = ["openai", "ollama", "custom"];
export const OLLAMA_URL = "http://127.0.0.1:11434";

export function newId(prefix) {
  return prefix + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ---- secret keys (validated again natively: ^ai:[A-Za-z0-9_.:-]{1,180}$) ---- */

export const secretKey = {
  serverAuth: (id) => "ai:mcp:" + id + ":auth",
  serverEnv: (id, name) => "ai:mcp:" + id + ":env:" + name,
  providerAuth: (id) => "ai:provider:" + id + ":auth",
};

/* ---- addresses -------------------------------------------------------- */

export function parseUrl(text) {
  try {
    const u = new URL(String(text || "").trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.username || u.password) return null;
    return u;
  } catch {
    return null;
  }
}

export function isLoopback(url) {
  const u = typeof url === "string" ? parseUrl(url) : url;
  if (!u) return false;
  const h = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h === "::1" || /^127\.\d+\.\d+\.\d+$/.test(h);
}

/* a key may go to https anywhere, or to this computer (cworksuitemcp.cpp refuses the rest too) */
export function secretAllowed(url) {
  const u = typeof url === "string" ? parseUrl(url) : url;
  return !!u && (u.protocol === "https:" || isLoopback(u));
}

export function locationOf(url) {
  return isLoopback(url) ? "local" : "cloud";
}

/* ---- command lines ------------------------------------------------------ */

/* "npx -y @scope/server --dir \"My Files\"" → ["npx","-y","@scope/server","--dir","My Files"] */
export function splitArgs(text) {
  const out = [];
  let cur = "";
  let quote = "";
  let any = false;
  for (const ch of String(text || "")) {
    if (quote) {
      if (ch === quote) quote = "";
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      any = true;
    } else if (/\s/.test(ch)) {
      if (cur || any) out.push(cur);
      cur = "";
      any = false;
    } else {
      cur += ch;
    }
  }
  if (cur || any) out.push(cur);
  return out;
}

export function joinArgs(args) {
  return (args || []).map((a) => (a === "" || /[\s"']/.test(a) ? '"' + a.replace(/"/g, "'") + '"' : a)).join(" ");
}

/* "KEY=value" lines → {KEY: value}; bad lines are reported */
export function parseEnv(text) {
  const env = {};
  const bad = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.charAt(0) === "#") continue;
    const i = line.indexOf("=");
    const name = i < 0 ? line : line.slice(0, i).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)) bad.push(line);
    else env[name] = i < 0 ? "" : line.slice(i + 1);
  }
  return { env, bad };
}

export function formatEnv(env) {
  return Object.entries(env || {}).map(([k, v]) => k + "=" + v).join("\n");
}

/* ---- MCP servers ------------------------------------------------------ */

export function normalizeServer(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const auth = r.auth && typeof r.auth === "object" ? r.auth : {};
  return {
    id: typeof r.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(r.id) ? r.id : newId("mcp"),
    name: String(r.name || "").trim(),
    enabled: r.enabled !== false,
    transport: TRANSPORTS.includes(r.transport) ? r.transport : "stdio",
    command: String(r.command || "").trim(),
    args: Array.isArray(r.args) ? r.args.map(String) : [],
    env: r.env && typeof r.env === "object" ? { ...r.env } : {},
    secretEnv: Array.isArray(r.secretEnv) ? r.secretEnv.filter((n) => /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(n)) : [],
    cwd: String(r.cwd || ""),
    url: String(r.url || "").trim(),
    auth: { type: AUTH_TYPES.includes(auth.type) ? auth.type : "none", header: String(auth.header || "").trim() },
    hasSecret: !!r.hasSecret,
    timeoutMs: Math.min(300000, Math.max(5000, Number(r.timeoutMs) || 60000)),
  };
}

/* → [field, problem] pairs; empty when it can be saved */
export function validateServer(s, others) {
  const errors = [];
  if (!s.name) errors.push(["name", "required"]);
  else if ((others || []).some((o) => o.id !== s.id && o.name.toLowerCase() === s.name.toLowerCase())) errors.push(["name", "duplicate"]);
  if (s.transport === "stdio") {
    if (!s.command) errors.push(["command", "required"]);
  } else {
    const u = parseUrl(s.url);
    if (!u) errors.push(["url", "invalid"]);
    else if (s.auth.type !== "none" && !secretAllowed(u)) errors.push(["url", "insecure"]);
    if (s.auth.type === "header" && !/^[A-Za-z0-9-]{1,64}$/.test(s.auth.header)) errors.push(["header", "invalid"]);
    if (s.auth.type === "oauth") errors.push(["auth", "oauth"]);
  }
  return errors;
}

/* what the transports need (mcp-client.js) */
export function transportSpec(s) {
  if (s.transport === "stdio") {
    const secretEnv = {};
    for (const name of s.secretEnv) secretEnv[name] = secretKey.serverEnv(s.id, name);
    return { id: s.id, command: s.command, args: s.args, env: s.env, secretEnv, cwd: s.cwd };
  }
  return { url: s.url, auth: authSpec(s.auth, secretKey.serverAuth(s.id)), timeoutMs: s.timeoutMs };
}

export function authSpec(auth, key) {
  if (!auth || auth.type === "none" || auth.type === "oauth") return undefined;
  if (auth.type === "bearer") return { secret: key, header: "Authorization", prefix: "Bearer " };
  return { secret: key, header: auth.header, prefix: "" };
}

/* discovered tools/resources/prompts, trimmed to what the page shows and keeps */
export function summarizeDiscovery(found) {
  const f = found || {};
  const pick = (list, map) => (Array.isArray(list) ? list.slice(0, 500).map(map) : []);
  return {
    tools: pick(f.tools, (t) => ({ name: String(t.name || ""), title: String(t.title || (t.annotations && t.annotations.title) || ""), description: String(t.description || "").slice(0, 500), readOnly: !!(t.annotations && t.annotations.readOnlyHint), destructive: !!(t.annotations && t.annotations.destructiveHint), inputSchema: t.inputSchema || null })),
    resources: pick(f.resources, (r) => ({ uri: String(r.uri || ""), name: String(r.name || r.title || ""), mimeType: String(r.mimeType || "") })),
    prompts: pick(f.prompts, (p) => ({ name: String(p.name || ""), description: String(p.description || "").slice(0, 300) })),
    errors: f.errors || {},
  };
}

/* ---- AI providers ------------------------------------------------------- */

export function normalizeProvider(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const kind = PROVIDER_KINDS.includes(r.kind) ? r.kind : "openai";
  const auth = r.auth && typeof r.auth === "object" ? r.auth : {};
  const baseUrl = String(r.baseUrl || (kind === "ollama" ? OLLAMA_URL : "")).trim().replace(/\/+$/, "");
  const authType = kind === "ollama" ? "none" : ["none", "bearer", "header"].includes(auth.type) ? auth.type : "bearer";
  return {
    id: typeof r.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(r.id) ? r.id : newId("prov"),
    name: String(r.name || "").trim(),
    kind,
    baseUrl,
    auth: { type: authType, header: String(auth.header || "").trim() },
    hasSecret: !!r.hasSecret,
    models: Array.isArray(r.models) ? r.models.map(String).filter(Boolean) : [],
    manualModels: Array.isArray(r.manualModels) ? r.manualModels.map(String).filter(Boolean) : [],
    useInEditors: !!r.useInEditors,
  };
}

export function validateProvider(p, others) {
  const errors = [];
  if (!p.name) errors.push(["name", "required"]);
  else if ((others || []).some((o) => o.id !== p.id && o.name.toLowerCase() === p.name.toLowerCase())) errors.push(["name", "duplicate"]);
  const u = parseUrl(p.baseUrl);
  if (!u) errors.push(["baseUrl", "invalid"]);
  else if (p.auth.type !== "none" && !secretAllowed(u)) errors.push(["baseUrl", "insecure"]);
  if (p.auth.type === "header" && !/^[A-Za-z0-9-]{1,64}$/.test(p.auth.header)) errors.push(["header", "invalid"]);
  return errors;
}

/* the request that lists a provider's models */
export function modelsRequest(p) {
  if (p.kind === "ollama") return { method: "GET", url: p.baseUrl + "/api/tags" };
  return { method: "GET", url: p.baseUrl + "/models", auth: authSpec(p.auth, secretKey.providerAuth(p.id)) };
}

/* GET /api/tags ({models:[{name}]}) or GET /models ({data:[{id}]}) → ids */
export function parseModels(kind, body) {
  let j;
  try { j = typeof body === "string" ? JSON.parse(body) : body; } catch { return null; }
  if (!j || typeof j !== "object") return null;
  const list = kind === "ollama" ? j.models : Array.isArray(j.data) ? j.data : j.models;
  if (!Array.isArray(list)) return null;
  return [...new Set(list.map((m) => (typeof m === "string" ? m : m && (m.id || m.name || m.model))).filter(Boolean).map(String))].sort();
}

export function availableModels(p) {
  return [...new Set([...(p.models || []), ...(p.manualModels || [])])];
}

/* the base URL the editors' AI functions use: OpenAI-compatible (Ollama's is at /v1) */
export function editorBaseUrl(p) {
  return p.kind === "ollama" ? p.baseUrl + "/v1" : p.baseUrl;
}

/*
 * The editors' AI functions read "providers" (worksuite/ai.js): this puts ours in, replacing what we put
 * there earlier (published: the names we own), and leaves every other entry alone.
 * keys: {providerId: key} typed in this session; an entry keeps its earlier key otherwise.
 */
export function publishToEditors(list, providers, published, keys) {
  const mine = new Set(published || []);
  const current = Array.isArray(list) ? list : [];
  const before = new Map(current.filter((e) => e && mine.has(e.name)).map((e) => [e.name, e]));
  const rest = current.filter((e) => !(e && mine.has(e.name)));
  const taken = new Set(rest.map((e) => e && e.name));
  const ours = [];
  for (const p of providers) {
    if (!p.useInEditors || taken.has(p.name)) continue;
    const old = before.get(p.name);
    const key = p.auth.type === "none" ? "" : (keys && keys[p.id]) || (old && old.key) || "";
    ours.push({ type: "openaicompatible", name: p.name, baseUrl: editorBaseUrl(p), key });
  }
  return { list: rest.concat(ours), published: ours.map((e) => e.name) };
}

/* ---- permissions ------------------------------------------------------ */

export function isAlwaysAllowed(perms, serverId, tool) {
  return !!(perms && perms[serverId] && perms[serverId][tool] === "always");
}

export function allowAlways(perms, serverId, tool) {
  const p = { ...perms };
  p[serverId] = { ...p[serverId], [tool]: "always" };
  return p;
}

export function revoke(perms, serverId, tool) {
  const p = { ...perms };
  if (!p[serverId]) return p;
  if (tool === undefined) {
    delete p[serverId];
    return p;
  }
  const s = { ...p[serverId] };
  delete s[tool];
  if (Object.keys(s).length) p[serverId] = s;
  else delete p[serverId];
  return p;
}

export function permissionList(perms, servers) {
  const names = new Map((servers || []).map((s) => [s.id, s.name]));
  const out = [];
  for (const [serverId, tools] of Object.entries(perms || {})) {
    for (const tool of Object.keys(tools || {})) out.push({ serverId, server: names.get(serverId) || serverId, tool });
  }
  return out.sort((a, b) => (a.server + a.tool).localeCompare(b.server + b.tool));
}

/* ---- activity log ------------------------------------------------------- */

export function appendLog(log, entry, max) {
  const e = { t: entry.t || Date.now(), server: String(entry.server || ""), kind: String(entry.kind || "info"), text: String(entry.text || "").slice(0, 500) };
  const next = (Array.isArray(log) ? log : []).concat([e]);
  const cap = max || LOG_MAX;
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/* tool arguments shown in the confirmation, shortened */
export function previewArgs(args, max) {
  let s;
  try { s = JSON.stringify(args === undefined ? {} : args, null, 2); } catch { s = String(args); }
  const cap = max || 2000;
  return s.length > cap ? s.slice(0, cap) + "\n…" : s;
}

/* the text parts of a tools/call result */
export function resultText(result) {
  if (!result || !Array.isArray(result.content)) return result ? previewArgs(result) : "";
  return result.content.map((c) => (c.type === "text" ? c.text : "[" + c.type + (c.mimeType ? " " + c.mimeType : "") + "]")).join("\n");
}
