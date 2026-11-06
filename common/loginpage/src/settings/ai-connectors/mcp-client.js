/*
 * A small MCP client (Model Context Protocol, revision 2025-06-18) for Settings › AI & MCP Connectors.
 * The protocol runs here; the desktop only moves bytes (native.js, win-linux/src/cworksuitemcp.h).
 * Free of Solid and of the page, so node:test runs it against fake transports (mcp-client.test.mjs).
 *
 * Transports:
 *   stdio            a local command; one JSON-RPC message per line on stdin/stdout
 *   streamable-http  POST to one endpoint; the answer is JSON or an SSE stream; Mcp-Session-Id kept
 * (The legacy HTTP+SSE transport needs a long-lived GET stream and is not offered.)
 */

export const PROTOCOL_VERSION = "2025-06-18";
export const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
export const CLIENT_INFO = { name: "WorkSuite Office", version: "1.0" };

export class McpError extends Error {
  /* code: one of the ERROR_CODES below; detail: what the server or the system said */
  constructor(code, detail, extra) {
    super(code + (detail ? ": " + detail : ""));
    this.code = code;
    this.detail = detail || "";
    Object.assign(this, extra || {});
  }
}

export const ERROR_CODES = [
  "no-desktop", "bad-config", "not-found", "spawn-failed", "exited", "timeout", "network", "bad-url",
  "insecure-secret", "secret-store", "auth", "forbidden", "http-404", "http", "not-mcp", "version", "rpc",
];

/* ---- Server-Sent Events (an answer to a POST may come as text/event-stream) ---- */

export function parseSse(text) {
  const events = [];
  let data = [];
  let event = "message";
  const flush = () => {
    if (data.length) events.push({ event, data: data.join("\n") });
    data = [];
    event = "message";
  };
  for (const raw of String(text || "").split(/\r?\n/)) {
    if (raw === "") { flush(); continue; }
    if (raw.charAt(0) === ":") continue;
    const i = raw.indexOf(":");
    const field = i < 0 ? raw : raw.slice(0, i);
    let value = i < 0 ? "" : raw.slice(i + 1);
    if (value.charAt(0) === " ") value = value.slice(1);
    if (field === "data") data.push(value);
    else if (field === "event") event = value;
  }
  flush();
  return events;
}

function jsonMessages(text) {
  let v;
  try { v = JSON.parse(text); } catch { return null; }
  return Array.isArray(v) ? v : [v];
}

/* ---- transports ------------------------------------------------------- */

/*
 * native: createNative() (call/post/on). spec: {id, command, args, env, secretEnv, cwd}.
 * onLog(kind, text) gets stderr and lifecycle lines for the activity log.
 */
export function stdioTransport(native, spec, onLog) {
  let onMessage = () => {};
  let onClose = () => {};
  let off = null;
  let closed = false;
  return {
    kind: "stdio",
    async open(handlers) {
      onMessage = handlers.message;
      onClose = handlers.close;
      off = native.on((m) => {
        if (m.id !== spec.id) return;
        if (m.op === "stdout") {
          const msgs = jsonMessages(m.line);
          if (msgs) msgs.forEach((x) => onMessage(x));
          else if (onLog) onLog("stdout", m.line);
        } else if (m.op === "stderr") {
          if (onLog) onLog("stderr", m.text);
        } else if (m.op === "exit") {
          if (!closed) onClose(new McpError("exited", "code " + m.code + (m.error ? " (" + m.error + ")" : "")));
          closed = true;
          if (off) off();
        }
      });
      const r = await native.call({ op: "spawn", id: spec.id, command: spec.command, args: spec.args || [], env: spec.env || {}, secretEnv: spec.secretEnv || {}, cwd: spec.cwd || "" });
      if (!r.ok) {
        if (off) off();
        closed = true;
        throw new McpError(["not-found", "secret-store", "no-desktop"].includes(r.error) ? r.error : "spawn-failed", r.detail || r.error);
      }
      if (onLog) onLog("info", "started, pid " + r.pid);
    },
    async send(msg) {
      if (closed) throw new McpError("exited");
      native.post({ op: "write", id: spec.id, data: JSON.stringify(msg) });
    },
    async close() {
      if (closed) return;
      closed = true;
      if (off) off();
      native.post({ op: "kill", id: spec.id });
    },
  };
}

/*
 * spec: {url, headers, auth:{secret, header, prefix}, timeoutMs}. Each send() is one POST; the
 * answers it carries (JSON or SSE) are handed to the message handler.
 */
export function httpTransport(native, spec, onLog) {
  let onMessage = () => {};
  let sessionId = "";
  let version = "";
  const headers = () => {
    const h = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...spec.headers };
    if (sessionId) h["Mcp-Session-Id"] = sessionId;
    if (version) h["MCP-Protocol-Version"] = version;
    return h;
  };
  return {
    kind: "streamable-http",
    setProtocolVersion(v) { version = v; },
    get sessionId() { return sessionId; },
    async open(handlers) {
      onMessage = handlers.message;
    },
    async send(msg) {
      const r = await native.call({ op: "http", method: "POST", url: spec.url, headers: headers(), body: JSON.stringify(msg), auth: spec.auth, timeoutMs: spec.timeoutMs || 30000 }, spec.timeoutMs);
      throwForHttp(r, msg);
      const sid = r.headers && r.headers["mcp-session-id"];
      if (sid) sessionId = sid;
      if (r.status === 202 || !r.body) return;
      const type = String((r.headers && r.headers["content-type"]) || "").toLowerCase();
      let msgs = null;
      if (type.includes("text/event-stream")) {
        msgs = [];
        for (const e of parseSse(r.body)) {
          if (e.event !== "message") continue;
          const m = jsonMessages(e.data);
          if (m) msgs.push(...m);
        }
      } else {
        msgs = jsonMessages(r.body);
      }
      if (!msgs) {
        if (msg.id !== undefined) throw new McpError("not-mcp", "the answer is not JSON-RPC (" + (type || "no content type") + ")");
        return;
      }
      msgs.forEach((m) => onMessage(m));
    },
    async close() {
      if (!sessionId) return;
      if (onLog) onLog("info", "ending session");
      await native.call({ op: "http", method: "DELETE", url: spec.url, headers: headers(), auth: spec.auth, timeoutMs: 5000 }, 5000).catch(() => {});
      sessionId = "";
    },
  };
}

function throwForHttp(r, msg) {
  if (r.ok) return;
  if (!r.status) throw new McpError(r.error || "network", r.detail || "");
  const body = String(r.body || "").slice(0, 300);
  if (r.status === 401) throw new McpError("auth", (r.headers && r.headers["www-authenticate"]) || body, { status: 401 });
  if (r.status === 403) throw new McpError("forbidden", body, { status: 403 });
  if (r.status === 404) {
    // a lost session (the client must start again) or the wrong address
    throw new McpError("http-404", body, { status: 404, sessionLost: !!(msg && msg.method !== "initialize") });
  }
  if (r.status === 405 || r.status === 415 || r.status === 406) throw new McpError("not-mcp", "HTTP " + r.status, { status: r.status });
  if (r.status >= 300 && r.status < 400) throw new McpError("http", "redirected to " + ((r.headers && r.headers.location) || "?"), { status: r.status });
  throw new McpError("http", "HTTP " + r.status + (body ? " " + body : ""), { status: r.status });
}

/* ---- the session ------------------------------------------------------ */

/*
 * new McpSession(transport, {timeoutMs, onLog, onNotification}). connect() → the initialize result;
 * discover() → {tools, resources, prompts}; callTool(name, args) → the tools/call result.
 */
export class McpSession {
  constructor(transport, opts) {
    this.t = transport;
    this.o = opts || {};
    this.nextId = 1;
    this.pending = new Map();
    this.server = null;
    this.closedWith = null;
  }

  log(kind, text) {
    if (this.o.onLog) this.o.onLog(kind, text);
  }

  onMessage(m) {
    if (!m || typeof m !== "object") return;
    if (m.id !== undefined && m.id !== null && !m.method && this.pending.has(m.id)) {
      const p = this.pending.get(m.id);
      this.pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.error) p.reject(new McpError("rpc", (m.error.message || "error") + " (" + m.error.code + ")", { rpcCode: m.error.code, data: m.error.data }));
      else p.resolve(m.result);
      return;
    }
    if (m.method && m.id !== undefined) {
      // requests from the server: ping is answered; sampling, roots and elicitation are not offered
      const reply = m.method === "ping" ? { jsonrpc: "2.0", id: m.id, result: {} } : { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "Method not found" } };
      this.t.send(reply).catch(() => {});
      return;
    }
    if (m.method) {
      if (m.method === "notifications/message" && m.params) this.log("server", String(m.params.level || "info") + ": " + JSON.stringify(m.params.data));
      if (this.o.onNotification) this.o.onNotification(m);
    }
  }

  onClose(err) {
    this.closedWith = err || new McpError("exited");
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(this.closedWith);
    }
    this.pending.clear();
    if (this.o.onClose) this.o.onClose(this.closedWith);
  }

  request(method, params, timeoutMs) {
    if (this.closedWith) return Promise.reject(this.closedWith);
    const id = this.nextId++;
    const msg = { jsonrpc: "2.0", id, method };
    if (params !== undefined) msg.params = params;
    return new Promise((resolve, reject) => {
      const ms = timeoutMs || this.o.timeoutMs || 30000;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.t.send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id, reason: "timeout" } }).catch(() => {});
        reject(new McpError("timeout", method));
      }, ms);
      this.pending.set(id, { resolve, reject, timer });
      this.t.send(msg).catch((e) => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        clearTimeout(timer);
        reject(e instanceof McpError ? e : new McpError("network", String(e && e.message)));
      });
    });
  }

  notify(method, params) {
    const msg = { jsonrpc: "2.0", method };
    if (params !== undefined) msg.params = params;
    return this.t.send(msg);
  }

  async connect() {
    await this.t.open({ message: (m) => this.onMessage(m), close: (e) => this.onClose(e) });
    const result = await this.request("initialize", { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO });
    if (!result || typeof result !== "object" || !result.protocolVersion) throw new McpError("not-mcp", "no protocolVersion in the initialize answer");
    if (!SUPPORTED_VERSIONS.includes(result.protocolVersion)) {
      await this.close();
      throw new McpError("version", result.protocolVersion);
    }
    if (this.t.setProtocolVersion) this.t.setProtocolVersion(result.protocolVersion);
    this.server = result;
    await this.notify("notifications/initialized");
    this.log("info", "connected: " + ((result.serverInfo && result.serverInfo.name) || "server") + " " + ((result.serverInfo && result.serverInfo.version) || "") + ", protocol " + result.protocolVersion);
    return result;
  }

  async listAll(method, key) {
    const out = [];
    let cursor;
    for (let page = 0; page < 50; page++) {
      const r = await this.request(method, cursor ? { cursor } : {});
      const items = r && Array.isArray(r[key]) ? r[key] : [];
      out.push(...items);
      cursor = r && r.nextCursor;
      if (!cursor) break;
    }
    return out;
  }

  /* only what the server says it has (capabilities); a list it fails to give is reported, not fatal */
  async discover() {
    const caps = (this.server && this.server.capabilities) || {};
    const out = { tools: [], resources: [], prompts: [], errors: {} };
    const lists = [["tools", "tools/list"], ["resources", "resources/list"], ["prompts", "prompts/list"]];
    for (const [key, method] of lists) {
      if (!caps[key]) continue;
      try {
        out[key] = await this.listAll(method, key);
      } catch (e) {
        out.errors[key] = e.code || "rpc";
        this.log("error", method + ": " + e.message);
      }
    }
    return out;
  }

  callTool(name, args, timeoutMs) {
    return this.request("tools/call", { name, arguments: args || {} }, timeoutMs || 120000);
  }

  async close() {
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
    this.closedWith = this.closedWith || new McpError("exited", "closed");
    await this.t.close().catch(() => {});
  }
}
