/*
 * panelworksuite.js on the home screen: signed-out offer, sign-in dialog,
 * cached list first, escaping, view-only badge, type filters.
 *
 * Run: npm i --no-save jsdom@24 && node test/worksuite-ui.test.js  (from common/loginpage)
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const crypto = require('crypto');
const assert = require('assert');
const LP = require('path').join(__dirname, '../');
const dom = new JSDOM(`<!doctype html><body><div id="placeholder"></div>
  <div class="action-panel recents"><div id="box-container"><div id="box-recent"></div></div></div></body>`,
  { url: 'http://localhost/index.html', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window;
Object.defineProperty(w, 'crypto', { value: { getRandomValues: a => crypto.randomFillSync(a), subtle: undefined } });
w.HTMLDialogElement && (w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); });
const handlers = {}, opened = [], commands = [];
w.sdk = { on: (t, f) => (handlers[t] = handlers[t] || []).push(f), command: (c, p) => commands.push([c, p]), execCommand: () => {} };
w.open = u => opened.push(u);
w.utils = { Lang: new Proxy({}, { get: (t, k) => k === 'wsServerIs' ? 'Server: $1' : k === 'wsContinueAs' ? 'Continue as $1' : String(k) }), defines: { FileFormat: {} } };
w.eval(fs.readFileSync(LP + 'vendor/jquery/jquery.min.js', 'utf8'));
w.eval(fs.readFileSync(LP + 'src/dialogbase.js', 'utf8').replace('window.Dialog = dialog;', 'window.Dialog = dialog;'));
w.AscSimpleRequest = { createRequest: o => setTimeout(() => o.complete({ responseStatus: 200, responseText: JSON.stringify({ status: 'success', data: { files: [
  { id: 1, name: '<img src=x onerror=alert(1)>.docx', extension: 'docx', owner_name: 'A&B', updated_at: '2026-10-01 09:00:00', access: { level: 'view' } } ] } }) }), 0) };
w.eval(fs.readFileSync(LP + 'src/worksuite.js', 'utf8'));
w.eval(fs.readFileSync(LP + 'src/panelworksuite.js', 'utf8'));
const $ = w.jQuery;

// WorkSuite Desktop is signed in on this computer
w.sdk.command = (cmd, p) => {
  commands.push([cmd, p]);
  if (cmd === 'worksuite:desktop') setTimeout(() => handlers.on_native_message.forEach(f => f('worksuite:desktop',
    JSON.stringify({ accounts: [{ server: 'https://app.worksuite.lk', user: { id: 9, name: 'Hasarinda Manjula', organization: 'Livezen Technologies Pvt Ltd' } }] }))), 0);
};
const c = new w.ControllerWorkSuite().init();
assert.strictEqual($('#box-worksuite').index(), 0, 'WorkSuite comes before the files on this computer');
assert.ok($('.ws-signedout').css('display') !== 'none', 'signed out: offers sign-in');
$('.ws-signin').trigger('click');
assert.strictEqual($('.dlg-worksuite-signin').length, 1);
assert.strictEqual($('.ws-dlg-server').text(), 'Server: app.worksuite.lk', 'no URL to type: the default server');
$('.ws-dlg-other').trigger('click');
assert.ok($('.ws-dlg-custom').css('display') !== 'none', 'a different server only when asked');

(async () => {
  await new Promise(r => setTimeout(r, 20));
  const $continue = $('.ws-signedout .ws-continue');
  assert.strictEqual($continue.length, 1, 'signed out, WorkSuite Desktop signed in: Continue as');
  assert.ok($continue.text().includes('Continue as Hasarinda Manjula'));
  assert.ok($continue.text().includes('Livezen Technologies Pvt Ltd · app.worksuite.lk'));
  assert.ok(!$('.ws-signin').hasClass('btn--landing'), 'the browser sign-in becomes the second choice');
  $('.dlg-worksuite-signin').remove(); c.dialog = null;
  $continue.trigger('click');
  await new Promise(r => setTimeout(r, 20));
  assert.ok(opened.some(u => u.startsWith('worksuite://office/signin?client=worksuite-office&server=https%3A%2F%2Fapp.worksuite.lk&uid=9&')), 'one click asks WorkSuite Desktop');
  assert.ok($('.dlg-worksuite-signin .ws-dlg-wait-text').text() === 'wsWaitDesktop');
  $('.dlg-worksuite-signin').remove(); c.dialog = null;

  // signed-in account straight in storage, as after a sign-in
  w.localStorage.setItem('ws:accounts', JSON.stringify([{ id: 'https://s|3', server: 'https://s', user: { id: 3, name: 'Samali', organization: 'Livezen' }, signedOut: false }]));
  w.localStorage.setItem('ws:cache:https://s|3:recent', JSON.stringify({ items: [{ kind: 'file', id: 5, name: 'Cached.xlsx', ext: 'xlsx', location: '', owner: '', modified: '' }] }));
  // access token in memory is unknown → token() refreshes through the secret store; give it one
  w.sdk.command = (cmd, p) => { commands.push([cmd, p]); if (cmd === 'worksuite:secret') { const m = JSON.parse(p); setTimeout(() => handlers.on_native_message.forEach(f => f('worksuite:secret', JSON.stringify({ req: m.req, ok: true, value: 'R' }))), 0); } };
  const real = w.AscSimpleRequest.createRequest;
  w.AscSimpleRequest.createRequest = o => o.url.endsWith('/api/auth/refresh') ?
    setTimeout(() => o.complete({ responseStatus: 200, responseText: JSON.stringify({ status: 'success', data: { tokens: { access_token: 'A', refresh_token: 'R2', expires_in: 3600 } } }) }), 0) : real(o);

  c.refresh();
  assert.ok($('.ws-list .row').text().includes('Cached'), 'the stored list shows first');
  await new Promise(r => setTimeout(r, 50));
  const html = $('.ws-list').html();
  assert.strictEqual($('.ws-list img').length, 0, 'file names are escaped'); assert.ok($('.ws-list .name').text().includes('<img src=x'));
  assert.ok($('.ws-list .row').text().includes('A&B'));
  assert.ok($('.ws-badge').length === 1, 'view-only is marked');
  assert.ok($('.ws-account-btn').text().includes('Livezen'));

  // filters
  $('.ws-filters button[data-filter="cell"]').trigger('click');
  assert.strictEqual($('.ws-list .row').length, 0);
  $('.ws-filters button[data-filter="word"]').trigger('click');
  assert.strictEqual($('.ws-list .row').length, 1);
  console.log('UI OK');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
