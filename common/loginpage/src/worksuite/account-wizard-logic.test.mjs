import { test } from "node:test";
import assert from "node:assert/strict";
import { initialWizard, wizardReducer, stepIndex } from "./account-wizard-logic.js";

const run = (s, evs, ctx) => evs.reduce((st, e) => wizardReducer(st, e, ctx), s);
const D = { server: "https://demo.worksuite.lk", user: { id: 7, name: "Alex" } };

test("server: invalid input stays on the step with an error; a host is normalised to https", () => {
  let s = run(initialWizard(), [{ type: "INPUT", value: "http://demo.worksuite.lk" }, { type: "SUBMIT" }]);
  assert.equal(s.step, "server");
  assert.equal(s.error, "https");
  s = run(s, [{ type: "INPUT", value: "Demo.WorkSuite.lk" }, { type: "SUBMIT" }]);
  assert.equal(s.step, "checking");
  assert.equal(s.server, "https://demo.worksuite.lk");
  assert.equal(stepIndex(s), 1);
});

test("empty server uses the default; a locked server cannot be edited", () => {
  const s = run(initialWizard(), [{ type: "SUBMIT" }], { defaultServer: "https://app.worksuite.lk" });
  assert.equal(s.server, "https://app.worksuite.lk");
  const l = run(initialWizard({ server: "https://corp.example", locked: true }), [{ type: "INPUT", value: "x" }]);
  assert.equal(l.server, "https://corp.example");
});

test("probe: ok continues, too old and unreachable do not, retry probes again", () => {
  const base = run(initialWizard(), [{ type: "INPUT", value: "demo.worksuite.lk" }, { type: "SUBMIT" }]);
  const old = wizardReducer(base, { type: "PROBE_OK", office: false });
  assert.equal(old.probe.old, true);
  assert.equal(wizardReducer(old, { type: "CONTINUE" }).step, "result");
  const down = wizardReducer(base, { type: "PROBE_FAIL", message: "No server" });
  assert.equal(down.probe.error, "No server");
  assert.equal(wizardReducer(down, { type: "RETRY" }).step, "checking");
  const ok = wizardReducer(base, { type: "PROBE_OK", office: true, name: "WorkSuite" });
  const choose = wizardReducer(ok, { type: "CONTINUE" }, { desktop: [D, { server: "https://other.lk", user: { id: 1 } }] });
  assert.equal(choose.step, "choose");
  assert.deepEqual(choose.desktop, [D]);
  assert.equal(stepIndex(choose), 3);
});

function atChoose(ctx) {
  return run(initialWizard(), [{ type: "INPUT", value: "demo.worksuite.lk" }, { type: "SUBMIT" }, { type: "PROBE_OK", office: true }, { type: "CONTINUE" }], ctx);
}

test("a Desktop account already signed in here is not added twice", () => {
  const ctx = { desktop: [D], accounts: [{ id: "https://demo.worksuite.lk|7", signedOut: false }] };
  const s = wizardReducer(atChoose(ctx), { type: "CHOOSE_DESKTOP", account: D }, ctx);
  assert.equal(s.step, "done");
  assert.equal(s.duplicate, "https://demo.worksuite.lk|7");
});

test("auth: waiting, timeout, error, retry, cancel back to choose", () => {
  let s = wizardReducer(atChoose({ desktop: [D] }), { type: "CHOOSE_DESKTOP", account: D }, { accounts: [] });
  assert.equal(s.step, "auth");
  assert.equal(s.via, "desktop");
  s = wizardReducer(s, { type: "AUTH_TIMEOUT" });
  assert.equal(s.auth.state, "timeout");
  s = wizardReducer(s, { type: "RETRY" });
  assert.equal(s.auth.state, "waiting");
  s = wizardReducer(s, { type: "AUTH_ERROR", message: "Network" });
  assert.equal(s.auth.message, "Network");
  s = wizardReducer(s, { type: "CANCEL" });
  assert.equal(s.step, "choose");
  assert.equal(s.via, null);
});

test("signed in → verify → done; a failed check is a warning, not a failure", () => {
  const acc = { id: "https://demo.worksuite.lk|9", user: { id: 9 } };
  let s = wizardReducer(atChoose(), { type: "CHOOSE_BROWSER" });
  s = wizardReducer(s, { type: "SIGNED_IN", account: acc, existed: false });
  assert.equal(s.step, "verify");
  assert.equal(stepIndex(s), 5);
  const ok = wizardReducer(s, { type: "VERIFY_OK", orgs: [{ id: 1, name: "Livezen" }] });
  assert.equal(ok.step, "done");
  assert.equal(ok.duplicate, null);
  const warn = wizardReducer(s, { type: "VERIFY_FAIL", message: "403" });
  assert.equal(warn.step, "done");
  assert.equal(warn.warning, "403");
  const again = wizardReducer(wizardReducer(atChoose(), { type: "CHOOSE_BROWSER" }), { type: "SIGNED_IN", account: acc, existed: true });
  assert.equal(again.duplicate, acc.id);
});

test("Back walks the steps; events out of place are ignored", () => {
  let s = wizardReducer(atChoose(), { type: "CHOOSE_BROWSER" });
  s = run(s, [{ type: "BACK" }, { type: "BACK" }, { type: "BACK" }]);
  assert.equal(s.step, "server");
  assert.equal(wizardReducer(s, { type: "SIGNED_IN", account: {} }).step, "server");
  assert.equal(wizardReducer(s, { type: "PROBE_OK", office: true }).step, "server");
});

test("WorkSuite Cloud: a Personal account skips the server, Back and Cancel return to it, a locked server never offers it", () => {
  const s = run(initialWizard(), [{ type: "INPUT", value: "demo.worksuite.lk" }, { type: "CHOOSE_CLOUD" }]);
  assert.equal(s.step, "auth");
  assert.equal(s.via, "cloud");
  assert.deepEqual(s.auth, { state: "waiting" });
  assert.equal(wizardReducer(s, { type: "BACK" }).step, "server");
  assert.equal(wizardReducer(s, { type: "CANCEL" }).step, "server");
  assert.equal(wizardReducer(s, { type: "CANCEL" }).server, "demo.worksuite.lk");
  const signed = wizardReducer(s, { type: "SIGNED_IN", account: { id: "https://t7.worksuitecloud.com|5" } });
  assert.equal(signed.step, "verify");
  assert.equal(wizardReducer(wizardReducer(s, { type: "AUTH_ERROR", message: "Still being set up" }), { type: "RETRY" }).auth.state, "waiting");
  assert.equal(run(initialWizard({ server: "https://corp.example", locked: true }), [{ type: "CHOOSE_CLOUD" }]).step, "server");
  assert.equal(wizardReducer(signed, { type: "CHOOSE_CLOUD" }).step, "verify");
});
