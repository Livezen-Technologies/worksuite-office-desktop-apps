import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { NEW_APPS, appById, appRoute, appTextKeys } from "./new-apps.js";

const lang = readFileSync(new URL("./lang.js", import.meta.url), "utf-8");
const svg = (name) => new URL(`../../res/img/common-svg/ws-${name}.svg`, import.meta.url);

test("the two apps, each with its route", () => {
  assert.deepEqual(NEW_APPS.map((a) => a.id), ["project", "diagram"]);
  assert.equal(appRoute("project"), "/apps/project");
  assert.equal(appRoute("diagram"), "/apps/diagram");
  assert.throws(() => appRoute("../settings"));
  assert.equal(appById("nope"), null);
});

test("each app: one stage available now, then the one being built, in order", () => {
  for (const a of NEW_APPS) {
    assert.deepEqual(a.stages.map((s) => s.id), a.stages.map((_, i) => i + 1), a.id);
    assert.equal(a.stages.filter((s) => s.status === "now").length, 1, a.id);
    assert.equal(a.stages[0].status, "now", a.id);
    assert.equal(a.stages.filter((s) => s.status === "next").length, 1, a.id);
    assert.ok(a.stages.every((s) => ["now", "next", "later"].includes(s.status)), a.id);
  }
});

test("only Diagram opens files today (Visio drawings, in the diagram viewer)", () => {
  assert.equal(appById("diagram").opens, true);
  assert.ok(!appById("project").opens);
});

test("every text has English and every icon a symbol", () => {
  for (const k of [...appTextKeys(), "wsaProjectIntro", "wsaDiagramIntro", "wsaOpenVisio", "wsaStage", "wsaBack"]) {
    assert.match(lang, new RegExp(`\\n\\s+${k}: '`), k);
  }
  for (const a of NEW_APPS) assert.ok(existsSync(svg(a.icon)), a.icon);
});

test("Home's quick actions show both apps and open their pages", () => {
  const cards = readFileSync(new URL("../routes/home/components/CreateCards.jsx", import.meta.url), "utf-8");
  assert.match(cards, /NEW_APPS\.map/);
  assert.match(cards, /navigate\(k\.page\)/);
  const app = readFileSync(new URL("../app.jsx", import.meta.url), "utf-8");
  assert.match(app, /path: "\/apps\/:id"/);
});

test("Home keeps the PDF editor card, opening a PDF through the Open dialog", () => {
  const cards = readFileSync(new URL("../routes/home/components/CreateCards.jsx", import.meta.url), "utf-8");
  assert.match(cards, /\{ id: "pdf", label: L\.wshPdfEditor, ext: L\.wshPdfEditorHint, icon: "pdf", open: true \}/);
  assert.ok(existsSync(svg("pdf")));
});
