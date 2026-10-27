/*
 * Sign in with WorkSuite Cloud and the Personal cloud (src/worksuite/core.js, cloud-logic.js) end to end, with the
 * page's globals faked: the app (worksuite:open, worksuite:secret, worksuite:link), WorkSuite Cloud (discovery,
 * OneAuth metadata, token, userinfo, revoke, /api/v1/me) and the organization's WorkSuite instance
 * (/.well-known/worksuite-desktop, /api/auth/apps/exchange).
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ISS = "https://account.worksuitecloud.com/oauth";
const SITE = "https://worksuitecloud.com";
const T7 = "https://t7.worksuitecloud.com";

const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
globalThis.window = globalThis;
globalThis.l10n = {};

/* the app: the secret store, links it opens, messages back to the page */
const secrets = {};
const opened = [];
const handlers = [];
const reply = (cmd, obj) => setTimeout(() => handlers.forEach((f) => f(cmd, typeof obj === "string" ? obj : JSON.stringify(obj))), 0);
globalThis.sdk = {
  on: (type, fn) => type === "on_native_message" && handlers.push(fn),
  command: (name, param) => {
    const p = param ? JSON.parse(param) : {};
    if (name === "worksuite:open") { opened.push(p.url); reply(name, { req: p.req, ok: true }); }
    if (name === "worksuite:secret") {
      if (p.op === "set") secrets[p.key] = p.value;
      if (p.op === "delete") delete secrets[p.key];
      reply(name, { req: p.req, ok: p.op !== "get" || p.key in secrets, value: secrets[p.key], store: "os" });
    }
  },
  execCommand: () => {},
};
const link = (url) => reply("worksuite:link", url);

/* WorkSuite Cloud and the instance */
const cloud = { orgUrl: T7, accountState: "ACTIVE", meFails: 0, codes: {}, refresh: new Set(), revoked: [], requests: [] };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const tokens = (extra) => {
  const r = "refresh-" + Math.random().toString(36).slice(2);
  cloud.refresh.add(r);
  return { access_token: "access-" + Math.random().toString(36).slice(2), refresh_token: r, token_type: "Bearer", expires_in: 3600, ...extra };
};
const wscOrgs = () => [{ id: "7", name: "Nimali", type: "PERSONAL", role: "OWNER", instance: "t7", ...(cloud.orgUrl ? { url: cloud.orgUrl } : {}) }];
const json = (status, body) => ({ status, text: async () => (body === undefined ? "" : JSON.stringify(body)) });

globalThis.fetch = async (url, opts) => {
  const method = opts.method || "GET";
  const headers = opts.headers || {};
  const form = headers["Content-Type"] === "application/x-www-form-urlencoded" ? Object.fromEntries(new URLSearchParams(opts.body)) : null;
  cloud.requests.push({ url, method, headers, form });
  const bearer = (headers.Authorization || "").replace(/^Bearer /, "");
  if (url === SITE + "/.well-known/worksuite")
    return json(200, { product: "WorkSuite", deployment: "CLOUD", auth: { mode: "oidc", issuer: ISS, client_id: "worksuite-desktop" }, endpoints: { api: SITE + "/api" } });
  if (url === ISS + "/.well-known/openid-configuration")
    return json(200, { issuer: ISS, authorization_endpoint: ISS + "/authorize", token_endpoint: ISS + "/token", revocation_endpoint: ISS + "/revoke",
                       userinfo_endpoint: ISS + "/userinfo", code_challenge_methods_supported: ["S256"] });
  if (url === ISS + "/token") {
    if (form.client_id !== "worksuite-office" || form.client_secret) return json(401, { error: "invalid_client" });
    if (form.grant_type === "authorization_code") {
      const c = cloud.codes[form.code];
      delete cloud.codes[form.code];
      const s256 = createHash("sha256").update(form.code_verifier || "").digest("base64url");
      if (!c || c.challenge !== s256 || form.redirect_uri !== "worksuiteoffice://auth/callback") return json(400, { error: "invalid_grant" });
      const now = Math.floor(Date.now() / 1000);
      const id = b64({ alg: "RS256" }) + "." + b64({ iss: ISS, aud: "worksuite-office", sub: "42", nonce: c.nonce, iat: now, exp: now + 300,
                                                    email: "nimali@example.com", name: "Nimali Perera", wsc_orgs: wscOrgs() }) + ".sig";
      return json(200, tokens({ id_token: id, scope: "openid profile email offline_access wsc_orgs" }));
    }
    if (form.grant_type === "refresh_token") {
      if (!cloud.refresh.delete(form.refresh_token)) return json(400, { error: "invalid_grant" });
      return json(200, tokens());
    }
  }
  if (url === ISS + "/revoke") { cloud.revoked.push(form.token); cloud.refresh.delete(form.token); return json(200, {}); }
  if (url === ISS + "/userinfo") return bearer ? json(200, { sub: "42", wsc_orgs: wscOrgs() }) : json(401, {});
  if (url === SITE + "/api/v1/me") {
    if (!bearer) return json(401, {});
    if (cloud.meFails > 0) { cloud.meFails--; return json(401, { error: { code: "SESSION_EXPIRED" } }); }
    return json(200, { identity: { id: "42", email: "nimali@example.com", name: "Nimali Perera", email_verified: true }, account_state: cloud.accountState,
                       organizations: [{ id: "7", name: "Nimali", plan: "FREE", state: "ACTIVE" }], active_organization_id: "7" });
  }
  if (url === SITE + "/api/v1/storage/usage") return json(200, { used: 1048576, limit: 2147483648 });
  if (url === T7 + "/.well-known/worksuite-desktop")
    return json(200, { name: "Nimali", office: { features: ["desktop.office", "apps.exchange", "apps.poll", "office.thumbs"], versions: { auth: "2.5.0", euro_office: "1.3.0" } } });
  if (url === T7 + "/api/auth/apps/poll") return json(202, { status: "ok", data: null });
  if (url === T7 + "/api/auth/apps/exchange") {
    const b = JSON.parse(opts.body);
    if (b.client !== "worksuite-office" || b.code !== "c".repeat(43)) return json(400, { status: "error", message: "bad code" });
    return json(200, { status: "ok", data: { user: { id: 5, name: "Nimali Perera", email: "nimali@example.com" }, tokens: { access_token: "core-access", refresh_token: "core-refresh", expires_in: 3600 } } });
  }
  if (url === T7 + "/api/auth/logout") return json(200, { status: "ok" });
  return json(404, { status: "error", message: "not here: " + url });
};

const out = path.join(root, "test", ".cloud.bundle.mjs");
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

const once = (event) => new Promise((resolve) => { const f = (x) => { WS.off(event, f); resolve(x); }; WS.on(event, f); });
const waitFor = async (check) => { for (let i = 0; i < 200; i++) { const v = check(); if (v) return v; await new Promise((r) => setTimeout(r, 5)); } throw new Error("timed out"); };

/* The browser's half: OneAuth hands a code back on Office's scheme for the challenge it was given */
function approveInBrowser(authorizeUrl) {
  const q = new URL(authorizeUrl).searchParams;
  const code = "cloud-code-" + Math.random().toString(36).slice(2);
  cloud.codes[code] = { challenge: q.get("code_challenge"), nonce: q.get("nonce") };
  link("worksuiteoffice://auth/callback?" + new URLSearchParams({ code, state: q.get("state"), iss: ISS }));
}

test("sign in with WorkSuite Cloud, then the personal cloud is a Drive account of its own", async () => {
  const signedIn = once("signedin");
  const server = await WS.signInWithCloud();
  assert.equal(server, SITE);

  const auth = new URL(opened.at(-1));
  assert.equal(auth.origin + auth.pathname, ISS + "/authorize");
  assert.deepEqual([auth.searchParams.get("client_id"), auth.searchParams.get("redirect_uri"), auth.searchParams.get("code_challenge_method")],
                   ["worksuite-office", "worksuiteoffice://auth/callback", "S256"]);
  assert.match(auth.searchParams.get("scope"), /offline_access wsc_orgs/);
  assert.ok(auth.searchParams.get("state").length >= 32 && auth.searchParams.get("nonce").length >= 32);

  const before = opened.length;
  approveInBrowser(auth.toString());

  // then the instance's sign-in: its /login with WorkSuite Cloud, on to /desktop/office with a fresh PKCE challenge
  const ws = new URL(await waitFor(() => opened.length > before && opened.at(-1)));
  assert.equal(ws.origin + ws.pathname, T7 + "/login");
  assert.equal(ws.searchParams.get("wsc"), "switch");
  const next = new URL(ws.searchParams.get("next"), T7);
  assert.equal(next.pathname, "/desktop/office");
  assert.notEqual(next.searchParams.get("challenge"), auth.searchParams.get("code_challenge"));

  link("worksuiteoffice://auth/callback?" + new URLSearchParams({ code: "c".repeat(43), state: next.searchParams.get("state") }));
  const account = await signedIn;
  assert.equal(account.server, T7);
  assert.equal(account.via, "cloud");
  assert.deepEqual(account.cloud, { account: ISS + "|42", org: "7", name: "Nimali" });
  assert.equal(WS.active().id, account.id);

  const [c] = WS.cloudAccounts();
  assert.equal(c.user.email, "nimali@example.com");
  assert.equal(c.org, "7");
  assert.equal(c.state, "ready");
  assert.equal(c.orgs[0].url, T7);

  // tokens: refresh tokens in the secret store only; nothing secret in localStorage
  assert.ok(cloud.refresh.has(secrets["worksuite-cloud:" + ISS + "|42"]));
  assert.equal(secrets["worksuite:" + T7 + "|5"], "core-refresh");
  const kept = JSON.stringify(store);
  assert.doesNotMatch(kept, /refresh-|access-|core-refresh|core-access|code_verifier/);
  assert.equal(JSON.parse(store["ws:pending"] || "null"), null);
});

test("Cloud's API gets X-WS-Org; a refused access token is refreshed once and the rotated refresh token kept", async () => {
  const [c] = WS.cloudAccounts();
  const old = secrets["worksuite-cloud:" + ISS + "|42"];
  cloud.meFails = 1;
  const fresh = await WS.refreshCloud(c);
  assert.equal(fresh.state, "ready");
  const me = cloud.requests.filter((r) => r.url === SITE + "/api/v1/me").at(-1);
  assert.equal(me.headers["X-WS-Org"], "7");
  const refreshed = cloud.requests.filter((r) => r.form && r.form.grant_type === "refresh_token").at(-1);
  assert.equal(refreshed.form.refresh_token, old);
  assert.notEqual(secrets["worksuite-cloud:" + ISS + "|42"], old);
  assert.ok(cloud.refresh.has(secrets["worksuite-cloud:" + ISS + "|42"]));
  assert.deepEqual(await WS.cloudStorage(fresh), { used: 1048576, limit: 2147483648 });
});

test("signing in again while signed in to Cloud: straight to the workspace, already here", async () => {
  const signedIn = once("signedin");
  const before = opened.length;
  const server = await WS.signInWithCloud();
  assert.equal(server, T7);
  assert.equal(opened.length, before);
  assert.equal((await signedIn).server, T7);
});

test("a link with another state is refused; no code is exchanged", async () => {
  const exchanged = cloud.requests.filter((r) => r.url === ISS + "/token").length;
  await WS.signInWithCloud({ again: true });
  const failed = once("error");
  link("worksuiteoffice://auth/callback?" + new URLSearchParams({ code: "abcdefgh123", state: "not-the-state", iss: ISS }));
  assert.match((await failed).message, /expired|already used/);
  assert.equal(cloud.requests.filter((r) => r.url === ISS + "/token").length, exchanged);
  WS.cancelSignIn();
});

test("a code from another issuer (RFC 9207 iss) is refused", async () => {
  await WS.signInWithCloud({ again: true });
  const q = new URL(opened.at(-1)).searchParams;
  const failed = once("error");
  link("worksuiteoffice://auth/callback?" + new URLSearchParams({ code: "abcdefgh123", state: q.get("state"), iss: "https://evil.example/oauth" }));
  await failed;
  assert.equal(WS.pendingSignIn(), null);
});

test("a workspace still being set up says so instead of opening a server that is not there", async () => {
  cloud.orgUrl = null;
  cloud.accountState = "PROVISIONING";
  await assert.rejects(WS.signInWithCloud(), /still being set up/);
  assert.equal(WS.cloudAccounts()[0].state, "setting-up");
  cloud.orgUrl = T7;
  cloud.accountState = "ACTIVE";
});

test("an organisation that locked the server keeps WorkSuite Cloud out", async () => {
  store["ws:policy"] = JSON.stringify({ server: "https://corp.example", lockServer: true });
  assert.equal(WS.cloudAllowed(), false);
  await assert.rejects(WS.signInWithCloud(), /organisation/);
  delete store["ws:policy"];
});

test("sign out of WorkSuite Cloud: the grant revoked, the token deleted, its workspace signed out here", async () => {
  const [c] = WS.cloudAccounts();
  const refresh = secrets["worksuite-cloud:" + ISS + "|42"];
  await WS.signOutCloud(c);
  assert.deepEqual(cloud.revoked, [refresh]);
  const revoke = cloud.requests.filter((r) => r.url === ISS + "/revoke").at(-1);
  assert.deepEqual(revoke.form, { token: refresh, token_type_hint: "refresh_token", client_id: "worksuite-office" });
  assert.equal(secrets["worksuite-cloud:" + ISS + "|42"], undefined);
  assert.deepEqual(WS.cloudAccounts(), []);
  assert.equal(WS.accounts().some((a) => a.cloud), false);
  assert.equal(secrets["worksuite:" + T7 + "|5"], undefined);
});
