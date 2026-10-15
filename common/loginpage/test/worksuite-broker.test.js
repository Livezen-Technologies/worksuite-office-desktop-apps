/*
 * worksuite.js on WorkSuite OS: signing in through the OS credentials broker ("worksuite:broker"),
 * against a mocked app bridge, broker and server. No password, no browser sign-in of our own,
 * nothing kept in "worksuite:secret"; elsewhere ("not_os") the usual sign-in stays.
 *
 * Run: npm i --no-save jsdom@24 && node test/worksuite-broker.test.js  (from common/loginpage)
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const crypto = require('crypto');
const assert = require('assert');
const SRC = require('path').join(__dirname, '../src/');

const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/index.html', runScripts: 'outside-only' });
const w = dom.window;
Object.defineProperty(w, 'crypto', { value: { getRandomValues: a => crypto.randomFillSync(a), subtle: undefined } });

const commands = [], brokerCalls = [], requests = [];
const handlers = {};
const reply = (cmd, obj) => setTimeout(() => handlers.on_native_message.forEach(f => f(cmd, JSON.stringify(obj))), 0);

// the broker, as worksuite-credentials answers (the app adds req and device_server)
let os = false;
let status = [];
let tokenError = null;
let tokens = 0;
let signInResult = null;
let reject = false;
w.sdk = {
  on: (t, fn) => (handlers[t] = handlers[t] || []).push(fn),
  command: (cmd, param) => {
    commands.push([cmd, param]);
    if (cmd !== 'worksuite:broker') return;
    const m = JSON.parse(param);
    brokerCalls.push(m);
    if (!os) return reply(cmd, { req: m.req, ok: false, error: 'not_os' });
    if (m.method === 'Status') return reply(cmd, { req: m.req, ok: true, result: status, device_server: 'https://corp.worksuite.test' });
    if (m.method === 'GetAccessToken') {
      if (tokenError) return reply(cmd, { req: m.req, ok: false, error: tokenError });
      tokens++;
      return reply(cmd, { req: m.req, ok: true, result: 'T' + tokens, expires_at: Date.now() + 600000 });
    }
    if (m.method === 'SignIn') return reply(cmd, Object.assign({ req: m.req }, signInResult));
  },
  execCommand: (cmd, param) => commands.push([cmd, param]),
};
w.open = () => assert.fail('no browser sign-in on WorkSuite OS');
w.utils = { Lang: new Proxy({}, { get: (t, k) => String(k) }), defines: { FileFormat: { FILE_UNKNOWN: 0 } } };

const server = req => {
  const u = new URL(req.url);
  if (u.pathname === '/api/auth/me') {
    assert.ok(/^Bearer T\d+$/.test(req.headers.Authorization));
    return [200, { status: 'success', data: { user: { id: 3, name: 'Samali', email: 's@x', organization: 'Livezen' } } }];
  }
  if (u.pathname === '/api/drive/list') {
    if (req.headers.Authorization === 'Bearer T1' || reject) return [401, { status: 'error', message: 'expired' }];
    return [200, { status: 'success', data: { files: [{ id: 7, name: 'Plan.docx', extension: 'docx' }] } }];
  }
  return [404, { status: 'error', message: 'nope ' + u.pathname }];
};
w.AscSimpleRequest = { createRequest: o => { requests.push(o); const [st, js] = server(o); setTimeout(() => o.complete({ responseStatus: st, responseText: JSON.stringify(js) }), 0); } };

w.eval(fs.readFileSync(SRC + 'worksuite.js', 'utf8'));
const WS = w.WorkSuite;

(async () => {
  // not WorkSuite OS: not available, and the usual sign-in is untouched
  assert.strictEqual((await WS.osBroker()).available, false);

  // WorkSuite OS, signed in to the enrolled organisation's server: that account, no SignIn, no browser
  os = true;
  status = [
    { id: 'acc-cloud', server_url: 'https://worksuitecloud.com', name: 'Samali (personal)', state: 'signed_in' },
    { id: 'acc-corp', server_url: 'https://corp.worksuite.test', name: 'Samali', state: 'signed_in' },
    { id: 'bad', server_url: 'http://plain.test', state: 'signed_in' },
  ];
  const probe = await WS.osBroker(true);
  assert.strictEqual(probe.available, true);
  assert.strictEqual(probe.accounts.length, 2, 'only https accounts');
  assert.strictEqual(probe.account.id, 'acc-corp', 'the enrolled server first');

  const signedIn = new Promise(r => WS.on('signedin', r));
  const account = await WS.signInWithBroker();
  assert.strictEqual((await signedIn).id, account.id);
  assert.strictEqual(account.id, 'https://corp.worksuite.test|3');
  assert.strictEqual(account.broker, 'acc-corp');
  assert.ok(!brokerCalls.some(c => c.method === 'SignIn'), 'already signed in: no SignIn');
  assert.ok(!commands.some(c => c[0] === 'worksuite:secret' || c[0] === 'worksuite:open'), 'nothing kept, nothing opened');
  assert.deepStrictEqual(brokerCalls.filter(c => c.method === 'GetAccessToken')[0].params, { account_id: 'acc-corp', force_refresh: false });
  assert.ok(!JSON.stringify(w.localStorage).includes('T1'), 'the token is in memory only');

  // a 401: a forced GetAccessToken from the broker, then the request again
  const res = await WS.list(account, 'recent');
  assert.strictEqual(res.items.length, 1);
  const last = brokerCalls.filter(c => c.method === 'GetAccessToken').pop();
  assert.deepStrictEqual(last.params, { account_id: 'acc-corp', force_refresh: true });
  assert.ok(!requests.some(r => new URL(r.url).pathname === '/api/auth/refresh'), 'never the app\'s own refresh');

  // locked: the session stands (an error, not signed out)
  tokenError = 'locked';
  reject = true; // the server refuses the token: a forced refresh is needed
  await WS.list(account, 'shared').then(() => assert.fail('locked'), e => assert.strictEqual(e.code, 'locked'));
  assert.strictEqual(WS.active().signedOut, false, 'locked does not sign out');

  // the broker lost the grant: signed out here too
  tokenError = 'sign_in_required';
  await WS.list(account, 'starred').then(() => assert.fail('ended'), e => assert.ok(e.signedOut));
  assert.strictEqual(WS.active().signedOut, true);
  tokenError = null;
  reject = false;

  // signing out only forgets: no logout request, no secret to delete
  await WS.signOut(WS.active());
  assert.strictEqual(WS.accounts().length, 0);
  assert.ok(!requests.some(r => new URL(r.url).pathname === '/api/auth/logout'));

  // nobody signed in on the OS: the broker's sign-in (the system browser), to the enrolled server
  status = [];
  signInResult = { ok: true, result: { id: 'acc-new', name: 'Samali', server_url: 'https://corp.worksuite.test' } };
  const pend = [];
  WS.on('pending', p => pend.push(p));
  const again = await WS.signInWithBroker();
  const si = brokerCalls.filter(c => c.method === 'SignIn').pop();
  assert.deepStrictEqual(si.params, { server_url: 'https://corp.worksuite.test', mode: 'enterprise' });
  assert.strictEqual(again.broker, 'acc-new');
  assert.deepStrictEqual(pend, ['https://corp.worksuite.test', null]);

  // the broker's sign-in failed: its words, no account
  await WS.signOut(again);
  signInResult = { ok: false, error: 'sign_in_timeout' };
  await WS.signInWithBroker().then(() => assert.fail('timeout'), e => assert.strictEqual(e.message, 'wsOsErrTimeout'));
  assert.strictEqual(WS.accounts().length, 0);

  // a locked OS: no SignIn either
  status = [{ id: 'acc-corp', server_url: 'https://corp.worksuite.test', state: 'locked' }];
  const n = brokerCalls.length;
  await WS.signInWithBroker().then(() => assert.fail('locked'), e => assert.strictEqual(e.code, 'locked'));
  assert.ok(!brokerCalls.slice(n).some(c => c.method === 'SignIn'));

  console.log('BROKER OK');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
