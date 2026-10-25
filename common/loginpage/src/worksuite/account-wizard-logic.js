/*
 * The "Add account" wizard as a pure state machine (account-wizard.jsx runs the effects):
 *
 *   server ──SUBMIT──▶ checking ──PROBE_OK──▶ result(ok) ──CONTINUE──▶ choose ──CHOOSE_*──▶ auth
 *     ▲                   │                    result(old|error) ─RETRY─▶ checking            │
 *     └──────BACK─────────┴────────────────────────────────────────────────────────────────── │
 *   auth ──SIGNED_IN──▶ verify ──VERIFY_OK|VERIFY_FAIL──▶ done          auth ──CANCEL──▶ choose
 *   auth ──AUTH_TIMEOUT|AUTH_ERROR──▶ auth(failed: retry / back)
 *
 * A Desktop account that is already signed in here never starts a sign-in: the wizard ends with
 * `duplicate` set so the page can focus the existing card.
 */
import { validateServer } from "./settings-logic.js";

export const STEPS = ["server", "result", "choose", "auth", "verify"];

export function initialWizard(opts) {
  opts = opts || {};
  return {
    step: "server",
    server: opts.server || "",
    locked: !!opts.locked,
    error: "",
    probe: null, // {ok, old, name} | {error}
    desktop: [], // WorkSuite Desktop accounts on this server
    via: null, // "desktop" | "browser"
    pick: null, // the Desktop account chosen
    auth: null, // {state: "waiting"|"timeout"|"error", message}
    account: null,
    orgs: null,
    warning: "",
    duplicate: null,
  };
}

/* the step number shown (1-based) for the progress indicator */
export function stepIndex(state) {
  const s = state.step === "checking" ? "server" : state.step === "done" ? "verify" : state.step;
  return STEPS.indexOf(s) + 1;
}

export function wizardReducer(state, ev, ctx) {
  ctx = ctx || {};
  switch (ev.type) {
    case "INPUT":
      if (state.locked || (state.step !== "server" && state.step !== "result")) return state;
      return { ...state, step: "server", server: ev.value, error: "", probe: null };

    case "SUBMIT": {
      if (state.step !== "server" && state.step !== "result") return state;
      const v = validateServer(state.server || ctx.defaultServer || "");
      if (!v.ok) return { ...state, error: v.error };
      const server = v.value || ctx.defaultServer;
      if (!server) return { ...state, error: "format" };
      return { ...state, step: "checking", server, error: "", probe: null };
    }
    case "RETRY":
      if (state.step === "result") return { ...state, step: "checking", probe: null };
      if (state.step === "auth" && state.auth && state.auth.state !== "waiting") return { ...state, auth: { state: "waiting" } };
      return state;

    case "PROBE_OK":
      if (state.step !== "checking") return state;
      return { ...state, step: "result", probe: ev.office ? { ok: true, name: ev.name || "WorkSuite" } : { old: true, name: ev.name || "WorkSuite" } };

    case "PROBE_FAIL":
      if (state.step !== "checking") return state;
      return { ...state, step: "result", probe: { error: ev.message || "" } };

    case "CONTINUE": {
      if (state.step !== "result" || !(state.probe && state.probe.ok)) return state;
      const desktop = (ctx.desktop || []).filter((d) => d.server === state.server);
      return { ...state, step: "choose", desktop };
    }
    case "CHOOSE_DESKTOP": {
      if (state.step !== "choose") return state;
      const id = ev.account.server + "|" + ev.account.user.id;
      const here = (ctx.accounts || []).find((a) => a.id === id);
      if (here && !here.signedOut) return { ...state, step: "done", duplicate: id, account: here };
      return { ...state, step: "auth", via: "desktop", pick: ev.account, auth: { state: "waiting" } };
    }
    case "CHOOSE_BROWSER":
      if (state.step !== "choose") return state;
      return { ...state, step: "auth", via: "browser", pick: null, auth: { state: "waiting" } };

    case "AUTH_TIMEOUT":
      if (state.step !== "auth") return state;
      return { ...state, auth: { state: "timeout" } };

    case "AUTH_ERROR":
      if (state.step !== "auth") return state;
      return { ...state, auth: { state: "error", message: ev.message || "" } };

    case "CANCEL":
      if (state.step === "auth") return { ...state, step: "choose", auth: null, via: null, pick: null };
      return state;

    case "SIGNED_IN":
      if (state.step !== "auth") return state;
      return { ...state, step: "verify", account: ev.account, duplicate: ev.existed ? ev.account.id : null };

    case "VERIFY_OK":
      if (state.step !== "verify") return state;
      return { ...state, step: "done", orgs: ev.orgs || [] };

    case "VERIFY_FAIL":
      if (state.step !== "verify") return state;
      return { ...state, step: "done", orgs: null, warning: ev.message || "" };

    case "BACK":
      switch (state.step) {
        case "result":
        case "checking":
          return { ...state, step: "server", probe: null };
        case "choose":
          return { ...state, step: "result" };
        case "auth":
          return { ...state, step: "choose", auth: null, via: null, pick: null };
        default:
          return state;
      }
    default:
      return state;
  }
}
