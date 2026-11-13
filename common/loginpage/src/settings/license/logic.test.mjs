/* Settings › WorkSuite Office Pro: the pure license helpers. Run: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPro, proFeatures, grants, featureRows, planState, reasonKey, formatDate, cleanKey, FEATURE_ORDER,
} from "./logic.js";

const PRO = ["ocr", "pdf.sign", "convert", "assistant"];

test("isPro: only an active pro plan counts", () => {
  assert.equal(isPro({ plan: "pro", active: true }), true);
  assert.equal(isPro({ plan: "pro", active: false }), false);
  assert.equal(isPro({ plan: "free", active: true }), false);
  assert.equal(isPro(null), false);
});

test("proFeatures: known keys first in a fixed order, unknown keys kept after", () => {
  assert.deepEqual(proFeatures({ proFeatures: PRO }), ["assistant", "ocr", "pdf.sign", "convert"]);
  assert.deepEqual(proFeatures({ proFeatures: ["convert", "assistant"] }), ["assistant", "convert"]);
  assert.deepEqual(proFeatures({ proFeatures: ["ocr", "future.thing"] }), ["ocr", "future.thing"]);
  assert.deepEqual(proFeatures({}), []);
  assert.deepEqual(proFeatures(null), []);
});

test("grants: '*' covers everything, otherwise the exact key, and only when active", () => {
  assert.equal(grants({ plan: "pro", active: true, features: ["*"] }, "ocr"), true);
  assert.equal(grants({ plan: "pro", active: true, features: ["pdf.sign"] }, "pdf.sign"), true);
  assert.equal(grants({ plan: "pro", active: true, features: ["pdf.sign"] }, "ocr"), false);
  assert.equal(grants({ plan: "pro", active: false, features: ["*"] }, "ocr"), false);
  assert.equal(grants({ plan: "free", active: true, features: [] }, "ocr"), false);
});

test("featureRows: one row per Pro feature with whether it is unlocked", () => {
  const free = featureRows({ plan: "free", active: true, features: [], proFeatures: PRO });
  assert.equal(free.length, 4);
  assert.ok(free.every((r) => r.granted === false));

  const pro = featureRows({ plan: "pro", active: true, features: ["*"], proFeatures: PRO });
  assert.ok(pro.every((r) => r.granted === true));

  const scoped = featureRows({ plan: "pro", active: true, features: ["ocr"], proFeatures: PRO });
  assert.equal(scoped.find((r) => r.key === "ocr").granted, true);
  assert.equal(scoped.find((r) => r.key === "convert").granted, false);
});

test("planState: free, pro, lapsed and unknown", () => {
  assert.equal(planState(null), "unknown");
  assert.equal(planState({ plan: "free", active: true }), "free");
  assert.equal(planState({ plan: "pro", active: true }), "pro");
  assert.equal(planState({ plan: "free", active: false, reason: "expired" }), "lapsed");
  assert.equal(planState({ plan: "free", active: false, reason: "grace_expired" }), "lapsed");
});

test("reasonKey: maps service reasons to string keys", () => {
  assert.equal(reasonKey({ reason: "expired" }), "reasonExpired");
  assert.equal(reasonKey({ reason: "revoked" }), "reasonRevoked");
  assert.equal(reasonKey({ reason: "grace_expired" }), "reasonGraceExpired");
  assert.equal(reasonKey({ reason: "wrong_device" }), "reasonWrongDevice");
  assert.equal(reasonKey({ reason: "bad_signature" }), "reasonBadSignature");
  assert.equal(reasonKey({ reason: "something_else" }), "reasonGeneric");
  assert.equal(reasonKey({}), "");
});

test("formatDate: ISO to yyyy-mm-dd, empty for missing/bad", () => {
  assert.equal(formatDate("2027-11-13T00:00:00Z").length, 10);
  assert.match(formatDate("2027-11-13T00:00:00Z"), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(formatDate(null), "");
  assert.equal(formatDate(""), "");
  assert.equal(formatDate("not a date"), "");
});

test("cleanKey: trims; empty when nothing usable", () => {
  assert.equal(cleanKey("  abc  "), "abc");
  assert.equal(cleanKey(""), "");
  assert.equal(cleanKey(null), "");
  assert.equal(cleanKey(undefined), "");
});

test("FEATURE_ORDER lists the shipped Pro keys", () => {
  for (const k of PRO) assert.ok(FEATURE_ORDER.includes(k), `${k} ordered`);
});
