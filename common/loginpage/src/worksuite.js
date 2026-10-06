/*
 * WorkSuite: signing in with a WorkSuite account and reading WorkSuite Drive,
 * for the start page's WorkSuite section (panelworksuite.js).
 *
 * SIGNING IN never touches a password here. The browser does it:
 *   1. `signIn(server)` opens <server>/desktop/office in the system browser with
 *      a PKCE S256 challenge and a state value; the verifier stays here.
 *   2. The person continues as the account the browser is signed in to, or signs
 *      in there (two-step verification, passkeys), and the page sends a one-time
 *      code to worksuiteoffice://auth/callback.
 *   3. The app passes the link to this page ("worksuite:link"), and the code is
 *      exchanged, with the verifier, at /api/auth/apps/exchange for a session of
 *      WorkSuite Office's own.
 *
 * TOKENS. The refresh token is kept by the operating system ("worksuite:secret":
 * Keychain, Windows Credential Manager); the access token only in memory. The
 * account list (who, which server) is in localStorage so the home screen can
 * show it straight away.
 *
 * REQUESTS go through the app (AscSimpleRequest), which is not subject to the
 * browser's cross-origin rules that would stop this file:// page.
 *
 * PICTURES of documents come from the server (/api/files/office/thumbs) as signed
 * addresses the page shows as images; the ones seen in the last four hours are
 * kept beside the lists, so a cached list shows them straight away too.
 *
 * OPENING a Drive file asks the server for a one-time code for the editor tab
 * and opens <server>/desktop/office/session#…&next=/editor/<id> in a WorkSuite
 * Office editor tab. The document is edited through WorkSuite's document service
 * and every save is a new version of the same Drive file.
 */

+function () {
    'use strict';

    const DEFAULT_SERVER = 'https://app.worksuite.lk';
    const CLIENT = 'worksuite-office';
    const EDITOR_CLIENT = 'worksuite-office-editor';

    const LS_ACCOUNTS = 'ws:accounts';
    const LS_ACTIVE = 'ws:active';
    const LS_PENDING = 'ws:pending';
    const LS_CACHE = 'ws:cache:';

    /* Office files and PDFs, by the filter they belong to */
    const TYPES = {
        word:  ['docx', 'doc', 'docm', 'dotx', 'dotm', 'odt', 'ott', 'fodt', 'rtf', 'txt', 'md'],
        cell:  ['xlsx', 'xls', 'xlsm', 'xlsb', 'xltx', 'xltm', 'ods', 'ots', 'fods', 'csv'],
        slide: ['pptx', 'ppt', 'pptm', 'ppsx', 'ppsm', 'potx', 'potm', 'odp', 'otp', 'fodp'],
        pdf:   ['pdf'],
    };
    const OFFICE_EXT = [].concat(TYPES.word, TYPES.cell, TYPES.slide, TYPES.pdf);

    /* ------------------------------------------------------------------ *
     * small helpers
     * ------------------------------------------------------------------ */

    const listeners = {};
    function on(event, fn) { (listeners[event] = listeners[event] || []).push(fn); }
    function off(event, fn) { listeners[event] = (listeners[event] || []).filter(f => f !== fn); }
    function fire(event, ...args) { (listeners[event] || []).forEach(fn => { try { fn(...args); } catch (e) { console.error(e); } }); }

    function readJson(storage, key, fallback) {
        try {
            const v = storage.getItem(key);
            return v ? JSON.parse(v) : fallback;
        } catch (e) { return fallback; }
    }

    function writeJson(storage, key, value) {
        try {
            value === undefined ? storage.removeItem(key) : storage.setItem(key, JSON.stringify(value));
        } catch (e) { /* storage full: the cache is only a convenience */ }
    }

    function b64url(bytes) {
        let s = '';
        for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function random(n) {
        const a = new Uint8Array(n);
        crypto.getRandomValues(a);
        return b64url(a);
    }

    /* SHA-256 of an ASCII string (a PKCE verifier), for when crypto.subtle is unavailable */
    function sha256Ascii(ascii) {
        const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
                   0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
                   0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
                   0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
        const H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
        const bytes = [];
        for (let i = 0; i < ascii.length; i++) bytes.push(ascii.charCodeAt(i) & 0xff);
        const bitLen = bytes.length * 8;
        bytes.push(0x80);
        while (bytes.length % 64 !== 56) bytes.push(0);
        for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (bitLen >>> (i * 8)) & 0xff);
        const rotr = (x, n) => (x >>> n) | (x << (32 - n));
        const W = new Array(64);
        for (let off = 0; off < bytes.length; off += 64) {
            for (let t = 0; t < 16; t++)
                W[t] = (bytes[off + t * 4] << 24) | (bytes[off + t * 4 + 1] << 16) | (bytes[off + t * 4 + 2] << 8) | bytes[off + t * 4 + 3];
            for (let t = 16; t < 64; t++) {
                const s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3);
                const s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
                W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
            }
            let [a, b, c, d, e, f, g, h] = H;
            for (let t = 0; t < 64; t++) {
                const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
                const ch = (e & f) ^ (~e & g);
                const t1 = (h + S1 + ch + K[t] + W[t]) | 0;
                const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
                const maj = (a & b) ^ (a & c) ^ (b & c);
                const t2 = (S0 + maj) | 0;
                h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
            }
            H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
            H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
        }
        const out = new Uint8Array(32);
        H.forEach((v, i) => { out[i * 4] = v >>> 24; out[i * 4 + 1] = (v >>> 16) & 0xff; out[i * 4 + 2] = (v >>> 8) & 0xff; out[i * 4 + 3] = v & 0xff; });
        return out;
    }

    /* A PKCE pair: the verifier is kept, SHA-256(verifier) is sent */
    async function pkce() {
        const verifier = random(32);
        let digest;
        try {
            digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
        } catch (e) {
            digest = sha256Ascii(verifier);
        }
        return { verifier: verifier, challenge: b64url(digest) };
    }

    /* "app.worksuite.lk", "https://app.worksuite.lk/files" → "https://app.worksuite.lk" */
    function normalizeServer(input) {
        let s = String(input || '').trim();
        if (!s) return null;
        if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
        const m = /^(https?:\/\/[^\/\s?#]+)/i.exec(s);
        return m ? m[1].toLowerCase() : null;
    }

    function extOf(name) {
        const m = /\.([A-Za-z0-9]+)$/.exec(name || '');
        return m ? m[1].toLowerCase() : '';
    }

    function typeOf(ext) {
        for (const t in TYPES)
            if (TYPES[t].includes(ext)) return t;
        return null;
    }

    function formatOf(ext) {
        const F = utils.defines.FileFormat;
        const map = {
            docx: F.FILE_DOCUMENT_DOCX, doc: F.FILE_DOCUMENT_DOC, odt: F.FILE_DOCUMENT_ODT, rtf: F.FILE_DOCUMENT_RTF, txt: F.FILE_DOCUMENT_TXT,
            docm: F.FILE_DOCUMENT_DOCM, dotx: F.FILE_DOCUMENT_DOTX, dotm: F.FILE_DOCUMENT_DOTM, ott: F.FILE_DOCUMENT_OTT,
            xlsx: F.FILE_SPREADSHEET_XLSX, xls: F.FILE_SPREADSHEET_XLS, ods: F.FILE_SPREADSHEET_ODS, csv: F.FILE_SPREADSHEET_CSV,
            xlsm: F.FILE_SPREADSHEET_XLSM, xltx: F.FILE_SPREADSHEET_XLTX, xlsb: F.FILE_SPREADSHEET_XLSB, ots: F.FILE_SPREADSHEET_OTS,
            pptx: F.FILE_PRESENTATION_PPTX, ppt: F.FILE_PRESENTATION_PPT, odp: F.FILE_PRESENTATION_ODP, ppsx: F.FILE_PRESENTATION_PPSX,
            pptm: F.FILE_PRESENTATION_PPTM, potx: F.FILE_PRESENTATION_POTX, otp: F.FILE_PRESENTATION_OTP,
            pdf: F.FILE_CROSSPLATFORM_PDF,
        };
        return map[ext] || F.FILE_UNKNOWN;
    }

    /* ------------------------------------------------------------------ *
     * the app: HTTP and the secret store
     * ------------------------------------------------------------------ */

    function http(method, url, body, headers) {
        const h = Object.assign({ 'Accept': 'application/json' }, headers || {});
        const payload = body === undefined ? undefined : JSON.stringify(body);
        if (payload !== undefined) h['Content-Type'] = 'application/json';

        return new Promise((resolve, reject) => {
            const done = (status, text) => {
                let json = null;
                try { json = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
                resolve({ status: status, json: json });
            };

            if (window.AscSimpleRequest && window.AscSimpleRequest.createRequest) {
                window.AscSimpleRequest.createRequest({
                    url: url,
                    method: method,
                    body: payload,
                    headers: h,
                    timeout: 30000,
                    complete: e => done(e.responseStatus || 200, e.responseText),
                    error: e => (e && e.responseStatus) ? done(e.responseStatus, e.responseText) : reject(new Error(utils.Lang.wsErrNetwork)),
                });
            } else {
                fetch(url, { method: method, headers: h, body: payload })
                    .then(r => r.text().then(t => done(r.status, t)), () => reject(new Error(utils.Lang.wsErrNetwork)));
            }
        });
    }

    const secretWaiting = {};

    function secret(op, key, value) {
        if (!window.sdk || !window.sdk.command) return Promise.reject(new Error('no secret store'));

        const req = 'r' + random(9);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                delete secretWaiting[req];
                reject(new Error('the secret store did not answer'));
            }, 5000);
            secretWaiting[req] = reply => {
                clearTimeout(timer);
                resolve(reply);
            };
            window.sdk.command('worksuite:secret', JSON.stringify({ op: op, key: key, value: value, req: req }));
        });
    }

    function secretKey(account) {
        return 'worksuite:' + account.server + '|' + account.user.id;
    }

    /* ------------------------------------------------------------------ *
     * accounts
     * ------------------------------------------------------------------ */

    const access = {};      // account id → {token, exp}
    const refreshing = {};  // account id → Promise

    function accountId(server, userId) { return server + '|' + userId; }

    function accounts() { return readJson(localStorage, LS_ACCOUNTS, []); }

    function saveAccounts(list) { writeJson(localStorage, LS_ACCOUNTS, list); }

    function active() {
        const list = accounts();
        const id = localStorage.getItem(LS_ACTIVE);
        return list.find(a => a.id === id) || list[0] || null;
    }

    function setActive(id) {
        localStorage.setItem(LS_ACTIVE, id);
        fire('changed');
    }

    function updateAccount(id, patch) {
        const list = accounts();
        const i = list.findIndex(a => a.id === id);
        if (i >= 0) {
            list[i] = Object.assign({}, list[i], patch);
            saveAccounts(list);
            return list[i];
        }
        return null;
    }

    function apiError(res, fallback) {
        const msg = res && res.json && res.json.message;
        const err = new Error(msg || fallback || utils.Lang.wsErrServer);
        err.status = res ? res.status : 0;
        return err;
    }

    async function remember(server, data) {
        const user = data.user || {};
        const account = {
            id: accountId(server, user.id),
            server: server,
            user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar || null, organization: user.organization || '' },
            signedOut: false,
        };

        await secret('set', secretKey(account), data.tokens.refresh_token).then(r => {
            if (!r || !r.ok) throw new Error('not kept');
        });

        access[account.id] = { token: data.tokens.access_token, exp: Date.now() + (data.tokens.expires_in || 3600) * 1000 };

        const list = accounts().filter(a => a.id !== account.id);
        list.push(account);
        saveAccounts(list);
        setActive(account.id);
        return account;
    }

    function refresh(account) {
        if (refreshing[account.id]) return refreshing[account.id];

        const run = async (retry) => {
            const stored = await secret('get', secretKey(account)).catch(() => null);
            if (!stored || !stored.ok) throw signedOut(account);

            const res = await http('POST', account.server + '/api/auth/refresh', { refresh_token: stored.value });
            const tokens = res.json && res.json.data && res.json.data.tokens;

            if (res.status === 200 && tokens) {
                // The old refresh token is spent: keep the new one before anything else.
                await secret('set', secretKey(account), tokens.refresh_token);
                access[account.id] = { token: tokens.access_token, exp: Date.now() + (tokens.expires_in || 3600) * 1000 };
                if (account.signedOut) updateAccount(account.id, { signedOut: false });
                return tokens.access_token;
            }

            if (res.status === 409 && retry) {
                await new Promise(r => setTimeout(r, 1500));
                return run(false);
            }

            if (res.status === 401) throw signedOut(account);
            throw apiError(res);
        };

        refreshing[account.id] = run(true).finally(() => { delete refreshing[account.id]; });
        return refreshing[account.id];
    }

    function signedOut(account) {
        delete access[account.id];
        updateAccount(account.id, { signedOut: true });
        fire('changed');
        const err = new Error(utils.Lang.wsErrSignedOut);
        err.signedOut = true;
        return err;
    }

    async function token(account) {
        const a = access[account.id];
        if (a && a.exp - Date.now() > 60000) return a.token;
        return refresh(account);
    }

    async function api(account, method, path, body) {
        let res = await http(method, account.server + path, body, { 'Authorization': 'Bearer ' + await token(account) });

        if (res.status === 401) {
            delete access[account.id];
            res = await http(method, account.server + path, body, { 'Authorization': 'Bearer ' + await refresh(account) });
            if (res.status === 401) throw signedOut(account);
        }

        if (res.status < 200 || res.status >= 300 || !res.json || res.json.status === 'error')
            throw apiError(res);

        return res.json.data;
    }

    /* ------------------------------------------------------------------ *
     * signing in and out
     * ------------------------------------------------------------------ */

    /* Is there a WorkSuite server here that can sign WorkSuite Office in? */
    async function checkServer(server) {
        try {
            const res = await http('GET', server + '/.well-known/worksuite-desktop');
            if (res.status === 200 && res.json) return { name: res.json.name || 'WorkSuite', office: !!res.json.office_sign_in };
        } catch (e) { /* below */ }

        const health = await http('GET', server + '/api/health').catch(() => null);
        if (health && health.status === 200) return { name: 'WorkSuite', office: false };
        throw new Error(utils.Lang.wsErrServerNotFound);
    }

    async function signIn(server) {
        server = normalizeServer(server) || DEFAULT_SERVER;
        const pair = await pkce();
        const state = random(24);

        writeJson(localStorage, LS_PENDING, { server: server, verifier: pair.verifier, state: state, at: Date.now() });

        const query = 'challenge=' + encodeURIComponent(pair.challenge) + '&state=' + encodeURIComponent(state) +
                      '&device=' + encodeURIComponent(deviceName());
        window.open(server + '/desktop/office?' + query);
        fire('pending', server);
        return server;
    }

    /*
     * Through WorkSuite Desktop, when it is signed in on this computer: no browser. WorkSuite
     * Desktop asks the person to confirm, gets a code for WorkSuite Office with its own session
     * (/api/auth/apps/handoff) and sends it to worksuiteoffice://auth/callback, which finishes
     * exactly like a browser sign-in. The verifier never leaves this page.
     */
    async function signInWithDesktop(desktopAccount) {
        const server = normalizeServer(desktopAccount.server);
        const pair = await pkce();
        const state = random(24);

        writeJson(localStorage, LS_PENDING, { server: server, verifier: pair.verifier, state: state, at: Date.now(), via: 'desktop' });

        const query = 'client=' + CLIENT + '&server=' + encodeURIComponent(server) +
                      '&uid=' + encodeURIComponent(desktopAccount.user.id) +
                      '&challenge=' + encodeURIComponent(pair.challenge) + '&state=' + encodeURIComponent(state);
        window.open('worksuite://office/signin?' + query);
        fire('pending', server);
        return server;
    }

    let desktopWaiting = [];

    /* The accounts WorkSuite Desktop says it is signed in to here: names and addresses, never tokens */
    function desktopAccounts() {
        if (!window.sdk || !window.sdk.command) return Promise.resolve([]);

        return new Promise(resolve => {
            const handler = text => finish(parseDesktopAccounts(text));
            const timer = setTimeout(() => finish([]), 3000);
            const finish = list => {
                clearTimeout(timer);
                desktopWaiting = desktopWaiting.filter(f => f !== handler);
                resolve(list);
            };
            desktopWaiting.push(handler);
            window.sdk.command('worksuite:desktop', '');
        });
    }

    function parseDesktopAccounts(text) {
        let doc = null;
        try { doc = JSON.parse(text); } catch (e) { return []; }

        return (doc && Array.isArray(doc.accounts) ? doc.accounts : []).map(a => {
            const server = a && typeof a.server === 'string' && /^https:\/\//i.test(a.server) ? normalizeServer(a.server) : null;
            const user = (a && a.user) || {};
            if (!server || user.id === undefined || user.id === null || !user.name) return null;
            return {
                server: server,
                user: { id: user.id, name: String(user.name), email: String(user.email || ''), organization: String(user.organization || '') },
            };
        }).filter(Boolean);
    }

    function cancelSignIn() {
        writeJson(localStorage, LS_PENDING, undefined);
        fire('pending', null);
    }

    function pendingSignIn() {
        const p = readJson(localStorage, LS_PENDING, null);
        // a code lives two minutes; give the person ten to finish signing in
        return p && Date.now() - p.at < 10 * 60 * 1000 ? p : null;
    }

    function deviceName() {
        const ua = navigator.userAgent;
        return 'WorkSuite Office on ' + (/Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : 'Linux');
    }

    async function finishSignIn(params) {
        const pending = pendingSignIn();
        if (!pending || !params.get('state') || params.get('state') !== pending.state) {
            fire('error', new Error(utils.Lang.wsErrStale));
            return;
        }
        writeJson(localStorage, LS_PENDING, undefined);

        try {
            const res = await http('POST', pending.server + '/api/auth/apps/exchange',
                                   { client: CLIENT, code: params.get('code') || '', code_verifier: pending.verifier });
            if (res.status !== 200 || !res.json || !res.json.data || !res.json.data.tokens)
                throw apiError(res, utils.Lang.wsErrStale);

            const account = await remember(pending.server, res.json.data);
            fire('signedin', account);
        } catch (e) {
            fire('error', e);
        } finally {
            fire('pending', null);
        }
    }

    async function signOut(account) {
        try {
            const stored = await secret('get', secretKey(account)).catch(() => null);
            const bearer = access[account.id] ? { 'Authorization': 'Bearer ' + access[account.id].token } : {};
            await http('POST', account.server + '/api/auth/logout', stored && stored.ok ? { refresh_token: stored.value } : {}, bearer).catch(() => null);
        } finally {
            await secret('delete', secretKey(account)).catch(() => null);
            delete access[account.id];

            const list = accounts().filter(a => a.id !== account.id);
            saveAccounts(list);
            Object.keys(localStorage).filter(k => k.indexOf(LS_CACHE + account.id) === 0).forEach(k => localStorage.removeItem(k));

            // The editor tabs signed in to that server sign out with it, unless another account still uses it.
            if (!list.some(a => a.server === account.server))
                window.sdk && window.sdk.execCommand && window.sdk.execCommand('portal:logout', JSON.stringify({ domain: account.server }));

            if (localStorage.getItem(LS_ACTIVE) === account.id)
                list.length ? localStorage.setItem(LS_ACTIVE, list[0].id) : localStorage.removeItem(LS_ACTIVE);
            fire('changed');
        }
    }

    /* ------------------------------------------------------------------ *
     * Drive
     * ------------------------------------------------------------------ */

    function shapeFile(f) {
        const name = f.name || '';
        const ext = (f.extension || extOf(name)).toLowerCase();
        const level = f.access ? f.access.level : (f.role || null);
        return {
            kind: 'file',
            id: f.id,
            name: name,
            ext: ext,
            location: f.folder_path || f.folder_name || f.location || '',
            owner: f.owner_name || f.owner || '',
            modified: f.opened_at || f.last_at || f.updated_at || f.modified_at || f.created_at || '',
            level: level,
            starred: !!(f.starred || f.is_favorite),
        };
    }

    function shapeFolder(f) {
        return { kind: 'folder', id: f.id, name: f.name || '', owner: f.owner_name || '', modified: f.updated_at || '' };
    }

    /*
     * One list: 'recent' | 'shared' | 'starred' | 'drive' (with folder) | 'search' (with q).
     * Only Office files and PDFs are listed, with folders where browsing.
     */
    async function list(account, view, opts) {
        opts = opts || {};
        let data, items, breadcrumb = null;

        if (view === 'drive') {
            data = await api(account, 'GET', '/api/files/browse' + (opts.folder ? '?folder_id=' + encodeURIComponent(opts.folder) : ''));
            items = (data.folders || []).map(shapeFolder).concat((data.files || []).map(shapeFile));
            breadcrumb = data.breadcrumb || [];
        } else
        if (view === 'search') {
            data = await api(account, 'GET', '/api/files/search?limit=100&q=' + encodeURIComponent(opts.q || ''));
            items = (data.files || []).map(shapeFile);
        } else {
            const sort = view === 'recent' ? '&sort=opened&dir=desc' : '&sort=modified&dir=desc';
            data = await api(account, 'GET', '/api/drive/list?per_page=100&view=' + encodeURIComponent(view) + sort);
            items = (data.files || []).map(shapeFile);
        }

        items = items.filter(i => i.kind === 'folder' || OFFICE_EXT.includes(i.ext));
        const result = { items: items, breadcrumb: breadcrumb, at: Date.now() };

        if (view !== 'search')
            writeJson(localStorage, cacheKey(account, view, opts), result);
        return result;
    }

    function cacheKey(account, view, opts) {
        return LS_CACHE + account.id + ':' + view + (view === 'drive' ? ':' + (opts.folder || 'root') : '');
    }

    function cached(account, view, opts) {
        return view === 'search' ? null : readJson(localStorage, cacheKey(account, view, opts || {}), null);
    }

    /* ------------------------------------------------------------------ *
     * pictures of documents
     * ------------------------------------------------------------------ */

    // A picture's address (the server's signed /media link) is good for five hours at least; kept for four.
    const THUMB_TTL = 4 * 3600 * 1000;

    function thumbsKey(account) { return LS_CACHE + account.id + ':thumbs'; }

    /* Only an address on the account's own server, or https: the page loads it as an image, nothing more. */
    function pictureUrl(account, url) {
        return typeof url === 'string' && (url.indexOf(account.server + '/') === 0 || /^https:\/\//i.test(url)) ? url : null;
    }

    /* The pictures last seen for this account, id → address, while they are still good: the cached list shows them. */
    function cachedThumbs(account) {
        const all = readJson(localStorage, thumbsKey(account), {}) || {}, out = {}, now = Date.now();
        Object.keys(all).forEach(id => { if (all[id] && now - all[id].at < THUMB_TTL) out[id] = all[id].url; });
        return out;
    }

    /*
     * Pictures for these files (POST /api/files/office/thumbs): { thumbs: {id: address or null}, pending: [ids] }.
     * Only files the person may preview are answered. With `make` the server draws a few that have none, top
     * rows first; `pending` are the ones still to ask for.
     */
    async function thumbs(account, ids, make) {
        const data = await api(account, 'POST', '/api/files/office/thumbs', { ids: ids.slice(0, 100), make: !!make });
        const got = {}, now = Date.now();
        const all = readJson(localStorage, thumbsKey(account), {}) || {};

        Object.keys((data && data.thumbs) || {}).forEach(id => {
            got[id] = pictureUrl(account, data.thumbs[id]);
            if (got[id]) all[id] = { url: got[id], at: now };
            else delete all[id];
        });
        Object.keys(all).forEach(id => { if (!all[id] || now - all[id].at >= THUMB_TTL) delete all[id]; });
        writeJson(localStorage, thumbsKey(account), all);

        return { thumbs: got, pending: Array.isArray(data && data.pending) ? data.pending : [] };
    }

    async function open(account, file) {
        const pair = await pkce();
        const handed = await api(account, 'POST', '/api/auth/apps/handoff',
                                 { client: EDITOR_CLIENT, code_challenge: pair.challenge, code_challenge_method: 'S256' });

        let next = '/editor/' + encodeURIComponent(file.id) + '?name=' + encodeURIComponent(file.name);
        if (file.level === 'view') next += '&mode=VIEW';

        const fragment = 'code=' + encodeURIComponent(handed.code) + '&verifier=' + encodeURIComponent(pair.verifier) +
                         '&uid=' + encodeURIComponent(account.user.id) + '&next=' + encodeURIComponent(next);

        window.sdk.command('open:recent', JSON.stringify({
            id: -1,
            name: file.name,
            path: account.server + '/desktop/office/session#' + fragment,
            type: formatOf(file.ext),
            cloud: account.server,
            recovery: false,
        }));

        api(account, 'POST', '/api/drive/opened/' + encodeURIComponent(file.id)).catch(() => {});
    }

    async function create(account, type, name, folder) {
        const ext = { word: 'docx', cell: 'xlsx', slide: 'pptx' }[type];
        const data = await api(account, 'POST', '/api/files/create', { type: ext, name: name, folder_id: folder || null });
        const file = shapeFile(data.file || data);
        if (!file.name) file.name = name + '.' + ext;
        if (!file.ext) file.ext = ext;
        return file;
    }

    function folders(account, folder) {
        return api(account, 'GET', '/api/files/browse' + (folder ? '?folder_id=' + encodeURIComponent(folder) : ''))
            .then(d => ({ breadcrumb: d.breadcrumb || [], folders: (d.folders || []).map(shapeFolder), access: d.access }));
    }

    /* one file, by id: for "Open in WorkSuite Office" links */
    function details(account, id) {
        return api(account, 'GET', '/api/files/' + encodeURIComponent(id) + '/details').then(d => {
            const file = shapeFile(d.file || d);
            if (!file.id) file.id = id;
            return file;
        });
    }

    function star(account, file, on) {
        return api(account, 'POST', '/api/drive/star', { type: 'file', id: file.id, on: !!on });
    }

    function requestEdit(account, file) {
        return api(account, 'POST', '/api/drive/access/file/' + encodeURIComponent(file.id) + '/request-edit', {});
    }

    function openInBrowser(account, path) {
        window.open(account.server + (path || '/files'));
    }

    /* ------------------------------------------------------------------ *
     * links from the app: worksuiteoffice://auth/callback, worksuiteoffice://open
     * ------------------------------------------------------------------ */

    function onLink(link) {
        let url;
        try { url = new URL(link); } catch (e) { return; }
        const route = (url.host + url.pathname).replace(/\/+$/, '');

        if (route === 'auth/callback') {
            finishSignIn(url.searchParams);
        } else
        if (route === 'open' || route.indexOf('open/') === 0) {
            // worksuiteoffice://open?file=<id>&server=<host>[&name=<name>]
            const id = url.searchParams.get('file') || route.split('/')[1];
            const server = normalizeServer(url.searchParams.get('server'));
            const name = url.searchParams.get('name') || '';
            if (id) fire('openlink', { id: id, server: server, name: name });
        }
    }

    if (window.sdk && window.sdk.on) {
        window.sdk.on('on_native_message', (cmd, param) => {
            if (cmd === 'worksuite:secret') {
                let reply = null;
                try { reply = JSON.parse(param); } catch (e) { return; }
                const waiting = reply && secretWaiting[reply.req];
                if (waiting) {
                    delete secretWaiting[reply.req];
                    waiting(reply);
                }
            } else
            if (cmd === 'worksuite:link') {
                onLink(param);
            } else
            if (cmd === 'worksuite:desktop') {
                desktopWaiting.slice().forEach(f => f(param));
            }
        });
    }

    window.WorkSuite = {
        DEFAULT_SERVER: DEFAULT_SERVER,
        TYPES: TYPES,
        on: on,
        off: off,
        accounts: accounts,
        active: active,
        setActive: setActive,
        signIn: signIn,
        signInWithDesktop: signInWithDesktop,
        desktopAccounts: desktopAccounts,
        cancelSignIn: cancelSignIn,
        pendingSignIn: pendingSignIn,
        signOut: signOut,
        checkServer: checkServer,
        normalizeServer: normalizeServer,
        list: list,
        cached: cached,
        thumbs: thumbs,
        cachedThumbs: cachedThumbs,
        open: open,
        create: create,
        folders: folders,
        details: details,
        star: star,
        requestEdit: requestEdit,
        openInBrowser: openInBrowser,
        typeOf: typeOf,
        extOf: extOf,
        /* for tests */
        _sha256Ascii: sha256Ascii,
        _onLink: onLink,
    };
}();
