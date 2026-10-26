import { test } from "node:test";
import assert from "node:assert/strict";
import { validateServer, accountStatus, accountActions, updatePhase, updateErrorKind, formatBytes, mergeAccounts, filterAccounts, nextIndex } from "./settings-logic.js";

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

test("update progress from Sparkle (macOS) and the app's own download (Windows)", () => {
  const u = { available: true, download: true };
  const mb = 1024 * 1024;
  // found: Download is the app's own ("ws-download"), with the size
  const f = updatePhase({ ...u, found: { version: "9.3.3", size: 250 * mb } });
  assert.deepEqual([f.phase, f.version, f.size, f.action], ["available", "9.3.3", 250 * mb, "ws-download"]);
  assert.equal(updatePhase({ available: true, found: { version: "9.3.3" } }).action, undefined);
  assert.equal(updatePhase(u, null, null, { state: "found", version: "9.3.4", total: 10 }).version, "9.3.4");
  // downloading: real percent and bytes, cancellable while the download runs
  const d = updatePhase(u, null, null, { state: "downloading", received: 50 * mb, total: 200 * mb, version: "9.3.3", cancellable: true });
  assert.deepEqual([d.phase, d.stage, d.percent, d.received, d.total, d.cancellable], ["downloading", "downloading", 25, 50 * mb, 200 * mb, true]);
  // no length from the server: an indeterminate bar
  assert.equal(updatePhase(u, null, null, { state: "downloading", received: 10, total: 0 }).percent, null);
  // never above 100, never cancellable once verifying / extracting
  assert.equal(updatePhase(u, null, null, { state: "downloading", received: 300, total: 200 }).percent, 100);
  const v = updatePhase(u, null, null, { state: "verifying", received: 200, total: 200, cancellable: true });
  assert.deepEqual([v.stage, v.percent, v.cancellable], ["verifying", 100, false]);
  const x = updatePhase(u, null, null, { state: "extracting", received: 500, total: 1000 });
  assert.deepEqual([x.stage, x.percent, x.received, x.total], ["extracting", 50, 0, 0]);
  assert.equal(updatePhase(u, null, null, { state: "installing" }).percent, null);
  // ready from the progress, or from "worksuite:update-ready"
  assert.deepEqual(updatePhase(u, null, null, { state: "ready", version: "9.3.3" }), { phase: "ready", version: "9.3.3" });
  assert.equal(updatePhase(u, { version: "9.3.3" }, null, { state: "downloading" }).phase, "ready");
  // a refused file and a failed download read differently
  const e = updatePhase(u, null, null, { state: "error", reason: "signature" });
  assert.deepEqual([e.phase, updateErrorKind(e.reason)], ["error", "refused"]);
  assert.equal(updateErrorKind("unsigned"), "refused");
  assert.equal(updateErrorKind("length"), "refused");
  assert.equal(updateErrorKind("network"), "failed");
  // idle: back to what the state says
  assert.equal(updatePhase(u, null, null, { state: "idle" }).phase, "uptodate");
  // progress while the state is not loaded yet
  assert.equal(updatePhase({ available: false }, null, null, { state: "downloading", received: 1, total: 2 }).phase, "downloading");
  // the Linux update service's text still works, and its Cancel is "abort"
  const l = updatePhase(u, null, { icon: "load", text: "Downloading (42%)", button: { action: "abort" } });
  assert.deepEqual([l.percent, l.cancellable, l.action], [42, true, "abort"]);
});

test("byte sizes for the progress line", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(1024 * 1024), "1 MB");
  assert.equal(formatBytes(52.4 * 1024 * 1024), "52.4 MB");
  assert.equal(formatBytes(250 * 1024 * 1024), "250 MB");
  assert.equal(formatBytes(-5), "0 B");
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

test("signed out by the person vs expired vs unreachable, and what each card offers", () => {
  assert.equal(accountStatus({ signedOut: true, signedOutBy: "user" }), "signed-out");
  assert.equal(accountStatus({ signedOut: false }, true), "unreachable");
  assert.deepEqual(accountActions({ signedOut: false }, { multiple: true }), { status: "signed-in", primary: null, menu: ["switch", "signout", "remove"] });
  assert.deepEqual(accountActions({ signedOut: false }, { multiple: true, isDefault: true }).menu, ["signout", "remove"]);
  assert.deepEqual(accountActions({ signedOut: true }), { status: "expired", primary: "reconnect", menu: ["remove"] });
  assert.deepEqual(accountActions({ signedOut: true, signedOutBy: "user" }), { status: "signed-out", primary: "signin", menu: ["remove"] });
  assert.deepEqual(accountActions({ desktopOnly: true }), { status: "desktop", primary: "connect", menu: [] });
  assert.equal(accountActions({ signedOut: false }, { unreachable: true }).primary, "reconnect");
});
