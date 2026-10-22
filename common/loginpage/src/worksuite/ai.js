/*
 * WorkSuite AI in the editors' AI functions (G-17, AIL-01).
 *
 * The AI agent panel (desktop-sdk plugins/ai-agent) and the editors' AI plugin read their provider
 * from this app's local storage: "providers" (the list in AI settings), "current-provider" and
 * "current-model" (the editors' AI plugin takes these as its desktop default model). When an
 * account is signed in and its server offers WorkSuite AI (capability "ai.office"), this puts
 * "WorkSuite AI" in that list — an OpenAI-compatible provider at <server>/api/ai/office/v1, whose
 * answers come from the organisation's CoreAIService — and makes it the current provider unless
 * the person chose another one. Signed out, it is taken out again.
 *
 * The key the plugins send is not the account's sign-in: it is a short-lived token the server
 * mints for AI requests only (POST /api/ai/office/token), revocable with the session and renewed
 * here before it runs out. The refresh token stays in the OS secret store.
 *
 * External providers (OpenAI, Anthropic, …) stay available only when allowed: the organisation's
 * AI policy (the token's `external_providers_allowed`) and IT's managed configuration
 * (ADM-01, `window.WorkSuitePolicy.allowExternalAi`, set by the policy code) can both turn them
 * off. Turned off, they are set aside (not deleted) and come back when allowed again.
 */

const PROVIDER = "WorkSuite AI";
const LS_PROVIDERS = "providers";
const LS_CURRENT = "current-provider";
const LS_MODEL = "current-model";
const LS_SET_ASIDE = "ws:ai:set-aside";
const LS_MINE = "ws:ai:account";
const RENEW_BEFORE = 10 * 60 * 1000;

let timer = null;

/* a timer that does not keep node (tests) alive; a plain number in the page */
function later(fn, ms) {
  const t = setTimeout(fn, ms);
  if (t && t.unref) t.unref();
  return t;
}
let running = null;

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch (e) {
    return fallback;
  }
}

function write(key, value) {
  try {
    value === undefined || value === null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    /* storage full or blocked: the AI settings keep what they had */
  }
}

/*
 * ADM-01 hook: whether IT's managed configuration lets people use AI providers other than
 * WorkSuite AI. The policy code (Settings > WorkSuite, managed configuration) sets
 * window.WorkSuitePolicy.allowExternalAi to a boolean or a function and calls
 * window.WorkSuiteAi.sync() when it changes. No policy: allowed.
 */
export function externalAiAllowedByPolicy() {
  const p = window.WorkSuitePolicy;
  const v = p && p.allowExternalAi;
  if (typeof v === "function") return v() !== false;
  if (typeof v === "boolean") return v;
  return true;
}

/* ADM-01 hook: aiFunctions "off" sets window.WorkSuitePolicy.allowAi = false: no AI provider at all. */
export function aiAllowedByPolicy() {
  const p = window.WorkSuitePolicy;
  const v = p && p.allowAi;
  if (typeof v === "function") return v() !== false;
  return v !== false;
}

/* AI off by policy: WorkSuite AI out, every other provider set aside until allowed again */
function removeAll() {
  setAside(read(LS_PROVIDERS, []));
  write(LS_PROVIDERS, []);
  write(LS_CURRENT, undefined);
  write(LS_MODEL, undefined);
  write(LS_MINE, undefined);
}

const isOurs = (p) => !!p && p.name === PROVIDER;

function liveAccount(WS) {
  const a = WS.active();
  return a && !a.signedOut && WS.has(a, "ai.office") && WS.capability(a) ? a : null;
}

function setAside(providers) {
  const aside = read(LS_SET_ASIDE, []);
  const names = aside.map((p) => p.name);
  write(LS_SET_ASIDE, aside.concat(providers.filter((p) => !isOurs(p) && names.indexOf(p.name) < 0)));
}

function bringBack(list) {
  const aside = read(LS_SET_ASIDE, []);
  if (!aside.length) return list;
  const names = list.map((p) => p.name);
  write(LS_SET_ASIDE, undefined);
  return list.concat(aside.filter((p) => names.indexOf(p.name) < 0));
}

function remove() {
  const list = read(LS_PROVIDERS, []).filter((p) => !isOurs(p));
  // external providers come back only when IT's policy allows them (aiFunctions "worksuite" keeps them aside)
  if (externalAiAllowedByPolicy()) write(LS_PROVIDERS, bringBack(list));
  else {
    setAside(list);
    write(LS_PROVIDERS, []);
    write(LS_CURRENT, undefined);
    write(LS_MODEL, undefined);
  }
  if (isOurs(read(LS_CURRENT, null))) {
    write(LS_CURRENT, undefined);
    write(LS_MODEL, undefined);
  }
  write(LS_MINE, undefined);
}

async function install(WS, account) {
  const data = await WS.api(account, "POST", "/api/ai/office/token", {});
  if (!data || typeof data.token !== "string" || !data.token) throw new Error("no AI token");

  const base = account.server + (typeof data.base_url === "string" && data.base_url.charAt(0) === "/" ? data.base_url : "/api/ai/office/v1");
  const ours = { type: "openaicompatible", name: PROVIDER, baseUrl: base, key: data.token };
  const external = externalAiAllowedByPolicy() && data.external_providers_allowed !== false;

  let list = read(LS_PROVIDERS, []).filter((p) => !isOurs(p));
  if (external) {
    list = bringBack(list);
  } else {
    setAside(list);
    list = [];
  }
  write(LS_PROVIDERS, [ours].concat(list));

  const current = read(LS_CURRENT, null);
  const mine = read(LS_MINE, null);
  // the default when signed in; a provider the person picked themselves stays, if it is allowed
  if (!current || isOurs(current) || !external || mine !== account.id) {
    write(LS_CURRENT, ours);
    const model = data.model && typeof data.model.id === "string" ? data.model : null;
    const saved = read(LS_MODEL, null);
    if (model && (!saved || !isOurs(current) || mine !== account.id)) write(LS_MODEL, { id: model.id, name: model.name || model.id, provider: "openaicompatible" });
  }
  write(LS_MINE, account.id);

  const life = Math.max(5 * 60 * 1000, (Number(data.expires_in) || 3600) * 1000 - RENEW_BEFORE);
  clearTimeout(timer);
  timer = later(sync, life);
}

/* Bring the AI settings in line with the signed-in account; safe to call any time. */
export function sync() {
  const WS = window.WorkSuite;
  if (!WS) return Promise.resolve();
  if (running) return running;

  running = (async () => {
    if (!aiAllowedByPolicy()) {
      clearTimeout(timer);
      removeAll();
      return;
    }
    const account = liveAccount(WS);
    if (!account) {
      clearTimeout(timer);
      if (read(LS_MINE, null) || isOurs(read(LS_CURRENT, null)) || read(LS_SET_ASIDE, []).length) remove();
      return;
    }
    try {
      await install(WS, account);
    } catch (e) {
      // AI switched off for this person (403), or an older server: WorkSuite AI is not offered
      if (e && (e.status === 403 || e.status === 404 || e.signedOut)) remove();
      else {
        clearTimeout(timer);
        timer = later(sync, 5 * 60 * 1000);
      }
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

function start() {
  const WS = window.WorkSuite;
  if (!WS) return;
  WS.on("changed", sync);
  WS.on("signedin", sync);
  window.WorkSuiteAi = { sync: sync, externalAiAllowedByPolicy: externalAiAllowedByPolicy, aiAllowedByPolicy: aiAllowedByPolicy, PROVIDER: PROVIDER };
  sync();
}

setTimeout(start, 0);
