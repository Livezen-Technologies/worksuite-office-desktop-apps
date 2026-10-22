/*
 * WorkSuite client (src/worksuite/core.js) under node:test, with the page's globals faked:
 * worksuiteoffice://open contract v1 (LNK-04/05), company scoping (DRV-11).
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
Object.defineProperty(localStorage, "keys", { value: () => Object.keys(store) });
globalThis.window = globalThis;
globalThis.l10n = {};
const calls = [];
globalThis.fetch = async (url, opts) => {
  calls.push({ url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : undefined });
  const data = url.includes("/sharing/companies") ? { companies: [{ id: 7, name: "Livezen" }, { id: 9, name: "TechHubiz" }] }
    : url.includes("/versions") ? { current: { version: 3, author: "You", made_at: "2026-10-22 19:40:00" },
                                    history: [{ id: 11, version: 2, author: "Nimali", made_at: "2026-10-22 11:12:00", client: "web" }] }
    : url.includes("/api/drive/list") ? { files: [{ id: 1, name: "a.docx", org_id: 7 }, { id: 2, name: "b.xlsx", org_id: 9 }, { id: 3, name: "c.pptx" }] }
    : {};
  return { status: 200, text: async () => JSON.stringify({ status: "ok", data }) };
};

const out = path.join(root, "test", ".core.bundle.mjs");
await build({
  entryPoints: [path.join(root, "src/worksuite/core.js")],
  bundle: true, format: "esm", platform: "neutral", outfile: out, logLevel: "error",
  alias: { "@": path.join(root, "src") },
  plugins: [{ name: "stub", setup(b) {
    b.onResolve({ filter: /sdk\/bridge\.js$|services\/l10n/ }, (a) => ({ path: a.path, namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({ contents: a.path.includes("l10n") ? "export const t = (k, d) => d;" : "" }));
  } }],
});
await import(out);
const WS = window.WorkSuite;

const account = { id: "https://app.worksuite.lk|3", server: "https://app.worksuite.lk", user: { id: 3, name: "H" } };
localStorage.setItem("ws:accounts", JSON.stringify([account]));

test("contract v1 Drive link: v, uid, org, mode", () => {
  const l = WS._parseOpenLink("worksuiteoffice://open?v=1&server=https%3A%2F%2Fapp.worksuite.lk&uid=3&org=12&file=42&name=Q3%20plan.docx&mode=view");
  assert.deepEqual(l, { v: 1, id: "42", src: "", server: "https://app.worksuite.lk", uid: "3", org: "12", mode: "view", name: "Q3 plan.docx" });
});

test("contract v1 src copy: a path on the server only", () => {
  const l = WS._parseOpenLink("worksuiteoffice://open?v=1&server=https%3A%2F%2Fapp.worksuite.lk&uid=3&src=%2Fapi%2Fmail%2Fattachments%2F9&name=Price.xlsx");
  assert.equal(l.src, "/api/mail/attachments/9");
  assert.equal(l.id, null);
  assert.equal(WS._parseOpenLink("worksuiteoffice://open?src=https%3A%2F%2Fevil.example%2Fx&name=a"), null);
  assert.equal(WS._parseOpenLink("worksuiteoffice://open?src=%2F%2Fevil.example%2Fx&name=a"), null);
});

test("older links still open", () => {
  const l = WS._parseOpenLink("worksuiteoffice://open?file=5&server=app.worksuite.lk");
  assert.equal(l.id, "5");
  assert.equal(l.server, "https://app.worksuite.lk");
  assert.equal(l.uid, null);
  assert.equal(WS._parseOpenLink("worksuiteoffice://open?file=5x"), null);
});

test("company scoping: chosen company, unknown company kept, All", () => {
  assert.equal(WS.companyOf(account), null);
  WS.setCompany(account, 7);
  assert.equal(WS.companyOf(account), 7);
  assert.ok(WS.inCompany(7, { org: 7 }));
  assert.ok(!WS.inCompany(7, { org: 9 }));
  assert.ok(WS.inCompany(7, { org: undefined }));
  WS.setCompany(account, null);
  assert.ok(WS.inCompany(null, { org: 9 }));
});
