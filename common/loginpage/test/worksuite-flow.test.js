/*
 * worksuite.js end to end against a mocked app bridge and server: PKCE sign-in,
 * token rotation on 401, Drive list and cache, opening a file, links, sign-out.
 *
 * Run: npm i --no-save jsdom@24 && node test/worksuite-flow.test.js  (from common/loginpage)
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const crypto = require('crypto');
const assert = require('assert');
const SRC = require('path').join(__dirname, '../src/');

const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/index.html', runScripts: 'outside-only' });
const w = dom.window;
w.crypto.subtle = undefined; // force the JS SHA-256 fallback path once
Object.defineProperty(w, 'crypto', { value: { getRandomValues: a => crypto.randomFillSync(a), subtle: undefined } });

const commands = [], opened = [], secrets = {}, requests = [];
let handlers = {};
w.sdk = {
  on: (t, fn) => (handlers[t] = handlers[t] || []).push(fn),
  command: (cmd, param) => {
    commands.push([cmd, param]);
    if (cmd === 'worksuite:secret') {
      const m = JSON.parse(param);
      let reply = { req: m.req, ok: false };
      if (m.op === 'set') { secrets[m.key] = m.value; reply.ok = true; }
      if (m.op === 'get') { reply.ok = m.key in secrets; reply.value = secrets[m.key] || ''; }
      if (m.op === 'delete') { delete secrets[m.key]; reply.ok = true; }
      setTimeout(() => handlers.on_native_message.forEach(f => f('worksuite:secret', JSON.stringify(reply))), 0);
    }
  },
  execCommand: (cmd, param) => commands.push([cmd, param]),
};
w.open = url => opened.push(url);
w.utils = { Lang: new Proxy({}, { get: (t, k) => String(k) }), defines: { FileFormat: { FILE_UNKNOWN: 0, FILE_DOCUMENT_DOCX: 65, FILE_CROSSPLATFORM_PDF: 513 } } };

let refreshCount = 0;
const server = (req) => {
  const u = new URL(req.url);
  const body = req.body ? JSON.parse(req.body) : null;
  if (u.pathname === '/api/auth/apps/exchange') {
    assert.strictEqual(body.client, 'worksuite-office');
    const pend = JSON.parse(w.localStorage.getItem('ws:pending') || 'null');
    // PKCE: the challenge the browser got is SHA-256(verifier)
    const challenge = new URL(opened[0]).searchParams.get('challenge');
    assert.strictEqual(crypto.createHash('sha256').update(body.code_verifier).digest('base64url'), challenge);
    return [200, { status: 'success', data: { user: { id: 3, name: 'Samali', email: 's@x', organization: 'Livezen' }, tokens: { access_token: 'A1', refresh_token: 'R1', expires_in: 3600 } } }];
  }
  if (u.pathname === '/api/drive/list') {
    if (req.headers.Authorization === 'Bearer A1' && refreshCount === 0) return [401, { status: 'error', message: 'expired' }];
    assert.strictEqual(req.headers.Authorization, 'Bearer A2');
    return [200, { status: 'success', data: { files: [
      { id: 7, name: 'Plan.docx', extension: 'docx', folder_name: 'My Files', owner_name: 'Samali', updated_at: '2026-10-06 10:00:00', access: { level: 'edit' } },
      { id: 8, name: 'photo.jpg', extension: 'jpg' },
      { id: 9, name: 'Budget.pdf', extension: 'pdf', access: { level: 'view' } } ] } }];
  }
  if (u.pathname === '/api/auth/refresh') {
    refreshCount++;
    assert.strictEqual(body.refresh_token, 'R1');
    return [200, { status: 'success', data: { tokens: { access_token: 'A2', refresh_token: 'R2', expires_in: 3600 } } }];
  }
  if (u.pathname === '/api/auth/apps/handoff') {
    assert.strictEqual(body.client, 'worksuite-office-editor');
    return [200, { status: 'success', data: { code: 'EDITORCODE', expires_in: 120, callback: null } }];
  }
  if (u.pathname.startsWith('/api/drive/opened/')) return [200, { status: 'success', data: {} }];
  if (u.pathname === '/api/auth/logout') return [200, { status: 'success', data: {} }];
  return [404, { status: 'error', message: 'nope ' + u.pathname }];
};
w.AscSimpleRequest = { createRequest: o => { requests.push(o); const [st, js] = server(o); setTimeout(() => o.complete({ responseStatus: st, responseText: JSON.stringify(js) }), 0); } };

w.eval(fs.readFileSync(SRC + 'worksuite.js', 'utf8'));
const WS = w.WorkSuite;

// SHA-256 fallback matches node
for (const s of ['', 'abc', 'x'.repeat(43), 'y'.repeat(128)])
  assert.strictEqual(Buffer.from(WS._sha256Ascii(s)).toString('hex'), crypto.createHash('sha256').update(s).digest('hex'));

(async () => {
  const signedIn = new Promise(r => WS.on('signedin', r));
  await WS.signIn('app.worksuite.test');
  const page = new URL(opened[0]);
  assert.strictEqual(page.origin + page.pathname, 'https://app.worksuite.test/desktop/office');
  const state = page.searchParams.get('state');

  // a callback with another state is refused
  const errored = new Promise(r => WS.on('error', r));
  handlers.on_native_message.forEach(f => f('worksuite:link', 'worksuiteoffice://auth/callback?code=c&state=wrong'));
  await errored;
  // the real one (pending was cleared by the wrong one? no: it must still be there)
  assert.ok(WS.pendingSignIn(), 'a wrong state does not cancel the sign-in');
  handlers.on_native_message.forEach(f => f('worksuite:link', 'worksuiteoffice://auth/callback?code=thecode&state=' + state));
  const account = await signedIn;
  assert.strictEqual(account.id, 'https://app.worksuite.test|3');
  assert.strictEqual(secrets['worksuite:https://app.worksuite.test|3'], 'R1');
  assert.ok(!JSON.stringify(w.localStorage).includes('R1'), 'the refresh token is not in localStorage');

  // list: a 401 refreshes once (rotation keeps the new token) and retries; only office files
  const res = await WS.list(account, 'recent');
  assert.strictEqual(JSON.stringify(res.items.map(i => i.id)), '[7,9]');
  assert.strictEqual(secrets['worksuite:https://app.worksuite.test|3'], 'R2');
  assert.ok(WS.cached(account, 'recent').items.length === 2, 'cached for next time');

  // open: an editor-tab code, then open:recent with the session page and next=/editor/<id>
  await WS.open(account, res.items[1]);
  const [cmd, param] = commands.filter(c => c[0] === 'open:recent').pop();
  const p = JSON.parse(param);
  assert.strictEqual(p.id, -1);
  const url = new URL(p.path);
  assert.strictEqual(url.origin + url.pathname, 'https://app.worksuite.test/desktop/office/session');
  const h = new URLSearchParams(url.hash.slice(1));
  assert.strictEqual(h.get('code'), 'EDITORCODE');
  assert.strictEqual(h.get('next'), '/editor/9?name=Budget.pdf&mode=VIEW', 'view-only opens read-only');
  assert.strictEqual(h.get('uid'), '3');

  // open link routing
  const linked = new Promise(r => WS.on('openlink', r));
  WS._onLink('worksuiteoffice://open?file=42&server=app.worksuite.test');
  assert.strictEqual(JSON.stringify(await linked), JSON.stringify({ id: '42', server: 'https://app.worksuite.test', name: '' }));

  // sign out: server logout with the refresh token, secret deleted, cache cleared, editor tabs signed out
  await WS.signOut(account);
  assert.ok(!('worksuite:https://app.worksuite.test|3' in secrets));
  assert.strictEqual(WS.accounts().length, 0);
  assert.ok(!Object.keys(w.localStorage).some(k => k.startsWith('ws:cache:')));
  assert.ok(commands.some(c => c[0] === 'portal:logout' && JSON.parse(c[1]).domain === 'https://app.worksuite.test'));
  const logout = requests.find(r => r.url.endsWith('/api/auth/logout'));
  assert.strictEqual(JSON.parse(logout.body).refresh_token, 'R2');

  console.log('ALL OK');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
