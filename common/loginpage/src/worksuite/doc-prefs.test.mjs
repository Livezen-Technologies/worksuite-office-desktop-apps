/*
 * Settings › General and Settings › WorkSuite › Document Preferences show the same document options: one
 * definition (doc-prefs.js), one store (the persisted `settings` store), one Apply ("settings:apply").
 * These tests hold that together: a change on one page is the value the other page reads, invalid values
 * change nothing, and Apply sends what either page set.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createStore } from "solid-js/store";
import { DOC_PREFS, docPrefOptions, readDocPrefs, setDocPref, docPrefsPayload } from "./doc-prefs.js";

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const t = (k) => "[" + k + "]";

// the app's store: stores/settings.js is createStore(defaults) behind makePersisted
const fresh = () => createStore({ launchMode: "tab", spellCheck: "auto", theme: "theme-white", scaling: "auto" });

test("a change in Document Preferences is what General shows, and the reverse", () => {
  const [settings, setSettings] = fresh();
  // Document Preferences sets "Open documents in" → General's Select reads the same field
  assert.equal(setDocPref(setSettings, "launchMode", "window"), true);
  assert.equal(settings.launchMode, "window");
  assert.deepEqual(readDocPrefs(settings), { launchMode: "window", spellCheck: "auto" });
  // General sets spell checking → Document Preferences reads it
  assert.equal(setDocPref(setSettings, "spellCheck", "disabled"), true);
  assert.deepEqual(readDocPrefs(settings), { launchMode: "window", spellCheck: "disabled" });
});

test("unknown values and other settings are not written through it", () => {
  const [settings, setSettings] = fresh();
  assert.equal(setDocPref(setSettings, "launchMode", "popup"), false);
  assert.equal(setDocPref(setSettings, "theme", "theme-night"), false);
  assert.equal(setDocPref(setSettings, "spellCheck", undefined), false);
  assert.deepEqual(readDocPrefs(settings), { launchMode: "tab", spellCheck: "auto" });
  assert.equal(settings.theme, "theme-white");
});

test("Apply sends what either page set, in General's format", () => {
  const [settings, setSettings] = fresh();
  assert.deepEqual(docPrefsPayload(settings), { editorwindowmode: false, spellcheckdetect: "auto" });
  setDocPref(setSettings, "launchMode", "window");
  setDocPref(setSettings, "spellCheck", "enabled");
  assert.deepEqual(docPrefsPayload(settings), { editorwindowmode: true, spellcheckdetect: "enabled" });
});

test("both pages offer the same options, from one list", () => {
  assert.deepEqual(DOC_PREFS.map((p) => p.key), ["launchMode", "spellCheck"]);
  assert.deepEqual(docPrefOptions("launchMode", t), [{ value: "tab", label: "[settOptLaunchInTab]" }, { value: "window", label: "[settOptLaunchInWindow]" }]);
  assert.deepEqual(docPrefOptions("spellCheck", t).map((o) => o.value), ["auto", "enabled", "disabled"]);
  assert.deepEqual(docPrefOptions("nope", t), []);
});

test("General, Document Preferences and Apply all go through doc-prefs.js (no second copy of the values)", () => {
  const general = readFileSync(path.join(src, "routes/settings/general/index.jsx"), "utf8");
  const ws = readFileSync(path.join(src, "routes/settings/worksuite/index.jsx"), "utf8");
  const sync = readFileSync(path.join(src, "services/settings-sync.js"), "utf8");
  for (const page of [general, ws]) {
    assert.match(page, /from "@\/worksuite\/doc-prefs\.js"/);
    assert.match(page, /setDocPref\(setSettings, /);
    assert.match(page, /from "@\/stores\/settings"/);
    assert.doesNotMatch(page, /setSettings\("(launchMode|spellCheck)"/);
    assert.doesNotMatch(page, /localStorage/);
  }
  // the WorkSuite page applies with General's own action
  assert.match(ws, /applySettings/);
  assert.match(ws, /from "@\/services\/settings-sync"/);
  assert.match(sync, /\.\.\.docPrefsPayload\(settings\)/);
});
