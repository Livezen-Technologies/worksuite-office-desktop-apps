import { test } from "node:test";
import assert from "node:assert/strict";
import { validateServer, accountStatus, updatePhase, mergeAccounts, filterAccounts, nextIndex } from "./settings-logic.js";

test("server addresses: hosts and https URLs pass, http and junk do not", () => {
  assert.deepEqual(validateServer("app.worksuite.lk"), { ok: true, value: "https://app.worksuite.lk" });
  assert.equal(validateServer("https://Drive.Example.com:8443/").value, "https://drive.example.com:8443");
  assert.equal(validateServer("localhost:3000").ok, true);
  assert.equal(validateServer("").empty, true);
  assert.equal(validateServer("http://a.example").error, "https");
  assert.equal(validateServer("ftp://a.example").error, "https");
  assert.equal(validateServer("not a host").error, "format");
  assert.equal(validateServer("intranet").error, "format");
  assert.equal(validateServer("a.example:99999").error, "format");
});

test("account status: listed + signedOut means the session expired", () => {
  assert.equal(accountStatus({ signedOut: false }), "signed-in");
  assert.equal(accountStatus({ signedOut: true }), "expired");
  assert.equal(accountStatus({ desktopOnly: true }), "desktop");
  assert.equal(accountStatus(null), "none");
});

test("update phase from the native events", () => {
  assert.equal(updatePhase({ available: false }).phase, "unavailable");
  assert.equal(updatePhase({ available: true }).phase, "uptodate");
  assert.equal(updatePhase({ available: true, busy: true }).phase, "checking");
  assert.equal(updatePhase({ available: true }, { version: "10.1.4" }).phase, "ready");
  const d = updatePhase({ available: true }, null, { icon: "load", text: "Downloading new version 10.1.4 (42%)", button: { action: "abort" } });
  assert.equal(d.phase, "downloading");
  assert.equal(d.percent, 42);
  assert.equal(updatePhase({}, null, { icon: "error", text: "Failed" }).phase, "error");
  assert.equal(updatePhase({}, null, { icon: "lastcheck", text: "Update 10.2 available", button: { action: "download" } }).phase, "available");
  assert.equal(updatePhase({}, null, { icon: "success", button: { action: "install" } }).phase, "ready");
});

test("accounts known on this device, and the search over them", () => {
  const local = [{ id: "https://a|1", server: "https://a", user: { id: 1, name: "Alex Rico" }, signedOut: true }];
  const desk = [{ server: "https://a", user: { id: 1, name: "Alex Rico" } }, { server: "https://b", user: { id: 2, name: "Bo Lee", organization: "Livezen" } }];
  const all = mergeAccounts(local, desk);
  assert.equal(all.length, 2);
  assert.ok(all[0].desktop);
  assert.equal(all[1].desktopOnly, true);
  assert.deepEqual(filterAccounts(all, "livez").map((a) => a.user.name), ["Bo Lee"]);
  assert.equal(filterAccounts(all, "").length, 2);
});

test("arrow keys wrap", () => {
  assert.equal(nextIndex("ArrowRight", 2, 3), 0);
  assert.equal(nextIndex("ArrowLeft", 0, 3), 2);
  assert.equal(nextIndex("End", 0, 3), 2);
  assert.equal(nextIndex("a", 1, 3), 1);
});
