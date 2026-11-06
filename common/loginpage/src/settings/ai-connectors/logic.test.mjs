import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "./logic.js";

test("splitArgs / joinArgs", () => {
  assert.deepEqual(L.splitArgs('npx -y @s/x --dir "My Files" \'\''), ["npx", "-y", "@s/x", "--dir", "My Files", ""]);
  assert.deepEqual(L.splitArgs(L.joinArgs(["a b", "c"])), ["a b", "c"]);
});

test("parseEnv", () => {
  assert.deepEqual(L.parseEnv("A=1\n# c\nB=x=y\n1BAD=2"), { env: { A: "1", B: "x=y" }, bad: ["1BAD=2"] });
});

test("secrets only over https or to this computer", () => {
  assert.ok(L.secretAllowed("https://api.openai.com/v1"));
  assert.ok(L.secretAllowed("http://127.0.0.1:11434"));
  assert.ok(L.secretAllowed("http://localhost:8080"));
  assert.ok(!L.secretAllowed("http://192.168.1.5:8080"));
  assert.equal(L.locationOf("http://[::1]:1/"), "local");
  assert.equal(L.locationOf("https://api.x.com"), "cloud");
});

test("server validation", () => {
  const s = L.normalizeServer({ name: "A", transport: "streamable-http", url: "http://example.com/mcp", auth: { type: "bearer" } });
  assert.deepEqual(L.validateServer(s, []), [["url", "insecure"]]);
  const t = L.normalizeServer({ name: "a", transport: "stdio" });
  assert.deepEqual(L.validateServer(t, [s]), [["name", "duplicate"], ["command", "required"]]);
  const o = L.normalizeServer({ name: "o", transport: "streamable-http", url: "https://x", auth: { type: "oauth" } });
  assert.deepEqual(L.validateServer(o, []), [["auth", "oauth"]]);
});

test("transportSpec keeps secrets as keys", () => {
  const s = L.normalizeServer({ id: "m1", name: "x", command: "node", secretEnv: ["TOKEN"] });
  assert.deepEqual(L.transportSpec(s).secretEnv, { TOKEN: "ai:mcp:m1:env:TOKEN" });
  const h = L.normalizeServer({ id: "m2", name: "h", transport: "streamable-http", url: "https://x", auth: { type: "header", header: "X-API-Key" } });
  assert.deepEqual(L.transportSpec(h).auth, { secret: "ai:mcp:m2:auth", header: "X-API-Key", prefix: "" });
});

test("models: ollama tags and openai list", () => {
  assert.deepEqual(L.parseModels("ollama", '{"models":[{"name":"llama3:8b"},{"name":"qwen2.5"}]}'), ["llama3:8b", "qwen2.5"]);
  assert.deepEqual(L.parseModels("openai", { data: [{ id: "gpt-b" }, { id: "gpt-a" }] }), ["gpt-a", "gpt-b"]);
  assert.equal(L.parseModels("openai", "<html>"), null);
  const p = L.normalizeProvider({ kind: "ollama" });
  assert.equal(L.modelsRequest(p).url, "http://127.0.0.1:11434/api/tags");
  assert.equal(L.editorBaseUrl(p), "http://127.0.0.1:11434/v1");
});

test("publishToEditors replaces only ours", () => {
  const theirs = { type: "openaicompatible", name: "WorkSuite AI", baseUrl: "https://s", key: "t" };
  const a = L.normalizeProvider({ id: "p1", name: "Mine", baseUrl: "https://a/v1", useInEditors: true });
  const b = L.normalizeProvider({ id: "p2", name: "Local", kind: "ollama", useInEditors: true });
  let r = L.publishToEditors([theirs], [a, b], [], { p1: "k1" });
  assert.deepEqual(r.published, ["Mine", "Local"]);
  assert.equal(r.list[1].key, "k1");
  assert.equal(r.list[2].key, "");
  r = L.publishToEditors(r.list, [{ ...a, baseUrl: "https://b/v1" }], r.published, {});
  assert.deepEqual(r.list.map((e) => e.name), ["WorkSuite AI", "Mine"]);
  assert.equal(r.list[1].key, "k1");
  assert.equal(r.list[1].baseUrl, "https://b/v1");
  // a name someone else owns is not taken over
  assert.deepEqual(L.publishToEditors([theirs], [{ ...a, name: "WorkSuite AI" }], [], {}).published, []);
});

test("permissions", () => {
  let p = L.allowAlways({}, "s", "write_file");
  assert.ok(L.isAlwaysAllowed(p, "s", "write_file"));
  assert.ok(!L.isAlwaysAllowed(p, "s", "other"));
  assert.deepEqual(L.permissionList(p, [{ id: "s", name: "Files" }]), [{ serverId: "s", server: "Files", tool: "write_file" }]);
  p = L.revoke(p, "s", "write_file");
  assert.deepEqual(p, {});
});

test("log is capped", () => {
  let log = [];
  for (let i = 0; i < 5; i++) log = L.appendLog(log, { text: "x" + i }, 3);
  assert.deepEqual(log.map((e) => e.text), ["x2", "x3", "x4"]);
});

test("resultText", () => {
  assert.equal(L.resultText({ content: [{ type: "text", text: "a" }, { type: "image", mimeType: "image/png" }] }), "a\n[image image/png]");
});
