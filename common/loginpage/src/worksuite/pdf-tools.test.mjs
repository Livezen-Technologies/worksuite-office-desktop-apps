import test from "node:test";
import assert from "node:assert/strict";
import { PDF_TASK_KEY, PDF_TASK_TTL_MS, PDF_TOOLS, actionOfCard, isPdfAction, makePdfTask, readPdfTask, startPdfTool } from "./pdf-tools.js";

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

test("the three tools and their cards", () => {
  assert.deepEqual(PDF_TOOLS.map((t) => t.action), ["merge", "split", "extract"]);
  assert.equal(actionOfCard("merge-pdf"), "merge");
  assert.equal(actionOfCard("split-pdf"), "split");
  assert.equal(actionOfCard("extract-pdf-pages"), "extract");
  assert.equal(actionOfCard("compress-pdf"), "");
  assert.ok(isPdfAction("split"));
  assert.ok(!isPdfAction("compress"));
});

test("makePdfTask refuses an unknown tool", () => {
  assert.deepEqual(makePdfTask("merge", 5), { v: 1, action: "merge", at: 5 });
  assert.throws(() => makePdfTask("protect", 5));
});

test("readPdfTask takes only a fresh, well-formed task", () => {
  const raw = JSON.stringify(makePdfTask("extract", 1000));
  assert.equal(readPdfTask(raw, 1000).action, "extract");
  assert.equal(readPdfTask(raw, 1000 + PDF_TASK_TTL_MS).action, "extract");
  assert.equal(readPdfTask(raw, 1001 + PDF_TASK_TTL_MS), null);
  assert.equal(readPdfTask(raw, 999), null);
  assert.equal(readPdfTask("", 1000), null);
  assert.equal(readPdfTask("{bad", 1000), null);
  assert.equal(readPdfTask(JSON.stringify({ v: 2, action: "merge", at: 1000 }), 1000), null);
  assert.equal(readPdfTask(JSON.stringify({ v: 1, action: "compress", at: 1000 }), 1000), null);
  assert.equal(readPdfTask(JSON.stringify({ v: 1, action: "merge", at: "1000" }), 1000), null);
});

test("startPdfTool notes the task, then opens the Open dialog", () => {
  const storage = memoryStorage();
  const calls = [];
  const ok = startPdfTool("split", { storage, now: () => 42, command: (n, p) => calls.push([n, p, storage.getItem(PDF_TASK_KEY)]) });
  assert.equal(ok, true);
  assert.deepEqual(calls, [["open:folder", "", JSON.stringify({ v: 1, action: "split", at: 42 })]]);
});

test("startPdfTool does not open the dialog when the task cannot be noted", () => {
  const calls = [];
  const storage = { setItem: () => { throw new Error("quota"); } };
  assert.equal(startPdfTool("merge", { storage, now: () => 1, command: () => calls.push(1) }), false);
  assert.deepEqual(calls, []);
});

test("the AI Tools cards of the three tools carry their action; the other cards stay prompts", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const dir = new URL("../routes/aitools/cards/", import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    const card = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
    assert.equal(card.action ?? "", actionOfCard(card.id), f);
    assert.ok(card.prompt, f);
  }
});
