import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLOUD, activeOrg, authorizeUrl, checkIdToken, checkMetadata, cloudConfig, cloudSecretKey, cloudState, isCloudUrl, jwtClaims, orgsOf,
  readCallback, tokenForm, tokensOf, workspaceSignInUrl,
} from "./cloud-logic.js";

const ISS = "https://account.worksuitecloud.com/oauth";
const META = {
  issuer: ISS,
  authorization_endpoint: ISS + "/authorize",
  token_endpoint: ISS + "/token",
  revocation_endpoint: ISS + "/revoke",
  userinfo_endpoint: ISS + "/userinfo",
  code_challenge_methods_supported: ["S256"],
};
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims) => b64({ alg: "RS256" }) + "." + b64(claims) + ".sig";
const now = Date.UTC(2026, 9, 27, 9, 0, 0);
const secs = Math.floor(now / 1000);

test("only https on worksuitecloud.com and its subdomains is Cloud", () => {
  assert.equal(isCloudUrl("https://account.worksuitecloud.com/oauth"), true);
  assert.equal(isCloudUrl("https://worksuitecloud.com/api"), true);
  assert.equal(isCloudUrl("http://account.worksuitecloud.com/oauth"), false);
  assert.equal(isCloudUrl("https://worksuitecloud.com.evil.example/oauth"), false);
  assert.equal(isCloudUrl("https://evilworksuitecloud.com/oauth"), false);
  assert.equal(isCloudUrl("https://a:b@account.worksuitecloud.com/oauth"), false);
  assert.equal(isCloudUrl("https://account.worksuitecloud.com:8443/oauth"), false);
  assert.equal(isCloudUrl("not a url"), false);
});

test("discovery: Cloud's own issuer and API are taken, anything else falls back to the built-in ones", () => {
  const doc = { product: "WorkSuite", deployment: "CLOUD", auth: { mode: "oidc", issuer: "https://id.worksuitecloud.com/oauth/" }, endpoints: { api: "https://api.worksuitecloud.com/api" } };
  assert.deepEqual(cloudConfig(doc), { issuer: "https://id.worksuitecloud.com/oauth", api: "https://api.worksuitecloud.com/api" });
  assert.deepEqual(cloudConfig({ ...doc, auth: { mode: "oidc", issuer: "https://evil.example/oauth" }, endpoints: { api: "https://evil.example/api" } }),
                   { issuer: CLOUD.issuer, api: CLOUD.api });
  assert.deepEqual(cloudConfig({ ...doc, deployment: "ENTERPRISE" }), { issuer: CLOUD.issuer, api: CLOUD.api });
  assert.deepEqual(cloudConfig(null), { issuer: CLOUD.issuer, api: CLOUD.api });
});

test("metadata: same issuer, endpoints on the issuer's origin, S256", () => {
  const m = checkMetadata(META, ISS);
  assert.equal(m.token_endpoint, ISS + "/token");
  assert.equal(m.userinfo_endpoint, ISS + "/userinfo");
  assert.throws(() => checkMetadata({ ...META, issuer: "https://other.worksuitecloud.com/oauth" }, ISS), /issuer/);
  assert.throws(() => checkMetadata({ ...META, token_endpoint: "https://evil.example/token" }, ISS), /endpoints/);
  assert.throws(() => checkMetadata({ ...META, token_endpoint: "https://worksuitecloud.com/token" }, ISS), /endpoints/);
  assert.throws(() => checkMetadata({ ...META, code_challenge_methods_supported: ["plain"] }, ISS), /PKCE/);
  // an optional endpoint elsewhere is dropped, not followed
  assert.equal(checkMetadata({ ...META, revocation_endpoint: "https://evil.example/revoke" }, ISS).revocation_endpoint, undefined);
});

test("authorize: code + PKCE S256 + state + nonce on Office's client and scheme, wsc_orgs and a refresh token", () => {
  const u = new URL(authorizeUrl(META, { challenge: "c".repeat(43), state: "s1", nonce: "n1", loginHint: "me@example.com" }));
  const q = Object.fromEntries(u.searchParams);
  assert.equal(u.origin + u.pathname, ISS + "/authorize");
  assert.deepEqual(q, {
    response_type: "code", client_id: "worksuite-office", redirect_uri: "worksuiteoffice://auth/callback",
    scope: "openid profile email offline_access wsc_orgs", state: "s1", nonce: "n1", code_challenge: "c".repeat(43),
    code_challenge_method: "S256", login_hint: "me@example.com",
  });
  const up = new URL(authorizeUrl(META, { challenge: "c", state: "s", nonce: "n", signUp: true, loginHint: "not an email" }));
  assert.equal(up.searchParams.get("prompt"), "create");
  assert.equal(up.searchParams.get("login_hint"), null);
});

test("callback: a code, an error, or a wrong issuer (RFC 9207)", () => {
  const p = (o) => new URLSearchParams(o);
  assert.deepEqual(readCallback(p({ code: "abcdefgh12", state: "s", iss: ISS }), ISS), { code: "abcdefgh12" });
  assert.deepEqual(readCallback(p({ code: "abcdefgh12", iss: "https://evil.example/oauth" }), ISS), { error: "issuer", message: "" });
  assert.deepEqual(readCallback(p({ error: "access_denied", error_description: "No" }), ISS), { error: "access_denied", message: "No" });
  assert.equal(readCallback(p({ code: "<x>" }), ISS).error, "invalid_request");
});

test("token forms: the code with its verifier and redirect, or the refresh token; public client, no secret", () => {
  assert.deepEqual(tokenForm({ code: "k", verifier: "v" }), {
    client_id: "worksuite-office", grant_type: "authorization_code", code: "k", code_verifier: "v", redirect_uri: "worksuiteoffice://auth/callback",
  });
  assert.deepEqual(tokenForm({ refresh: "r" }), { client_id: "worksuite-office", grant_type: "refresh_token", refresh_token: "r" });
});

test("tokens: rotation keeps the new refresh token, a server that does not rotate keeps the old one", () => {
  assert.deepEqual(tokensOf({ access_token: "a", refresh_token: "r2", expires_in: 3600, id_token: "x" }, "r1"), { access: "a", refresh: "r2", expiresIn: 3600, idToken: "x" });
  assert.equal(tokensOf({ access_token: "a" }, "r1").refresh, "r1");
  assert.equal(tokensOf({ access_token: "a" }), null);
  assert.equal(tokensOf({ error: "invalid_grant" }, "r1"), null);
});

test("id_token: iss, aud, nonce, exp and iat are checked", () => {
  const good = { iss: ISS, aud: "worksuite-office", sub: "42", nonce: "n1", iat: secs, exp: secs + 300, email: "me@example.com" };
  assert.equal(checkIdToken(jwt(good), { issuer: ISS, nonce: "n1" }, now).sub, "42");
  assert.throws(() => checkIdToken(jwt({ ...good, iss: "https://evil.example" }), { issuer: ISS, nonce: "n1" }, now), /issuer/);
  assert.throws(() => checkIdToken(jwt({ ...good, aud: "worksuite-desktop" }), { issuer: ISS, nonce: "n1" }, now), /audience/);
  assert.throws(() => checkIdToken(jwt({ ...good, aud: ["worksuite-office", "x"] }), { issuer: ISS, nonce: "n1" }, now), /authorized party/);
  assert.throws(() => checkIdToken(jwt(good), { issuer: ISS, nonce: "other" }, now), /nonce/);
  assert.throws(() => checkIdToken(jwt({ ...good, exp: secs - 600 }), { issuer: ISS, nonce: "n1" }, now), /expired/);
  assert.throws(() => checkIdToken(jwt({ ...good, iat: secs + 3600 }), { issuer: ISS, nonce: "n1" }, now), /future/);
  assert.throws(() => checkIdToken("nope", { issuer: ISS, nonce: "n1" }, now), /unreadable/);
  assert.equal(jwtClaims(jwt({ name: "Nimālī" })).name, "Nimālī");
});

test("organizations: /me and wsc_orgs merged by id; an instance address only when https", () => {
  const me = { organizations: [{ id: "7", name: "Nimali", plan: "FREE", state: "ACTIVE" }, { id: "9", name: "Livezen", plan: "TEAM", state: "RESTRICTED" }], active_organization_id: "9" };
  const wsc = [
    { id: "7", name: "Nimali", type: "PERSONAL", role: "OWNER", instance: "t7", url: "https://t7.worksuitecloud.com/" },
    { id: "9", name: "Livezen", type: "BUSINESS", role: "MEMBER", instance: "t9", url: "http://t9.example" },
    { id: "11", name: "Elsewhere", type: "BUSINESS", role: "MEMBER" },
  ];
  const orgs = orgsOf(me, wsc);
  assert.deepEqual(orgs.map((o) => [o.id, o.name, o.type, o.plan, o.url]), [
    ["7", "Nimali", "PERSONAL", "FREE", "https://t7.worksuitecloud.com"],
    ["9", "Livezen", "BUSINESS", "TEAM", null],
    ["11", "Elsewhere", "BUSINESS", "", null],
  ]);
  assert.equal(activeOrg(orgs, "9").id, "9");
  assert.equal(activeOrg(orgs, null).id, "7");
  assert.equal(activeOrg(orgs, "nope").id, "7");
  assert.equal(activeOrg([], null), null);
});

test("the cloud's state: ready only with an instance address; read-only, setting up, failed, verify email", () => {
  const ready = { url: "https://t7.worksuitecloud.com", state: "ACTIVE" };
  assert.equal(cloudState("ACTIVE", ready), "ready");
  assert.equal(cloudState("ACTIVE", { url: null }), "setting-up");
  assert.equal(cloudState("PROVISIONING", { url: null }), "setting-up");
  assert.equal(cloudState("PROVISIONING_FAILED", { url: null }), "failed");
  assert.equal(cloudState("EMAIL_VERIFICATION_PENDING", ready), "verify-email");
  assert.equal(cloudState("SUSPENDED", ready), "read-only");
  assert.equal(cloudState("ACTIVE", { ...ready, state: "RESTRICTED" }), "read-only");
  assert.equal(cloudState("ACTIVE", null), "none");
});

test("the workspace sign-in: the instance's /login starts its Cloud sign-in, then Office's /desktop/office hand-off", () => {
  const u = new URL(workspaceSignInUrl("https://t7.worksuitecloud.com/files", { challenge: "ch", state: "st", device: "WorkSuite Office on macOS" }));
  assert.equal(u.origin + u.pathname, "https://t7.worksuitecloud.com/login");
  assert.equal(u.searchParams.get("wsc"), "switch");
  const next = new URL(u.searchParams.get("next"), u.origin);
  assert.equal(next.origin, u.origin);
  assert.equal(next.pathname, "/desktop/office");
  assert.deepEqual(Object.fromEntries(next.searchParams), { challenge: "ch", state: "st", device: "WorkSuite Office on macOS" });
  assert.equal(workspaceSignInUrl("http://t7.example", { challenge: "c", state: "s" }), null);
  assert.equal(workspaceSignInUrl("javascript:alert(1)", { challenge: "c", state: "s" }), null);
});

test("the refresh token's key names the issuer and the subject, never the token", () => {
  assert.equal(cloudSecretKey({ issuer: ISS, sub: "42" }), "worksuite-cloud:" + ISS + "|42");
});
