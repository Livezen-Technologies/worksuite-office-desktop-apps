/*
 * The account store of src/worksuite/core.js: keying by (server, user id), duplicates, isolation of
 * tokens / secure-store entries / Drive cache, and what Sign out and Remove delete. Native side faked:
 * "worksuite:secret" is an in-memory secure store, HTTP is a fake fetch that records where tokens went.
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// like the browser's: stored keys are the object's own keys (Object.keys(localStorage))
class FakeStorage {
  getItem(k) { return Object.prototype.hasOwnProperty.call(this, k) ? this[k] : null; }
  setItem(k, v) { this[k] = String(v); }
  removeItem(k) { delete this[k]; }
}
globalThis.localStorage = new FakeStorage();
globalThis.window = globalThis;
globalThis.l10n = {};

const secrets = {}; // the OS secure store: Keychain / Credential Manager / libsecret
const native = { handlers: [], commands: [] };
globalThis.AscDesktopEditor = {
  on: (type, fn) => type === "on_native_message" && native.handlers.push(fn),
  execCommand: (cmd, param) => {
    native.commands.push([cmd, param]);
    if (cmd === "portal:logout" && globalThis.onPortalLogout) return globalThis.onPortalLogout(JSON.parse(param));
    if (cmd !== "worksuite:secret") return;
    const p = JSON.parse(param);
    const reply = { req: p.req, ok: false };
    if (p.op === "set") { secrets[p.key] = p.value; reply.ok = true; }
    if (p.op === "get" && p.key in secrets) { reply.ok = true; reply.value = secrets[p.key]; }
    if (p.op === "delete") { delete secrets[p.key]; reply.ok = true; }
    setTimeout(() => native.handlers.forEach((h) => h("worksuite:secret", JSON.stringify(reply))), 0);
  },
};

const calls = [];
let refreshStatus = 200;
globalThis.fetch = async (url, opts) => {
  calls.push({ url, auth: opts.headers && opts.headers.Authorization, body: opts.body ? JSON.parse(opts.body) : undefined });
  if (url.endsWith("/api/auth/refresh")) {
    if (refreshStatus !== 200) return { status: refreshStatus, text: async () => "{}" };
    return { status: 200, text: async () => JSON.stringify({ data: { tokens: { access_token: "fresh-" + new URL(url).host, refresh_token: "r2-" + new URL(url).host, expires_in: 3600 } } }) };
  }
  return { status: 200, text: async () => JSON.stringify({ status: "ok", data: { files: [] } }) };
};

const out = path.join(root, "test", ".accounts.bundle.mjs");
await build({
  entryPoints: [path.join(root, "src/worksuite/core.js")],
  bundle: true, format: "esm", platform: "neutral", outfile: out, logLevel: "error",
  alias: { "@": path.join(root, "src") },
  plugins: [{ name: "stub", setup(b) {
    b.onResolve({ filter: /sdk\/bridge\.js$|services\/l10n/ }, (a) => ({ path: a.path, namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({ contents: a.path.includes("l10n") ? "export const t = (k, d) => d;" : "" }));
  } }],
});
await import(out);
const WS = window.WorkSuite;

const tokens = (who) => ({ user: { id: who.id, name: who.name, organization: who.org || "" }, tokens: { access_token: "a-" + who.tag, refresh_token: "r-" + who.tag, expires_in: 3600 } });
const A = "https://a.worksuite.lk", B = "https://b.worksuite.lk";

test("accounts are keyed by (server, user id); one secure-store entry each", async () => {
  const x = await WS._remember(A, tokens({ id: 1, name: "One", tag: "a1" }));
  const y = await WS._remember(A, tokens({ id: 2, name: "Two", tag: "a2" }));
  const z = await WS._remember(B, tokens({ id: 1, name: "One at B", tag: "b1" }));
  assert.deepEqual([x.id, y.id, z.id], [A + "|1", A + "|2", B + "|1"]);
  assert.equal(WS.accounts().length, 3);
  assert.equal(secrets[WS._secretKey(x)], "r-a1");
  assert.equal(secrets[WS._secretKey(y)], "r-a2");
  assert.equal(secrets[WS._secretKey(z)], "r-b1");
  assert.equal(new Set([x, y, z].map(WS._secretKey)).size, 3);
});

test("adding the same account again replaces only its own entry", async () => {
  await WS._remember(A, tokens({ id: 2, name: "Two", tag: "a2-again" }));
  assert.equal(WS.accounts().filter((a) => a.id === A + "|2").length, 1);
  assert.equal(WS.accounts().length, 3);
  assert.equal(secrets[WS._secretKey({ server: A, user: { id: 2 } })], "r-a2-again");
  assert.equal(secrets[WS._secretKey({ server: A, user: { id: 1 } })], "r-a1");
  assert.equal(secrets[WS._secretKey({ server: B, user: { id: 1 } })], "r-b1");
});

test("an account's token only ever goes to its own server", async () => {
  calls.length = 0;
  for (const a of WS.accounts()) await WS.api(a, "GET", "/api/drive/list");
  const list = calls.filter((c) => c.url.includes("/api/drive/list"));
  assert.equal(list.length, 3);
  for (const c of list) {
    const host = new URL(c.url).origin;
    assert.ok(c.auth.endsWith(host === A ? (c.auth.includes("a1") ? "a1" : "a2-again") : "b1"), c.url + " got " + c.auth);
  }
  const toB = list.filter((c) => c.url.startsWith(B));
  assert.ok(toB.every((c) => c.auth === "Bearer a-b1"));
});

test("Sign out: that account's tokens go, the account and its Drive cache stay; others untouched", async () => {
  const two = WS.accounts().find((a) => a.id === A + "|2");
  localStorage.setItem("ws:cache:" + two.id + ":recent", "{}");
  await WS.signOutOnly(two);
  const after = WS.accounts().find((a) => a.id === two.id);
  assert.equal(after.signedOut, true);
  assert.equal(after.signedOutBy, "user");
  assert.equal(secrets[WS._secretKey(two)], undefined);
  assert.ok(localStorage.getItem("ws:cache:" + two.id + ":recent"));
  assert.equal(secrets[WS._secretKey({ server: A, user: { id: 1 } })], "r-a1");
  assert.equal(WS.accounts().length, 3);
  const logout = calls.filter((c) => c.url === A + "/api/auth/logout").pop();
  assert.equal(logout.body.refresh_token, "r-a2-again");
  // another account still uses A: the editor tabs of A stay signed in
  assert.ok(!native.commands.some(([c, p]) => c === "portal:logout" && p.includes("a.worksuite.lk")));
});

test("Reconnect after Sign out asks for a sign-in (no token kept); an expired session tries the kept token first", async () => {
  const two = WS.accounts().find((a) => a.id === A + "|2");
  assert.deepEqual(await WS.reconnect(two), { signIn: true });
  const one = WS.accounts().find((a) => a.id === A + "|1");
  const r = await WS.reconnect(one);
  assert.deepEqual(r, { ok: true });
  assert.equal(secrets[WS._secretKey(one)], "r2-a.worksuite.lk");
  refreshStatus = 401;
  const z = WS.accounts().find((a) => a.id === B + "|1");
  assert.deepEqual(await WS.reconnect(z), { signIn: true });
  const expired = WS.accounts().find((a) => a.id === z.id);
  assert.equal(expired.signedOut, true);
  assert.equal(expired.signedOutBy, undefined);
  refreshStatus = 200;
});

test("Remove: the account, its secure-store entry and its Drive cache go; others untouched", async () => {
  const one = WS.accounts().find((a) => a.id === A + "|1");
  localStorage.setItem("ws:cache:" + one.id + ":recent", "{}");
  localStorage.setItem("ws:cache:" + B + "|1:recent", "{}");
  await WS.remove(one);
  assert.equal(WS.accounts().find((a) => a.id === one.id), undefined);
  assert.equal(secrets[WS._secretKey(one)], undefined);
  assert.equal(localStorage.getItem("ws:cache:" + one.id + ":recent"), null);
  assert.ok(localStorage.getItem("ws:cache:" + B + "|1:recent"));
  assert.equal(WS.accounts().length, 2);
});

/*
 * Editor tabs (docs/accounts.md, "Editor tabs"): one CEF cookie store for all tabs, so a server's tabs belong
 * to one account at a time. Opening as another account ends the server's web session first (portal:logout,
 * after the person agrees); Sign out / Remove of that account ends it even when others stay signed in there.
 */
const C = "https://c.worksuite.lk";
const nativeSays = (cmd, param) => setTimeout(() => native.handlers.forEach((h) => h(cmd, param)), 0);
const since = (n) => native.commands.slice(n);
const logouts = (list) => list.filter(([c, p]) => c === "portal:logout" && JSON.parse(p).domain === C);
const opened = (list) => list.filter(([c, p]) => c === "open:recent" && JSON.parse(p).cloud === C);
const DOC = { id: "5", name: "Plan.docx", ext: "docx" };

test("editor tabs: the first account to open on a server owns its tabs; opening again as it asks nothing", async () => {
  const x = await WS._remember(C, tokens({ id: 1, name: "Xan", tag: "c1" }));
  await WS._remember(C, tokens({ id: 2, name: "Yu", tag: "c2" }));
  let asked = 0;
  WS.confirmAccountSwitch = async () => { asked++; return true; };
  const n = native.commands.length;
  await WS.open(x, DOC);
  await WS.open(x, DOC);
  assert.equal(WS.tabOwner(C), x.id);
  assert.equal(asked, 0);
  assert.equal(logouts(since(n)).length, 0);
  assert.equal(opened(since(n)).length, 2);
});

test("editor tabs: opening as another account of that server ends the server's web session first", async () => {
  const y = WS.accounts().find((a) => a.id === C + "|2");
  let asked = null;
  WS.confirmAccountSwitch = async (to, from) => { asked = [to.id, from.id]; return true; };
  globalThis.onPortalLogout = (p) => nativeSays("portal:logout", p.domain);
  const n = native.commands.length;
  await WS.open(y, DOC);
  globalThis.onPortalLogout = null;
  assert.deepEqual(asked, [C + "|2", C + "|1"]);
  const after = since(n);
  assert.equal(logouts(after).length, 1);
  assert.equal(opened(after).length, 1);
  assert.ok(after.indexOf(logouts(after)[0]) < after.indexOf(opened(after)[0]), "cookies cleared before the new tab opens");
  assert.equal(WS.tabOwner(C), y.id);
});

test("editor tabs: declining, or keeping a tab with unsaved changes, opens nothing and keeps the owner", async () => {
  const x = WS.accounts().find((a) => a.id === C + "|1");
  WS.confirmAccountSwitch = async () => false;
  let n = native.commands.length;
  await assert.rejects(WS.open(x, DOC), (e) => e.code === "account-switch-cancelled");
  assert.equal(logouts(since(n)).length, 0);
  assert.equal(opened(since(n)).length, 0);
  assert.equal(WS.tabOwner(C), C + "|2");

  WS.confirmAccountSwitch = async () => true;
  globalThis.onPortalLogout = (p) => nativeSays("portal:logout:cancel", JSON.stringify({ domain: p.domain }));
  n = native.commands.length;
  await assert.rejects(WS.open(x, DOC), (e) => e.code === "account-switch-cancelled");
  globalThis.onPortalLogout = null;
  assert.equal(logouts(since(n)).length, 1);
  assert.equal(opened(since(n)).length, 0);
  assert.equal(WS.tabOwner(C), C + "|2");
});

test("editor tabs: Sign out of the tabs' account ends the server's session even with another account there", async () => {
  const x = WS.accounts().find((a) => a.id === C + "|1");
  const y = WS.accounts().find((a) => a.id === C + "|2");
  // not the owner, the owner still signed in: its tabs stay
  let n = native.commands.length;
  await WS.signOutOnly(x);
  assert.equal(logouts(since(n)).length, 0);
  assert.equal(WS.tabOwner(C), y.id);
  // the owner: its tabs and cookies go
  await WS._remember(C, tokens({ id: 1, name: "Xan", tag: "c1b" }));
  n = native.commands.length;
  await WS.signOutOnly(y);
  assert.equal(logouts(since(n)).length, 1);
  assert.equal(WS.tabOwner(C), null);
});

test("editor tabs: Remove of the tabs' account ends the server's session; other servers untouched", async () => {
  const x = WS.accounts().find((a) => a.id === C + "|1");
  WS.confirmAccountSwitch = async () => true;
  await WS.open(x, DOC);
  assert.equal(WS.tabOwner(C), x.id);
  const n = native.commands.length;
  await WS.remove(x);
  const after = since(n);
  assert.equal(logouts(after).length, 1);
  assert.equal(after.filter(([c]) => c === "portal:logout").length, 1);
  assert.equal(WS.tabOwner(C), null);
});

