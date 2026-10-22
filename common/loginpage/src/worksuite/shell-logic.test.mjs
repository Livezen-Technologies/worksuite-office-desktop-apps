import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePolicy, cloudAllowed, offlineCopyName, reconcileOffline, parseReleaseNotes, policyBool } from "./shell-logic.js";

test("no policy: not managed, third-party clouds off by default (CLD-02)", () => {
  const p = normalizePolicy(null);
  assert.equal(p.managed, false);
  assert.equal(cloudAllowed(p, "dropbox"), false);
  assert.equal(cloudAllowed(p, "worksuite"), true);
});

test("registry strings, DWORDs and plist booleans read the same (ADM-01)", () => {
  assert.equal(policyBool("1"), true);
  assert.equal(policyBool(0), false);
  assert.equal(policyBool(true), true);
  assert.equal(policyBool(""), undefined);
  const p = normalizePolicy({ server: "office.livezen.lk/", allowOtherClouds: "1", updateChannel: "Stable", updateAuto: 1, usageReports: "0", aiFunctions: "worksuite", organization: "Livezen Technologies" });
  assert.equal(p.server, "https://office.livezen.lk");
  assert.equal(p.lockServer, true);
  assert.equal(p.updateChannel, "stable");
  assert.equal(p.locked.updateAuto, true);
  assert.equal(p.usageReports, false);
  assert.equal(p.managed, true);
  assert.equal(cloudAllowed(p, "box"), true);
});

test("empty MSI properties leave a value unset", () => {
  const p = normalizePolicy({ server: "", updateChannel: "", allowOtherClouds: "" });
  assert.equal(p.managed, false);
});

test("offline copy name (DOC-07)", () => {
  assert.equal(offlineCopyName("Q4 sales forecast.xlsx"), "Q4 sales forecast (your offline copy).xlsx");
  assert.equal(offlineCopyName("notes"), "notes (your offline copy)");
});

test("reconcile never overwrites a newer version (NFR-13)", () => {
  assert.equal(reconcileOffline(14, 14, true), "upload");
  assert.equal(reconcileOffline(14, 15, true), "choose");
  assert.equal(reconcileOffline(14, 15, false), "discard-local");
});

test("release notes sections", () => {
  const s = parseReleaseNotes("# 10.1.1\n\n## New Features\n- Windows **updates**\n\n## Bug Fixes\n- Fixed `x`\n## Known Issues\n");
  assert.deepEqual(s, [{ title: "New Features", items: ["Windows updates"] }, { title: "Bug Fixes", items: ["Fixed x"] }]);
});
