/*
 * Sign in with WorkSuite Cloud (OneAuth) and the Personal account's cloud, as pure functions; core.js runs them.
 *
 * WorkSuite Cloud is a public OIDC provider for WorkSuite's own apps (worksuite-cloud api/src/routes/oauth):
 * authorization code with PKCE S256, `state` and `nonce`, in the system browser (RFC 8252), never a password
 * here. WorkSuite Office is its client `worksuite-office` (migration 033), coming back on
 * worksuiteoffice://auth/callback, the link the app already takes Drive sign-ins on.
 *
 * WHERE. Only WorkSuite Cloud's own hosts are trusted: the issuer and every endpoint must be https on
 * worksuitecloud.com or one of its subdomains, and the issuer's endpoints on the issuer's own origin. The
 * discovery document (https://worksuitecloud.com/.well-known/worksuite) may move them within those hosts;
 * anything else in it is ignored, and without it the built-in addresses are used. WorkSuite Desktop pins the
 * discovery document's signature for the same reason; a page cannot check an Ed25519 signature everywhere
 * the app's browser engine runs, so Office pins the hosts instead.
 *
 * THE PERSONAL CLOUD. WorkSuite Cloud runs a WorkSuite instance for each organization, the Personal one
 * included. Its address is in the `wsc_orgs` claim (id_token, userinfo) once the instance is READY. The
 * Drive documents are there, and Office opens and saves them there exactly as it does on any WorkSuite
 * server, signed in to that instance with the same WorkSuite Cloud account: its /login page's silent
 * "Sign in with WorkSuite Cloud" (`?wsc=switch`, prompt=none) and then its /desktop/office hand-off
 * (worksuiteoffice://auth/callback, /api/auth/apps/exchange or /api/auth/apps/poll), so no password and
 * normally no question either. Cloud's own API (/api/v1/me, /api/v1/storage/usage) takes the OneAuth
 * token with `X-WS-Org`, as for WorkSuite Desktop.
 *
 * THE GATEWAY. When /api/v1/me says so (`gateway`), WorkSuite Cloud serves the instance's API at its own
 * address for this token and `X-WS-Org` (worksuite-cloud api/src/routes/cloud/gateway.ts). Then there is no
 * second trip to the browser: the gateway hands Office a one-time code for its own session on the instance
 * (POST <gateway>/auth/apps/handoff, PKCE S256), which Office exchanges at the instance's
 * /api/auth/apps/exchange as after a browser sign-in. Anything else — no gateway, a workspace that does not
 * know the person yet (CLOUD_NOT_LINKED), an error — falls back to the browser sign-in above. The Cloud token
 * only ever goes to Cloud's own hosts: the gateway's address must be one of them.
 */

export const CLOUD = Object.freeze({
  site: "https://worksuitecloud.com",
  issuer: "https://account.worksuitecloud.com/oauth",
  api: "https://worksuitecloud.com/api",
  client: "worksuite-office",
  scope: "openid profile email offline_access wsc_orgs",
  redirect: "worksuiteoffice://auth/callback",
  discovery: "/.well-known/worksuite",
});

/* How long the issuer's metadata is used before it is asked for again. */
export const META_TTL = 24 * 60 * 60 * 1000;
/* Clock skew allowed on the id_token's exp and iat, in seconds. */
const SKEW = 120;

const trim = (s) => String(s || "").replace(/\/+$/, "");

/* An https address on worksuitecloud.com or a subdomain, with no user info. */
export function isCloudUrl(raw) {
  if (typeof raw !== "string" || raw.length > 2048) return false;
  let u;
  try { u = new URL(raw); } catch { return false; }
  const host = u.hostname.toLowerCase();
  return u.protocol === "https:" && !u.username && !u.password && !u.port &&
         (host === "worksuitecloud.com" || host.endsWith(".worksuitecloud.com"));
}

/*
 * The issuer and API from Cloud's discovery document, where they are Cloud's own; the built-in ones otherwise.
 * (deployment CLOUD, auth.mode oidc, auth.issuer, endpoints.api)
 */
export function cloudConfig(doc) {
  const out = { issuer: CLOUD.issuer, api: CLOUD.api };
  if (!doc || typeof doc !== "object" || doc.product !== "WorkSuite" || doc.deployment !== "CLOUD") return out;
  const auth = doc.auth && typeof doc.auth === "object" ? doc.auth : {};
  const endpoints = doc.endpoints && typeof doc.endpoints === "object" ? doc.endpoints : {};
  if (auth.mode === "oidc" && isCloudUrl(auth.issuer)) out.issuer = trim(auth.issuer);
  if (isCloudUrl(endpoints.api)) out.api = trim(endpoints.api);
  return out;
}

/*
 * The issuer's metadata (/.well-known/openid-configuration), checked: the same issuer, S256, and every endpoint
 * https on the issuer's own origin. Throws on anything else: never a partial sign-in.
 */
export function checkMetadata(meta, issuer) {
  const bad = (why) => Object.assign(new Error("WorkSuite Cloud's sign-in service did not describe itself correctly (" + why + ")."), { code: "bad-metadata" });
  if (!meta || typeof meta !== "object") throw bad("no metadata");
  if (trim(meta.issuer) !== trim(issuer)) throw bad("issuer");
  const origin = new URL(issuer).origin;
  const on = (u) => isCloudUrl(u) && new URL(u).origin === origin;
  if (!on(meta.authorization_endpoint) || !on(meta.token_endpoint)) throw bad("endpoints");
  const methods = meta.code_challenge_methods_supported;
  if (Array.isArray(methods) && methods.indexOf("S256") < 0) throw bad("PKCE");
  const out = { issuer: trim(meta.issuer), authorization_endpoint: meta.authorization_endpoint, token_endpoint: meta.token_endpoint };
  ["revocation_endpoint", "userinfo_endpoint", "end_session_endpoint"].forEach((k) => { if (on(meta[k])) out[k] = meta[k]; });
  return out;
}

/* The authorize address. `signUp` opens the create-account page; `loginHint` fills the email in. */
export function authorizeUrl(meta, req) {
  const u = new URL(meta.authorization_endpoint);
  const q = u.searchParams;
  q.set("response_type", "code");
  q.set("client_id", CLOUD.client);
  q.set("redirect_uri", req.redirect || CLOUD.redirect);
  q.set("scope", CLOUD.scope);
  q.set("state", req.state);
  q.set("nonce", req.nonce);
  q.set("code_challenge", req.challenge);
  q.set("code_challenge_method", "S256");
  const hint = String(req.loginHint || "").trim();
  if (hint && hint.length <= 254 && hint.indexOf("@") > 0) q.set("login_hint", hint);
  if (req.signUp) q.set("prompt", "create");
  return u.toString();
}

/* What came back on the redirect: {code} or {error, message}. `iss` (RFC 9207) must be the issuer when present. */
export function readCallback(params, issuer) {
  const get = (k) => (params && typeof params.get === "function" ? params.get(k) : null);
  const iss = get("iss");
  if (iss && trim(iss) !== trim(issuer)) return { error: "issuer", message: "" };
  const error = get("error");
  if (error) return { error: error, message: String(get("error_description") || "").slice(0, 300) };
  const code = get("code") || "";
  if (!/^[A-Za-z0-9._~-]{8,2048}$/.test(code)) return { error: "invalid_request", message: "" };
  return { code: code };
}

/* The form for the token endpoint: the code with its verifier, or a refresh token. */
export function tokenForm(grant) {
  const f = { client_id: CLOUD.client };
  if (grant.refresh) {
    f.grant_type = "refresh_token";
    f.refresh_token = grant.refresh;
  } else {
    f.grant_type = "authorization_code";
    f.code = grant.code;
    f.code_verifier = grant.verifier;
    f.redirect_uri = grant.redirect || CLOUD.redirect;
  }
  return f;
}

/* {access, refresh, expiresIn, idToken} from a token answer; a server that does not rotate keeps the old refresh. */
export function tokensOf(json, oldRefresh) {
  if (!json || typeof json.access_token !== "string" || !json.access_token) return null;
  const refresh = typeof json.refresh_token === "string" && json.refresh_token ? json.refresh_token : oldRefresh;
  if (!refresh) return null;
  return {
    access: json.access_token,
    refresh: refresh,
    expiresIn: Number(json.expires_in) > 0 ? Number(json.expires_in) : 3600,
    idToken: typeof json.id_token === "string" ? json.id_token : null,
  };
}

function b64urlDecode(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/* The claims of a compact JWT, unverified: it came straight from the token endpoint over TLS (OIDC Core §3.1.3.7). */
export function jwtClaims(jwt) {
  const parts = String(jwt || "").split(".");
  if (parts.length !== 3) return null;
  try {
    const c = JSON.parse(b64urlDecode(parts[1]));
    return c && typeof c === "object" && !Array.isArray(c) ? c : null;
  } catch {
    return null;
  }
}

/* iss, aud, nonce, exp and iat of the id_token from the code exchange; the claims, or an Error naming what failed. */
export function checkIdToken(idToken, expect, nowMs) {
  const c = jwtClaims(idToken);
  const bad = (why) => Object.assign(new Error("The sign-in could not be confirmed (" + why + "). Sign in again."), { code: "bad-id-token" });
  if (!c) throw bad("unreadable");
  if (trim(c.iss) !== trim(expect.issuer)) throw bad("issuer");
  const aud = Array.isArray(c.aud) ? c.aud.map(String) : [String(c.aud || "")];
  if (aud.indexOf(CLOUD.client) < 0) throw bad("audience");
  if (aud.length > 1 && c.azp !== CLOUD.client) throw bad("authorized party");
  if (typeof c.nonce !== "string" || c.nonce !== expect.nonce) throw bad("nonce");
  const s = Math.floor((nowMs || Date.now()) / 1000);
  if (typeof c.exp !== "number" || c.exp + SKEW <= s) throw bad("expired");
  if (typeof c.iat === "number" && c.iat > s + SKEW) throw bad("issued in the future");
  if (typeof c.sub !== "string" && typeof c.sub !== "number") throw bad("subject");
  return c;
}

/* An https instance address from wsc_orgs, as an origin; anything else is no address. */
function instanceOrigin(raw) {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && !u.username && !u.password && u.hostname ? u.origin.toLowerCase() : null;
  } catch {
    return null;
  }
}

/*
 * The person's organizations from /api/v1/me (id, name, plan, state) and wsc_orgs (type, role, instance, url),
 * by id: [{id, name, type, plan, state, role, url}]. `url` only for a READY instance, and only https.
 */
export function orgsOf(me, wscOrgs) {
  const byId = {};
  const order = [];
  const take = (o, extra) => {
    if (!o || (typeof o.id !== "string" && typeof o.id !== "number")) return;
    const id = String(o.id);
    if (!byId[id]) { byId[id] = { id: id, name: "", type: "", plan: "", state: "", role: "", url: null }; order.push(id); }
    Object.assign(byId[id], extra(o));
  };
  (me && Array.isArray(me.organizations) ? me.organizations : []).forEach((o) => take(o, (x) => ({
    name: String(x.name || byId[String(x.id)] && byId[String(x.id)].name || ""), plan: String(x.plan || ""), state: String(x.state || ""),
  })));
  (Array.isArray(wscOrgs) ? wscOrgs : []).forEach((o) => take(o, (x) => {
    const out = { type: String(x.type || ""), role: String(x.role || ""), url: instanceOrigin(x.url) };
    if (x.name && !byId[String(x.id)].name) out.name = String(x.name);
    return out;
  }));
  return order.map((id) => byId[id]);
}

/* The organization to work in: the one Cloud says is active, else the Personal one, else the first. */
export function activeOrg(orgs, activeId) {
  const list = Array.isArray(orgs) ? orgs : [];
  return (activeId !== null && activeId !== undefined && list.find((o) => o.id === String(activeId))) ||
         list.find((o) => o.type === "PERSONAL") || list[0] || null;
}

/*
 * Where the person's cloud is at, for the card: "ready" (an address to open), "setting-up" (provisioning, or no
 * instance yet), "failed" (provisioning failed), "verify-email", "read-only" (suspended, deletion pending, or a
 * restricted organization: open and download only), or "none" (no organization).
 */
export function cloudState(accountState, org) {
  if (accountState === "REGISTERED" || accountState === "EMAIL_VERIFICATION_PENDING") return "verify-email";
  if (!org) return "none";
  if (accountState === "PROVISIONING_FAILED") return "failed";
  if (!org.url) return "setting-up";
  if (accountState === "SUSPENDED" || accountState === "PENDING_DELETION" || org.state === "RESTRICTED") return "read-only";
  return "ready";
}

/*
 * The sign-in to the organization's own WorkSuite instance: its /login page starts "Sign in with WorkSuite
 * Cloud" by itself (?wsc=switch, a silent prompt=none sign-in, which the browser that just signed in to
 * WorkSuite Cloud passes), then goes on to /desktop/office, Office's usual hand-off, with this PKCE challenge
 * and state. An instance without WorkSuite Cloud sign-in shows its ordinary sign-in page and comes back the same.
 */
export function workspaceSignInUrl(instance, req) {
  const origin = instanceOrigin(instance);
  if (!origin) return null;
  const next = "/desktop/office?challenge=" + encodeURIComponent(req.challenge) + "&state=" + encodeURIComponent(req.state) +
               "&device=" + encodeURIComponent(req.device || "");
  return origin + "/login?wsc=switch&next=" + encodeURIComponent(next);
}

/*
 * The workspace gateway /api/v1/me offers ({version, base, ready, handoff}), when it is on Cloud's own hosts and
 * can hand Office a session: {base}. Anything else is no gateway.
 */
export function gatewayOf(me) {
  const g = me && typeof me === "object" ? me.gateway : null;
  if (!g || typeof g !== "object" || !(Number(g.version) >= 1) || g.handoff !== true || !isCloudUrl(g.base)) return null;
  return { base: trim(g.base) };
}

/* The body of the gateway's hand-off: a code for WorkSuite Office's own session, bound to this PKCE challenge. */
export function gatewayHandoff(challenge) {
  return { client: CLOUD.client, code_challenge: challenge, code_challenge_method: "S256" };
}

/* The key the refresh token is kept under in the secret store (never the token itself in localStorage). */
export function cloudSecretKey(account) {
  return "worksuite-cloud:" + account.issuer + "|" + account.sub;
}
