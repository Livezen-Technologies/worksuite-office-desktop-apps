import { test } from "node:test";
import assert from "node:assert/strict";
import { McpSession, McpError, httpTransport, parseSse, stdioTransport } from "./mcp-client.js";

/* a fake MCP server: answers JSON-RPC requests */
function serverLogic(opts) {
  const o = opts || {};
  return (msg) => {
    if (msg.method === "initialize") return { protocolVersion: o.version || "2025-06-18", capabilities: o.caps || { tools: {}, prompts: {} }, serverInfo: { name: "fake", version: "1" } };
    if (msg.method === "tools/list") return msg.params && msg.params.cursor ? { tools: [{ name: "b" }] } : { tools: [{ name: "a" }], nextCursor: "2" };
    if (msg.method === "prompts/list") return { error: { code: -32603, message: "boom" } };
    if (msg.method === "tools/call") return { content: [{ type: "text", text: "hi " + msg.params.arguments.who }] };
    return { error: { code: -32601, message: "nope" } };
  };
}

function fakeNativeStdio(logic) {
  const listeners = new Set();
  const writes = [];
  const emit = (m) => setTimeout(() => listeners.forEach((fn) => fn(m)), 0);
  return {
    writes,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async call(m) {
      if (m.op === "spawn") return m.command === "missing" ? { ok: false, error: "not-found", detail: "missing" } : { ok: true, pid: 42 };
      return { ok: false };
    },
    post(m) {
      if (m.op === "kill") { emit({ op: "exit", id: m.id, code: 0 }); return; }
      const msg = JSON.parse(m.data);
      writes.push(msg);
      if (msg.id === undefined || !msg.method) return;
      const r = logic(msg);
      const reply = r.error ? { jsonrpc: "2.0", id: msg.id, error: r.error } : { jsonrpc: "2.0", id: msg.id, result: r };
      emit({ op: "stderr", id: m.id, text: "log line" });
      emit({ op: "stdout", id: m.id, line: JSON.stringify(reply) });
    },
  };
}

test("stdio: initialize, paginated tools, prompts error reported, call", async () => {
  const native = fakeNativeStdio(serverLogic());
  const logs = [];
  const s = new McpSession(stdioTransport(native, { id: "s1", command: "node" }, (k, t) => logs.push(k + ":" + t)), { onLog: (k, t) => logs.push(k + ":" + t) });
  const init = await s.connect();
  assert.equal(init.serverInfo.name, "fake");
  assert.ok(native.writes.some((w) => w.method === "notifications/initialized"));
  const found = await s.discover();
  assert.deepEqual(found.tools.map((t) => t.name), ["a", "b"]);
  assert.deepEqual(found.resources, []);
  assert.equal(found.errors.prompts, "rpc");
  const r = await s.callTool("greet", { who: "x" });
  assert.equal(r.content[0].text, "hi x");
  assert.ok(logs.some((l) => l.startsWith("stderr:")));
  await s.close();
});

test("stdio: a missing command is not-found", async () => {
  const s = new McpSession(stdioTransport(fakeNativeStdio(serverLogic()), { id: "s2", command: "missing" }));
  await assert.rejects(s.connect(), (e) => e instanceof McpError && e.code === "not-found");
});

test("stdio: the process exiting fails pending requests", async () => {
  const listeners = new Set();
  const native = {
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async call() { return { ok: true, pid: 1 }; },
    post() { setTimeout(() => listeners.forEach((fn) => fn({ op: "exit", id: "s3", code: 1 })), 0); },
  };
  const s = new McpSession(stdioTransport(native, { id: "s3", command: "x" }));
  await assert.rejects(s.connect(), (e) => e.code === "exited" && /code 1/.test(e.detail));
});

test("unsupported protocol version", async () => {
  const s = new McpSession(stdioTransport(fakeNativeStdio(serverLogic({ version: "1999-01-01" })), { id: "s4", command: "node" }));
  await assert.rejects(s.connect(), (e) => e.code === "version");
});

test("timeout", async () => {
  const native = { on: () => () => {}, async call() { return { ok: true, pid: 1 }; }, post() {} };
  const s = new McpSession(stdioTransport(native, { id: "s5", command: "x" }), { timeoutMs: 20 });
  await assert.rejects(s.connect(), (e) => e.code === "timeout");
});

function fakeNativeHttp(logic, mode) {
  const seen = [];
  return {
    seen,
    async call(m) {
      seen.push(m);
      if (m.method === "DELETE") return { ok: true, status: 200, headers: {}, body: "" };
      if (mode === "401") return { ok: false, status: 401, headers: { "www-authenticate": 'Bearer realm="x"' }, body: "" };
      if (mode === "down") return { ok: false, status: 0, error: "network", detail: "Connection refused" };
      const msg = JSON.parse(m.body);
      if (msg.id === undefined) return { ok: true, status: 202, headers: {}, body: "" };
      const r = logic(msg);
      const reply = r.error ? { jsonrpc: "2.0", id: msg.id, error: r.error } : { jsonrpc: "2.0", id: msg.id, result: r };
      if (mode === "sse") return { ok: true, status: 200, headers: { "content-type": "text/event-stream", "mcp-session-id": "abc" }, body: ": hi\nevent: message\ndata: " + JSON.stringify(reply) + "\n\n" };
      return { ok: true, status: 200, headers: { "content-type": "application/json", "mcp-session-id": "abc" }, body: JSON.stringify(reply) };
    },
  };
}

for (const mode of ["json", "sse"]) {
  test("streamable http (" + mode + "): session id and protocol version headers", async () => {
    const native = fakeNativeHttp(serverLogic(), mode);
    const s = new McpSession(httpTransport(native, { url: "https://mcp.example.com/mcp", auth: { secret: "ai:mcp:x:auth", header: "Authorization", prefix: "Bearer " } }));
    await s.connect();
    const found = await s.discover();
    assert.equal(found.tools.length, 2);
    const last = native.seen[native.seen.length - 1];
    assert.equal(last.headers["Mcp-Session-Id"], "abc");
    assert.equal(last.headers["MCP-Protocol-Version"], "2025-06-18");
    assert.equal(last.auth.secret, "ai:mcp:x:auth");
    assert.match(native.seen[0].headers.Accept, /text\/event-stream/);
    await s.close();
    assert.equal(native.seen[native.seen.length - 1].method, "DELETE");
  });
}

test("streamable http: 401 is auth, refused connection is network", async () => {
  await assert.rejects(new McpSession(httpTransport(fakeNativeHttp(serverLogic(), "401"), { url: "https://x" })).connect(), (e) => e.code === "auth" && /realm/.test(e.detail));
  await assert.rejects(new McpSession(httpTransport(fakeNativeHttp(serverLogic(), "down"), { url: "https://x" })).connect(), (e) => e.code === "network");
});

test("streamable http: an HTML page is not MCP", async () => {
  const native = { async call() { return { ok: true, status: 200, headers: { "content-type": "text/html" }, body: "<html>" }; } };
  await assert.rejects(new McpSession(httpTransport(native, { url: "https://x" })).connect(), (e) => e.code === "not-mcp");
});

test("parseSse", () => {
  assert.deepEqual(parseSse("data: a\ndata: b\n\nevent: x\ndata:c\n"), [{ event: "message", data: "a\nb" }, { event: "x", data: "c" }]);
});
