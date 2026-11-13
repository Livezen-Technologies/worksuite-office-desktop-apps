// The launch screen (src/splash/splash.js): the WorkSuite "flash" logo, shown for at least one flash, hidden
// once loading is done. Bundled with esbuild (the ?raw SVG import inlined) and run against a fake element.
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadSplash() {
  const out = await build({
    entryPoints: [path.join(root, "src/splash/splash.js")],
    bundle: true, write: false, format: "esm", platform: "neutral",
    plugins: [{
      name: "raw",
      setup(b) {
        b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: path.resolve(a.resolveDir, a.path.replace(/\?raw$/, "")), namespace: "raw" }));
        b.onLoad({ filter: /.*/, namespace: "raw" }, (a) => ({ contents: readFileSync(a.path, "utf8"), loader: "text" }));
      },
    }],
  });
  const url = "data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64");
  return import(url);
}

function fakeEl() {
  const classes = new Set();
  return {
    style: {}, innerHTML: "", firstElementChild: null,
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    addEventListener() {},
    hidden: () => classes.has("ws-splash--hide"),
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("puts the flash logo in the container", async () => {
  const { createSplash } = await loadSplash();
  const el = fakeEl(), box = fakeEl();
  createSplash(el, box, { reducedMotion: false, minMs: 10 });
  assert.match(box.innerHTML, /wsf-flash/);
  assert.match(box.innerHTML, /prefers-reduced-motion/);
});

test("stays up for one flash even when loading finishes at once", async () => {
  const { createSplash } = await loadSplash();
  const el = fakeEl();
  const s = createSplash(el, fakeEl(), { reducedMotion: false, minMs: 60 });
  s.done();
  assert.equal(el.hidden(), false);
  await wait(90);
  assert.equal(el.hidden(), true);
});

test("waits for loading when it takes longer than a flash", async () => {
  const { createSplash } = await loadSplash();
  const el = fakeEl();
  const s = createSplash(el, fakeEl(), { reducedMotion: false, minMs: 20 });
  await wait(50);
  assert.equal(el.hidden(), false);
  s.done();
  assert.equal(el.hidden(), true);
});

test("with reduced motion it hides as soon as loading is done", async () => {
  const { createSplash } = await loadSplash();
  const el = fakeEl();
  createSplash(el, fakeEl(), { reducedMotion: true, minMs: 5000 }).done();
  assert.equal(el.hidden(), true);
});
