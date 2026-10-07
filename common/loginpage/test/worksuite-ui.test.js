/*
 * panelworksuite.js on the home screen: signed-out offer, sign-in dialog,
 * cached list first, escaping, view-only badge, type filters, pictures of documents.
 *
 * Run: npm i --no-save jsdom@24 && node test/worksuite-ui.test.js  (from common/loginpage)
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const crypto = require('crypto');
const assert = require('assert');
const LP = require('path').join(__dirname, '../');
const dom = new JSDOM(`<!doctype html><body><div id="placeholder"><div class="main-column col-left tool-menu">
    <li class="menu-item"><a action="recents"><span class="text">Home</span></a></li>
    <li class="menu-item"><a action="templates"><span class="text">Templates</span></a></li>
    <li class="menu-item separator"></li></div></div>
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

// WorkSuite Desktop is signed in on this computer; the app opens links and says whether it could
let desktopInstalled = true;
w.sdk.command = (cmd, p) => {
  commands.push([cmd, p]);
  if (cmd === 'worksuite:desktop') setTimeout(() => handlers.on_native_message.forEach(f => f('worksuite:desktop',
    JSON.stringify({ accounts: [{ server: 'https://app.worksuite.lk', user: { id: 9, name: 'Hasarinda Manjula', organization: 'Livezen Technologies Pvt Ltd' } }] }))), 0);
  if (cmd === 'worksuite:open') {
    const m = JSON.parse(p), noApp = m.url.startsWith('worksuite:') && !desktopInstalled;
    if (!noApp) opened.push(m.url);
    setTimeout(() => handlers.on_native_message.forEach(f => f('worksuite:open', JSON.stringify({ req: m.req, ok: !noApp, reason: noApp ? 'no-app' : '' }))), 0);
  }
};
const c = new w.ControllerWorkSuite().init();
assert.strictEqual($('#box-worksuite').index(), 0, 'WorkSuite comes before the files on this computer');

// the WorkSuite app in the sidebar, right under Templates, with its own icon; the app decides where a click goes
const $app = $('.tool-menu a[action=custom-worksuite-app]');
assert.strictEqual($app.length, 1);
assert.strictEqual($('.tool-menu a[action=templates]').parent().next().find('a').attr('action'), 'custom-worksuite-app');
assert.ok($app.find('svg.ws-app-logo').length === 1 && $app.find('svg.icon').length === 0, "WorkSuite's icon, not one of the sidebar's set");
assert.strictEqual($app.find('.text').text(), 'wsApp');
assert.strictEqual($app.attr('title'), 'wsAppTip');
$app.trigger('click');
assert.deepStrictEqual(commands[commands.length - 1], ['worksuite:app', JSON.stringify({ web: 'https://app.worksuite.lk/' })]);
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
  assert.ok(w.WorkSuite.pendingSignIn(), 'waiting for WorkSuite Desktop');

  // WorkSuite Desktop does not answer: no spinner forever, a message, Try again and the browser
  w.DialogWorkSuiteSignIn.waits.desktop = 30;
  $('.dlg-worksuite-signin .ws-dlg-retry').trigger('click');
  await new Promise(r => setTimeout(r, 80));
  assert.strictEqual($('.dlg-worksuite-signin .ws-dlg-wait-text').text(), 'wsDesktopTimeout');
  assert.strictEqual($('.dlg-worksuite-signin .ws-spinner').css('display'), 'none');
  assert.ok($('.dlg-worksuite-signin .ws-dlg-retry').css('display') !== 'none' && $('.dlg-worksuite-signin .ws-dlg-browser').css('display') !== 'none');
  assert.strictEqual(w.WorkSuite.pendingSignIn(), null, 'the timed-out sign-in is dropped');
  w.DialogWorkSuiteSignIn.waits.desktop = 60000;
  $('.dlg-worksuite-signin .ws-dlg-retry').trigger('click');
  await new Promise(r => setTimeout(r, 20));
  assert.strictEqual($('.dlg-worksuite-signin .ws-dlg-wait-text').text(), 'wsWaitDesktop', 'Try again asks WorkSuite Desktop again');
  assert.ok($('.dlg-worksuite-signin .ws-spinner').css('display') !== 'none');

  // Cancel (and the close button, and Esc, which close the dialog the same way) ends the sign-in
  $('.dlg-worksuite-signin .ws-dlg-cancel').trigger('click');
  assert.strictEqual($('.dlg-worksuite-signin').length, 0);
  assert.strictEqual(w.WorkSuite.pendingSignIn(), null, 'closing cancels the sign-in');
  assert.strictEqual(c.dialog, null);

  // WorkSuite Desktop not installed: the dialog says so, back on its first view
  desktopInstalled = false;
  $continue.trigger('click');
  await new Promise(r => setTimeout(r, 20));
  assert.strictEqual($('.dlg-worksuite-signin .ws-dlg-error').text(), 'wsErrNoDesktop');
  assert.ok($('.dlg-worksuite-signin .ws-dlg-start').css('display') !== 'none' && $('.dlg-worksuite-signin .ws-dlg-wait').css('display') === 'none');
  desktopInstalled = true;
  $('.dlg-worksuite-signin .tool.close').trigger('click');
  assert.strictEqual($('.dlg-worksuite-signin').length, 0);

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
  assert.strictEqual($('.ws-list img:not(.ws-thumb), .ws-list [onerror]').length, 0, 'file names are escaped'); assert.ok($('.ws-list .name').text().includes('<img src=x'));
  assert.ok($('.ws-list .row').text().includes('A&B'));
  assert.ok($('.ws-badge').length === 1, 'view-only is marked');
  assert.ok($('.ws-account-btn').text().includes('Livezen'));

  // filters
  $('.ws-filters button[data-filter="cell"]').trigger('click');
  assert.strictEqual($('.ws-list .row').length, 0);
  $('.ws-filters button[data-filter="word"]').trigger('click');
  assert.strictEqual($('.ws-list .row').length, 1);
  $('.ws-filters button[data-filter="all"]').trigger('click');

  // pictures of documents: the ones seen in the last four hours straight away, with the cached list
  w.localStorage.setItem('ws:cache:https://s|3:thumbs', JSON.stringify({
    7: { url: 'https://s/media/seen?v=1', at: Date.now() }, 8: { url: 'https://s/media/stale?v=1', at: Date.now() - 5 * 3600e3 } }));
  w.localStorage.setItem('ws:cache:https://s|3:starred', JSON.stringify({ items: [
    { kind: 'file', id: 7, name: 'Plan.docx', ext: 'docx' }, { kind: 'file', id: 8, name: 'Deck.pptx', ext: 'pptx' }] }));
  const asked = [];
  w.AscSimpleRequest.createRequest = o => {
    const reply = data => setTimeout(() => o.complete({ responseStatus: 200, responseText: JSON.stringify({ status: 'success', data: data }) }), 0);
    if (o.url.endsWith('/api/files/office/thumbs')) {
      const body = JSON.parse(o.body);
      asked.push(body);
      // three at a time on the server: the first answer leaves Deck to draw, the second has it
      return reply(asked.length === 1 ?
        { thumbs: { 7: 'https://s/media/t7?v=1', 8: null, 9: 'javascript:alert(1)' }, pending: [8] } :
        { thumbs: { 8: 'https://s/media/t8?v=2' }, pending: [] });
    }
    return reply({ files: [{ id: 7, name: 'Plan.docx', extension: 'docx' }, { id: 8, name: 'Deck.pptx', extension: 'pptx' }, { id: 9, name: 'Scan.pdf', extension: 'pdf' }] });
  };
  const thumbOf = name => $('.ws-list .row').filter((i, r) => $(r).find('.name').text() === name).find('img.ws-thumb').attr('src');

  $('.ws-tabs button[data-view="starred"]').trigger('click');
  assert.strictEqual(thumbOf('Plan.docx'), 'https://s/media/seen?v=1', 'a picture seen recently shows with the cached list');
  assert.strictEqual(thumbOf('Deck.pptx'), undefined, 'one older than four hours is not used: its address may have run out');
  assert.ok($('.ws-list .row:first .col-name > .icon').hasClass('has-thumb'));

  await new Promise(r => setTimeout(r, 60));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(asked)), [{ ids: [7, 8, 9], make: true }, { ids: [8], make: true }], 'then the server: top rows first, again for what it had still to draw');
  assert.strictEqual(thumbOf('Plan.docx'), 'https://s/media/t7?v=1');
  assert.strictEqual(thumbOf('Deck.pptx'), 'https://s/media/t8?v=2', 'drawn on the second round');
  assert.strictEqual(thumbOf('Scan.pdf'), undefined, 'only an address on the server, or https');
  assert.deepStrictEqual(Object.keys(JSON.parse(w.localStorage.getItem('ws:cache:https://s|3:thumbs'))).sort(), ['7', '8'], 'kept for the next time');

  // a picture that does not load: the file-type icon again
  const img = $('.ws-list img.ws-thumb')[0];
  img.dispatchEvent(new w.Event('error'));
  assert.strictEqual(thumbOf('Plan.docx'), undefined);
  assert.ok(!$('.ws-list .row:first .col-name > .icon').hasClass('has-thumb'));
  assert.strictEqual($('.ws-list .row:first svg.icon use').attr('xlink:href'), '#docx');
  console.log('UI OK');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
