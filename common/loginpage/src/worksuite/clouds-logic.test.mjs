import test from "node:test";
import assert from "node:assert/strict";
import {
  browserState, breadcrumbs, driveCacheKey, isKeyOf, capsOf, itemActions, canAddTo, commonActions, canDropOn, patchRows,
  sharingOf, formatBytes, resizeColumn, readWidths, uploadStep, nextUploads, uploadSummary, chunksOf,
} from "./clouds-logic.js";

const labels = { drive: "My Drive", trash: "Trash", recent: "Recent" };

test("breadcrumbs: root, the server's trail, the current folder last", () => {
  const c = breadcrumbs("drive", [{ id: 4, name: "Finance" }, { id: 9, name: "2026" }], labels);
  assert.deepEqual(c.map((x) => x.name), ["My Drive", "Finance", "2026"]);
  assert.deepEqual(c.map((x) => x.current), [false, false, true]);
  assert.equal(c[0].id, null);
});

test("breadcrumbs: other views have only their root; bad entries are skipped", () => {
  assert.deepEqual(breadcrumbs("trash", [{ id: 1, name: "x" }], labels).map((x) => x.name), ["Trash"]);
  assert.deepEqual(breadcrumbs("drive", [null, { name: "no id" }, { id: 2, name: "B" }], labels).map((x) => x.name), ["My Drive", "B"]);
  assert.equal(breadcrumbs("drive", [], labels)[0].current, true);
});

test("breadcrumbs: a long trail is shortened with the hidden folders kept", () => {
  const trail = [1, 2, 3, 4, 5, 6].map((i) => ({ id: i, name: "F" + i }));
  const c = breadcrumbs("drive", trail, labels, 2);
  assert.deepEqual(c.map((x) => x.name), ["My Drive", "F1", "…", "F5", "F6"]);
  assert.deepEqual(c[2].hidden.map((x) => x.id), [2, 3, 4]);
});

test("driveCacheKey keeps accounts, servers, organisations and places apart", () => {
  const base = { server: "https://a.example", user: 7, org: 3, view: "drive", folder: 12 };
  const k = driveCacheKey(base);
  assert.notEqual(k, driveCacheKey({ ...base, org: 4 }));
  assert.notEqual(k, driveCacheKey({ ...base, org: null }));
  assert.notEqual(k, driveCacheKey({ ...base, server: "https://b.example" }));
  assert.notEqual(k, driveCacheKey({ ...base, user: 8 }));
  assert.notEqual(k, driveCacheKey({ ...base, folder: 13 }));
  assert.notEqual(k, driveCacheKey({ ...base, view: "trash" }));
  assert.notEqual(k, driveCacheKey({ ...base, page: 2 }));
  assert.equal(k, driveCacheKey({ ...base }));
  assert.equal(driveCacheKey({ ...base, folder: null }), driveCacheKey({ ...base, folder: "" }));
  // an organisation id cannot pose as a different place
  assert.notEqual(driveCacheKey({ ...base, org: "3|drive" }), k);
  assert.ok(isKeyOf(k, "https://a.example", 7));
  assert.ok(!isKeyOf(k, "https://a.example", 70));
});

test("capsOf: the server's capabilities, else the access level", () => {
  assert.deepEqual(capsOf({ access: { capabilities: ["open"] } }), ["open"]);
  assert.ok(!capsOf({ level: "view" }).includes("rename"));
  assert.ok(capsOf({ level: "edit" }).includes("rename"));
  assert.ok(!capsOf({ level: "edit" }).includes("delete"));
  assert.ok(capsOf({ access: { level: "full" } }).includes("share"));
});

test("itemActions: gated on capabilities, features, view and connection", () => {
  const full = { kind: "file", ext: "docx", access: { capabilities: ["open", "preview", "download", "edit", "rename", "share", "move", "delete", "restore"] } };
  const a = itemActions(full, { online: true });
  ["open", "download", "rename", "move", "copy", "share", "star", "details", "trash", "versions"].forEach((x) => assert.ok(a.includes(x), x));
  assert.ok(!a.includes("request-edit"));
  assert.ok(!a.includes("preview"), "preview is for PDFs");
  assert.ok(itemActions({ ...full, ext: "pdf" }, {}).includes("preview"));

  const viewer = { kind: "file", ext: "xlsx", access: { capabilities: ["open", "preview"] } };
  const v = itemActions(viewer, {});
  assert.ok(!v.includes("download"), "files.download refused by the organisation");
  assert.ok(!v.includes("rename") && !v.includes("trash") && !v.includes("share"));
  assert.ok(v.includes("request-edit"));

  assert.ok(!itemActions(full, { has: (f) => f !== "files.share" }).includes("share"));
  assert.deepEqual(itemActions(full, { online: false }), ["open", "details"]);
  assert.deepEqual(itemActions(full, { view: "trash" }), ["restore", "purge"]);
  assert.deepEqual(itemActions({ ...full, access: { capabilities: ["restore"] } }, { view: "trash" }), ["restore"]);
  assert.deepEqual(itemActions(full, { view: "trash", online: false }), []);
  assert.ok(!itemActions({ kind: "file", ext: "zip", access: { capabilities: ["open", "download"] } }, {}).includes("open"), "not an editor file");
  assert.ok(itemActions({ kind: "folder", access: { capabilities: ["open", "rename"] } }, {}).includes("rename"));
});

test("canAddTo, commonActions and canDropOn", () => {
  assert.ok(canAddTo(null, "drive"));
  assert.ok(!canAddTo(null, "recent"));
  assert.ok(!canAddTo({ capabilities: ["open"] }, "drive"));
  assert.ok(canAddTo({ capabilities: ["add_files"] }, "drive"));
  const mover = { kind: "file", id: 1, ext: "docx", access: { capabilities: ["open", "move", "delete"] } };
  const reader = { kind: "file", id: 2, ext: "docx", access: { capabilities: ["open"] } };
  assert.ok(commonActions([mover, mover], {}).includes("trash"));
  assert.ok(!commonActions([mover, reader], {}).includes("trash"));
  const folder = { kind: "folder", id: 5, access: { capabilities: ["open", "add_files", "move"] } };
  assert.ok(canDropOn([mover], folder, {}));
  assert.ok(!canDropOn([reader], folder, {}));
  assert.ok(!canDropOn([folder], folder, {}), "not into itself");
  assert.ok(!canDropOn([mover], { kind: "folder", id: 6, access: { capabilities: ["open"] } }, {}));
});

test("patchRows replaces, removes and adds only the affected rows", () => {
  const rows = [{ kind: "file", id: 1, name: "a" }, { kind: "folder", id: 1, name: "f" }, { kind: "file", id: 2, name: "b" }];
  const out = patchRows(rows, { updated: [{ kind: "file", id: 2, name: "B" }], removed: [{ kind: "file", id: 1 }], added: [{ kind: "file", id: 3, name: "c" }] });
  assert.deepEqual(out.map((r) => r.kind + r.id + r.name), ["folder1f", "file2B", "file3c"]);
  assert.equal(out[0], rows[1], "untouched rows keep their identity");
});

test("sharingOf and formatBytes", () => {
  assert.equal(sharingOf({ shared: true, access: { owner: true } }), "shared");
  assert.equal(sharingOf({ shared: false, access: { owner: true } }), "private");
  assert.equal(sharingOf({ access: { owner: false } }), "with-me");
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5 MB");
  assert.equal(formatBytes(-1), "");
});

test("resizeColumn and readWidths keep widths in range", () => {
  const w = readWidths(null);
  assert.equal(w.name, 360);
  assert.equal(resizeColumn(w, "name", -1000).name, 180);
  assert.equal(resizeColumn(w, "size", 30).size, 120);
  assert.deepEqual(resizeColumn(w, "nope", 10), w);
  assert.equal(readWidths('{"name":250,"size":5,"x":3}').name, 250);
  assert.equal(readWidths('{"name":250,"size":5}').size, 90);
  assert.equal(readWidths("not json").owner, 150);
});

test("upload queue: add, start in turn, progress, finish, fail, retry, cancel, clear", () => {
  let q = uploadStep([], { type: "add", files: [{ id: "a", name: "a.docx", size: 100 }, { id: "b", name: "b.pdf", size: 300 }, { id: "c", name: "c.xlsx", size: 100 }] });
  q = uploadStep(q, { type: "add", files: [{ id: "a", name: "dupe", size: 1 }] });
  assert.equal(q.length, 3);
  assert.deepEqual(nextUploads(q, 2), ["a", "b"]);
  q = uploadStep(q, { type: "start", id: "a" });
  q = uploadStep(q, { type: "start", id: "b" });
  assert.deepEqual(nextUploads(q, 2), []);
  q = uploadStep(q, { type: "progress", id: "a", sent: 50 });
  q = uploadStep(q, { type: "progress", id: "a", sent: 20 });
  assert.equal(q[0].sent, 50, "progress never goes back");
  q = uploadStep(q, { type: "progress", id: "b", sent: 9999 });
  assert.equal(q[1].sent, 300);
  assert.equal(uploadSummary(q).percent, 70);
  q = uploadStep(q, { type: "finishing", id: "a" });
  q = uploadStep(q, { type: "done", id: "a", file: { id: 9 } });
  q = uploadStep(q, { type: "fail", id: "b", error: "Quota" });
  assert.deepEqual(nextUploads(q, 2), ["c"]);
  let s = uploadSummary(q);
  assert.deepEqual([s.done, s.failed, s.active], [1, 1, 1]);
  q = uploadStep(q, { type: "retry", id: "b" });
  assert.equal(q[1].state, "queued");
  assert.equal(q[1].sent, 0);
  q = uploadStep(q, { type: "cancel", id: "c" });
  q = uploadStep(q, { type: "done", id: "c" });
  assert.equal(q[2].state, "cancelled", "a cancelled upload stays cancelled");
  q = uploadStep(q, { type: "cancel", id: "a" });
  assert.equal(q[0].state, "done", "a finished upload cannot be cancelled");
  q = uploadStep(q, { type: "clear" });
  assert.deepEqual(q.map((u) => u.id), ["b"]);
});

test("chunksOf splits a file into the server's parts", () => {
  assert.deepEqual(chunksOf(0, 10), [{ index: 0, start: 0, end: 0 }]);
  assert.deepEqual(chunksOf(25, 10).map((c) => [c.start, c.end]), [[0, 10], [10, 20], [20, 25]]);
});

test("browserState", () => {
  assert.equal(browserState({}), "not-connected");
  assert.equal(browserState({ connecting: true }), "connecting");
  const a = { account: {}, online: true };
  assert.equal(browserState({ ...a, expired: true }), "expired");
  assert.equal(browserState({ ...a, needsOrg: true }), "choose-org");
  assert.equal(browserState({ ...a, error: "denied" }), "denied");
  assert.equal(browserState({ ...a, online: false, hasData: true }), "offline");
  assert.equal(browserState({ ...a, online: false }), "offline-empty");
  assert.equal(browserState({ ...a, error: "x" }), "error");
  assert.equal(browserState({ ...a, error: "x", hasData: true }), "stale");
  assert.equal(browserState({ ...a }), "loading");
  assert.equal(browserState({ ...a, hasData: true, empty: true }), "empty");
  assert.equal(browserState({ ...a, hasData: true }), "list");
});
