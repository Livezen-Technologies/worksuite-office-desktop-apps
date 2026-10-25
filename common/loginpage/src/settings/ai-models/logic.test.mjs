/* Settings › AI Models: page rules and the /v1 client against the mocked service. Run: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fitOf, recommendedProfile, normalizeAiPolicy, isApproved, installBlock, defaultOptions, currentDefaults,
  withoutCloud, offlineOnlyLocked, newInstall, reduceInstall, cardState, actionsFor, compareVersions, storageOf,
  evaluatedSi, diagnosticsReport, tasksOf, formatMB,
} from "./logic.js";
import { createAiClient } from "./api.js";
import { createMockService, MOCK_CATALOG } from "./mock.js";

const hw = { ramMB: 16384, gpus: [], recommendedProfile: "standard" };

test("fit badge: the catalog's own answer wins", () => {
  assert.equal(fitOf({ ramMB: 15000, fits: "yes" }, hw, null), "yes");
  assert.equal(fitOf({ ramMB: 100, fits: "no" }, hw, null), "no");
});

test("fit badge without one: by share of memory", () => {
  assert.equal(fitOf({ ramMB: 4000 }, hw), "yes");
  assert.equal(fitOf({ ramMB: 10000 }, hw), "tight");
  assert.equal(fitOf({ ramMB: 14000 }, hw), "no");
  assert.equal(fitOf({ ramMB: 4000 }, null), "yes");
});

test("fit badge: over the organisation's memory cap is too large", () => {
  const p = normalizeAiPolicy({ maxMemMB: 2048 });
  assert.equal(fitOf({ ramMB: 3400, fits: "yes" }, hw, p), "no");
  assert.equal(installBlock({ id: "x", ramMB: 3400, tasks: ["assistant"] }, p), "memoryCap");
});

test("recommended profile: the service's, else by memory", () => {
  assert.equal(recommendedProfile(hw), "standard");
  assert.equal(recommendedProfile({ ramMB: 4096 }), "lite");
  assert.equal(recommendedProfile({ ramMB: 16384, appleSilicon: true }), "advanced");
  assert.equal(recommendedProfile({ ramMB: 65536 }), "advanced");
});

test("policy: features left out are allowed; translate maps to translation", () => {
  const p = normalizeAiPolicy({ managed: true, features: { translate: false, suggestions: false } });
  assert.equal(p.managed, true);
  assert.equal(p.features.translation, false);
  assert.equal(p.features.suggestions, false);
  assert.equal(p.features.stt, true);
  assert.equal(p.cloudAllowed, true);
  assert.equal(p.allOff, false);
});

test("policy: the desktop's aiFunctions off locks everything", () => {
  const p = normalizeAiPolicy({}, { aiFunctions: "off" });
  assert.equal(p.allOff, true);
  assert.equal(p.cloudAllowed, false);
  assert.ok(Object.values(p.features).every((v) => v === false));
});

test("policy: approved models — an empty list approves everything", () => {
  assert.equal(isApproved({ id: "a" }, normalizeAiPolicy({ approvedModels: [] })), true);
  const p = normalizeAiPolicy({ approvedModels: ["a"] });
  assert.equal(isApproved({ id: "a" }, p), true);
  assert.equal(isApproved({ id: "b" }, p), false);
  assert.equal(isApproved({ id: "a", approved: false }, p), false);
  assert.equal(installBlock({ id: "b", tasks: ["stt"] }, p), "notApproved");
});

test("policy: a model whose every task is turned off can't be installed", () => {
  const p = normalizeAiPolicy({ features: { assistant: false } });
  assert.equal(installBlock({ id: "a", tasks: ["assistant"] }, p), "featureOff");
  assert.equal(installBlock({ id: "a", tasks: ["assistant", "correction"] }, p), null);
});

test("install blocked before download when the disk is short", () => {
  assert.equal(installBlock({ id: "a", sizeMB: 500, tasks: ["stt"] }, normalizeAiPolicy({}), 100), "disk");
});

test("defaults: Automatic, models declaring the task, Cloud only when allowed and not offline only", () => {
  const installed = [{ id: "w", tasks: ["stt"], state: "installed" }, { id: "q", tasks: ["assistant"], state: "active" }, { id: "f", tasks: ["stt"], state: "failed" }];
  const open = normalizeAiPolicy({});
  assert.deepEqual(defaultOptions("stt", installed, open, false).map((o) => o.value), ["auto", "w", "cloud"]);
  assert.deepEqual(defaultOptions("stt", installed, open, true).map((o) => o.value), ["auto", "w"]);
  assert.deepEqual(defaultOptions("stt", installed, normalizeAiPolicy({ cloudAllowed: false }), false).map((o) => o.value), ["auto", "w"]);
  assert.equal(offlineOnlyLocked(normalizeAiPolicy({ cloudAllowed: false })), true);
});

test("defaults: from isDefaultFor, cloud dropped when offline", () => {
  const d = currentDefaults([{ id: "w", isDefaultFor: ["stt"] }], { assistant: "cloud" });
  assert.equal(d.stt, "w");
  assert.equal(d.assistant, "cloud");
  assert.equal(d.tts, "auto");
  assert.equal(withoutCloud(d).assistant, "auto");
});

test("install state machine: queued → downloading → verifying → unpacking → installed", () => {
  let e = newInstall("m", "j1");
  assert.equal(e.state, "queued");
  e = reduceInstall(e, { type: "job", jobId: "j1", data: { state: "running", phase: "downloading", bytesDone: 50, bytesTotal: 200 } });
  assert.equal(e.state, "downloading");
  assert.equal(e.progress, 0.25);
  e = reduceInstall(e, { type: "job.progress", jobId: "j1", data: { phase: "downloading", progress: 60 } });
  assert.equal(e.progress, 0.6);
  e = reduceInstall(e, { type: "job", jobId: "j1", data: { phase: "verifying" } });
  assert.equal(e.state, "verifying");
  e = reduceInstall(e, { type: "job", jobId: "j1", data: { phase: "unpacking" } });
  assert.equal(e.state, "unpacking");
  e = reduceInstall(e, { type: "job", jobId: "j1", data: { phase: "ready", state: "done" } });
  assert.equal(e.state, "installed");
  assert.equal(e.progress, 1);
  const late = reduceInstall(e, { type: "job", jobId: "j1", data: { phase: "downloading" } });
  assert.equal(late.state, "installed");
});

test("install state machine: pause, resume, cancel, failure, other jobs ignored", () => {
  let e = reduceInstall(newInstall("m", "j1"), { type: "job", jobId: "j1", data: { phase: "downloading", progress: 0.3 } });
  assert.equal(reduceInstall(e, { type: "job", jobId: "j2", data: { state: "failed" } }), e);
  e = reduceInstall(e, { type: "job", jobId: "j1", data: { state: "paused" } });
  assert.equal(e.state, "paused");
  assert.equal(e.progress, 0.3);
  e = reduceInstall(e, { type: "job", jobId: "j1", data: { state: "running" } });
  assert.equal(e.state, "downloading");
  const failed = reduceInstall(e, { type: "job", jobId: "j1", data: { state: "failed", error: { code: "integrity_failed" } } });
  assert.equal(failed.state, "failed");
  assert.equal(failed.error, "integrity_failed");
  assert.deepEqual(actionsFor("failed"), ["retry", "uninstall"]);
  assert.equal(reduceInstall(e, { type: "job", jobId: "j1", data: { state: "cancelled" } }).state, "available");
  assert.equal(reduceInstall(e, { type: "model", data: { id: "m", state: "active" } }).state, "active");
  assert.equal(reduceInstall(e, { type: "model", data: { id: "other", state: "active" } }).state, "downloading");
});

test("card state: available, installed, active, update, in flight", () => {
  const c = { id: "m", version: "1.2.0" };
  assert.equal(cardState(c, null, null), "available");
  assert.equal(cardState(c, { id: "m", version: "1.2.0", state: "installed" }, null), "installed");
  assert.equal(cardState(c, { id: "m", version: "1.2.0", state: "active" }, null), "active");
  assert.equal(cardState(c, { id: "m", version: "1.0.0", state: "installed" }, null), "update");
  assert.equal(cardState(c, null, { state: "paused" }), "paused");
  assert.deepEqual(actionsFor("downloading"), ["pause", "cancel"]);
  assert.deepEqual(actionsFor("paused"), ["resume", "cancel"]);
  assert.deepEqual(actionsFor("active"), ["deactivate", "uninstall"]);
  assert.equal(compareVersions("1.10.0", "1.9.9"), 1);
});

test("storage, evaluation and the diagnostics report (no document text)", () => {
  const s = storageOf([{ sizeMB: 75, path: "C:\\Users\\a\\AppData\\Roaming\\WorkSuite\\ai\\models\\w\\1.0.0" }, { sizeMB: 25, path: "" }]);
  assert.equal(s.usedMB, 100);
  assert.equal(s.path, "C:\\Users\\a\\AppData\\Roaming\\WorkSuite\\ai");
  assert.deepEqual(evaluatedSi({ evaluated: { si: { wer: 0.31 } } }), { metric: "wer", value: 0.31 });
  assert.equal(evaluatedSi({}), null);
  const r = diagnosticsReport({ now: "t", info: { serviceVersion: "0.1", apiVersion: "1.3", profile: "lite" }, installed: [{ id: "w", version: "1", state: "active" }] });
  assert.match(r, /Service: 0\.1 \(API 1\.3\)/);
  assert.match(r, /Model: w 1 active/);
  assert.equal(formatMB(1536, "en_GB"), "1.5 GB");
  assert.equal(formatMB(75, "not a locale!"), "75 MB");
  assert.deepEqual(tasksOf({ tasks: ["translate", "stt"] }), ["translation", "stt"]);
});

test("client against the mocked service: auth header, install with progress events, pause/resume/cancel", async () => {
  const mock = createMockService({ tick: 0 });
  const seen = [];
  const spy = async (url, init) => {
    seen.push({ url, init });
    return mock.fetch(url, init);
  };
  const c = createAiClient(mock.endpoint, { fetch: spy, WebSocket: mock.WebSocket });
  const catalog = await c.catalog();
  assert.equal(catalog.length, MOCK_CATALOG.length);
  assert.equal(seen[0].init.headers.Authorization, "Bearer mock");

  const events = [];
  const stop = c.events((e) => events.push(e));
  const { jobId } = await c.install("whisper-small-q5");
  assert.ok(jobId);
  await c.pause("whisper-small-q5");
  assert.equal(events.at(-1).data.state, "paused");
  await c.cancel("whisper-small-q5", jobId);
  assert.equal(events.at(-1).data.state, "cancelled");
  stop();

  const before = await c.models();
  await c.uninstall("piper-en-amy");
  assert.equal((await c.models()).length, before.length - 1);
});

test("client: errors keep the service's code; a dead service is unreachable", async () => {
  const managed = createMockService({ policy: "managed", tick: 0 });
  const c = createAiClient(managed.endpoint, { fetch: managed.fetch });
  await assert.rejects(c.install("llama3.1-70b-q4"), (e) => e.code === "forbidden_by_policy" && e.status === 403);
  const p = normalizeAiPolicy(await c.policy());
  assert.equal(p.features.suggestions, false);
  assert.equal(offlineOnlyLocked(p), true);

  const down = createMockService({ state: "down" });
  await assert.rejects(createAiClient(down.endpoint, { fetch: down.fetch }).info(), (e) => e.code === "unreachable");
});

test("mock install runs to installed through the reducer", async () => {
  const mock = createMockService({ tick: 1 });
  const c = createAiClient(mock.endpoint, { fetch: mock.fetch, WebSocket: mock.WebSocket });
  let entry = null;
  const done = new Promise((resolve) => {
    c.events((ev) => {
      entry = reduceInstall(entry, ev);
      if (entry.state === "installed") resolve();
    });
  });
  const { jobId } = await c.install("whisper-small-q5");
  entry = newInstall("whisper-small-q5", jobId);
  await done;
  assert.ok((await c.models()).some((m) => m.id === "whisper-small-q5"));
});
