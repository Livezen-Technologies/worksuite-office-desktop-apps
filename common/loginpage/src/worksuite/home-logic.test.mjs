import test from "node:test";
import assert from "node:assert/strict";
import {
  typeOfExt, whenMs, filterFiles, sortFiles, nextSort, accountPanelState, reconnectStep, reconnectBusy,
  filterCompanies, placePopover, nextPage, selectWith, driveActions,
} from "./home-logic.js";

test("typeOfExt", () => {
  assert.equal(typeOfExt(".DOCX"), "word");
  assert.equal(typeOfExt("xlsx"), "cell");
  assert.equal(typeOfExt("pptx"), "slide");
  assert.equal(typeOfExt("pdf"), "pdf");
  assert.equal(typeOfExt("zip"), "other");
});

test("whenMs reads server, ISO, epoch and native dates", () => {
  assert.equal(whenMs(""), 0);
  assert.ok(whenMs("2026-10-20 10:00") > whenMs("2026-10-19 10:00"));
  assert.equal(whenMs(1700000000), 1700000000000);
  assert.equal(whenMs("20.10.2026 10:05"), new Date(2026, 9, 20, 10, 5).getTime());
});

const items = [
  { kind: "folder", name: "Reports", owner: "Ann", modified: "2026-01-01" },
  { kind: "file", name: "Budget.xlsx", ext: "xlsx", owner: "Zed", modified: "2026-10-01" },
  { kind: "file", name: "alpha.docx", ext: "docx", owner: "Bob", modified: "2026-09-01" },
  { kind: "file", name: "Deck.pptx", ext: "pptx", owner: "Ann", modified: "2026-10-05" },
];

test("filterFiles by query, type and source", () => {
  assert.deepEqual(filterFiles(items, { type: "word" }).map((i) => i.name), ["Reports", "alpha.docx"]);
  assert.deepEqual(filterFiles(items, { query: "BUD" }).map((i) => i.name), ["Budget.xlsx"]);
  const recents = [{ name: "a", ext: ".docx", islocal: true }, { name: "b", ext: ".docx", islocal: false }];
  assert.deepEqual(filterFiles(recents, { source: "cloud" }).map((i) => i.name), ["b"]);
  assert.deepEqual(filterFiles(recents, { source: "local" }).map((i) => i.name), ["a"]);
});

test("sortFiles keeps folders first and sorts by key", () => {
  assert.deepEqual(sortFiles(items, { key: "name", dir: "asc" }).map((i) => i.name), ["Reports", "alpha.docx", "Budget.xlsx", "Deck.pptx"]);
  assert.deepEqual(sortFiles(items, { key: "modified", dir: "desc" }).map((i) => i.name), ["Reports", "Deck.pptx", "Budget.xlsx", "alpha.docx"]);
  assert.deepEqual(sortFiles(items, { key: "owner", dir: "asc" }).map((i) => i.name), ["Reports", "Deck.pptx", "alpha.docx", "Budget.xlsx"]);
  assert.deepEqual(nextSort({ key: "name", dir: "asc" }, "name"), { key: "name", dir: "desc" });
  assert.deepEqual(nextSort({ key: "name", dir: "asc" }, "modified"), { key: "modified", dir: "desc" });
});

test("accountPanelState never shows an expired account as connected", () => {
  assert.equal(accountPanelState(null), "none");
  assert.equal(accountPanelState({ signedOut: false }), "connected");
  assert.equal(accountPanelState({ signedOut: true }), "expired");
  assert.equal(accountPanelState({ signedOut: true, signedOutBy: "user" }), "signed-out");
  assert.equal(accountPanelState({ desktopOnly: true }), "none");
});

test("reconnectStep: one sign-in at a time, success and failure paths", () => {
  let s = reconnectStep(undefined, { type: "start", id: "a" });
  assert.equal(s.phase, "refreshing");
  assert.ok(reconnectBusy(s));
  assert.equal(reconnectStep(s, { type: "start", id: "b" }), s, "second start is ignored while in flight");
  assert.equal(reconnectStep(s, { type: "ok" }).phase, "idle");
  s = reconnectStep(s, { type: "signin" });
  assert.equal(s.phase, "signing-in");
  assert.equal(reconnectStep(s, { type: "start" }), s);
  assert.deepEqual(reconnectStep(s, { type: "signedin" }), { phase: "idle", done: true, id: "a" });
  assert.equal(reconnectStep(s, { type: "cancel" }).phase, "idle");
  const e = reconnectStep({ phase: "refreshing", id: "a" }, { type: "unreachable", message: "down" });
  assert.equal(e.phase, "error");
  assert.equal(reconnectStep(e, { type: "start", id: "a" }).phase, "refreshing");
  assert.equal(reconnectStep({ phase: "idle" }, { type: "ok" }).phase, "idle");
});

test("filterCompanies lists only the given organisations", () => {
  const list = [{ id: 1, name: "CareMe" }, { id: 2, name: "Livezen" }, { name: "no id" }];
  assert.equal(filterCompanies(list, "").length, 2);
  assert.deepEqual(filterCompanies(list, "care").map((c) => c.id), [1]);
});

test("placePopover flips above and stays inside the viewport", () => {
  const vp = { width: 800, height: 600 };
  const below = placePopover({ top: 100, bottom: 130, left: 50, right: 150 }, { width: 200, height: 200 }, vp);
  assert.equal(below.placement, "bottom");
  assert.equal(below.top, 134);
  const above = placePopover({ top: 500, bottom: 530, left: 700, right: 780 }, { width: 200, height: 200 }, vp);
  assert.equal(above.placement, "top");
  assert.equal(above.top, 296);
  assert.equal(above.left, 592);
});

test("nextPage and selectWith", () => {
  assert.equal(nextPage(50, 88, 50), 88);
  const order = ["a", "b", "c", "d"];
  assert.deepEqual(selectWith([], "b", {}, order).selected, ["b"]);
  assert.deepEqual(selectWith(["b"], "d", { toggle: true }, order, "b").selected, ["b", "d"]);
  assert.deepEqual(selectWith(["b"], "d", { shift: true }, order, "b").selected, ["b", "c", "d"]);
  assert.deepEqual(selectWith(["b", "c"], "c", { toggle: true }, order, "b").selected, ["b"]);
});

test("driveActions follow access level and server features", () => {
  const view = driveActions({ kind: "file", level: "view" }, () => true);
  assert.ok(!view.includes("rename") && !view.includes("trash") && view.includes("request-edit"));
  const edit = driveActions({ kind: "file", level: "edit" }, (f) => f !== "files.share");
  assert.ok(edit.includes("trash") && !edit.includes("share"));
  assert.deepEqual(driveActions({ kind: "folder" }), ["open"]);
});
