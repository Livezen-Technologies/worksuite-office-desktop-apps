import test from "node:test";
import assert from "node:assert/strict";
import { isOnline, onNetChange, reportNetwork, setBrowserOnline, shouldTry, noteFailure, RETRY_AFTER_MS, _test } from "./net-state.js";

test("a failed request marks the app offline and a success brings it back", () => {
  _test.reset();
  const seen = [];
  onNetChange((v) => seen.push(v));
  noteFailure(1000);
  assert.equal(isOnline(), false);
  reportNetwork(true);
  assert.equal(isOnline(), true);
  assert.deepEqual(seen, [false, true]);
});

test("offline requests fail fast until the retry window passes", () => {
  _test.reset();
  noteFailure(1000);
  assert.equal(shouldTry(1000 + 10), false);
  assert.equal(shouldTry(1000 + RETRY_AFTER_MS), true);
});

test("no network adapter: never try", () => {
  _test.reset();
  setBrowserOnline(false);
  assert.equal(shouldTry(10 ** 12), false);
  setBrowserOnline(true);
  assert.equal(isOnline(), true);
});
