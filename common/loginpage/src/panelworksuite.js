/*
 * The WorkSuite section of the home screen (above "On this computer"):
 * Recent, Shared with me, Starred, My Drive and Search from WorkSuite Drive,
 * with type filters, for the selected WorkSuite account. Signed out, it offers
 * "Sign in to WorkSuite". See worksuite.js for how signing in and opening work.
 */

+function () {
    'use strict';

    const esc = s => String(s === undefined || s === null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const isSvgIcons = window.devicePixelRatio >= 2 || window.devicePixelRatio === 1;
    const FORMAT_ICONS = ['csv','djvu','doc','docm','docx','docxf','dotm','dotx','epub','fb2','fodp','fods','fodt','html','md','odp','ods','odt','otp','ots','ott',
                          'pdf','potm','potx','pps','ppsm','ppsx','ppt','pptm','pptx','rtf','txt','xls','xlsb','xlsm','xlsx','xltm','xltx'];

    // How many times a list asks the server for more pictures while it is shown (three are drawn each time).
    const PICTURE_ROUNDS = 12;

    function hostOf(server) { return String(server || '').replace(/^https?:\/\//, ''); }

    function when(value) {
        if (!value) return '';
        const d = new Date(String(value).replace(' ', 'T'));
        if (isNaN(d.getTime())) return esc(value);
        const today = new Date();
        return d.toDateString() === today.toDateString() ?
            d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) :
            d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
    }

    /* ------------------------------------------------------------------ *
     * "Sign in to WorkSuite"
     * ------------------------------------------------------------------ */

    function DialogSignIn(params) {
        params = params || {};
        const _lang = utils.Lang;
        // "Continue as" chosen on the home screen: start with WorkSuite Desktop straight away
        this.desktopAccount = params.desktopAccount || null;

        Dialog.call(this, Object.assign(params, {
            dialogClass: 'dlg-worksuite-signin',
            titleText: _lang.wsSignInTitle,
            defaultWidth: 440,
            bodyTemplate: `
                <div class="ws-dlg">
                    <div class="ws-dlg-start">
                        <p class="text-description">${_lang.wsSignInDescr}</p>
                        <div class="ws-dlg-desktop"></div>
                        <div class="ws-dlg-accounts"></div>
                        <button class="btn btn--landing ws-dlg-signin">${_lang.wsSignInButton}</button>
                        <p class="ws-dlg-server text-secondary"></p>
                        <a class="link ws-dlg-other" href="#">${_lang.wsOtherServer}</a>
                        <div class="ws-dlg-custom" style="display:none">
                            <input type="text" class="tbox ws-dlg-url" spellcheck="false" placeholder="${_lang.wsServerPlaceholder}">
                        </div>
                        <p class="msg-error ws-dlg-error"></p>
                    </div>
                    <div class="ws-dlg-wait" style="display:none">
                        <div class="ws-spinner"></div>
                        <p class="text-normal ws-dlg-wait-text"></p>
                        <p class="text-secondary ws-dlg-wait-server"></p>
                        <div class="ws-dlg-buttons">
                            <button class="btn ws-dlg-again">${_lang.wsOpenAgain}</button>
                            <button class="btn ws-dlg-browser">${_lang.wsUseBrowser}</button>
                            <button class="btn ws-dlg-cancel">${_lang.wsCancel}</button>
                        </div>
                    </div>
                </div>`,
        }));
    }

    DialogSignIn.prototype = Object.create(Dialog.prototype);
    DialogSignIn.prototype.constructor = DialogSignIn;

    DialogSignIn.prototype.show = function (width) {
        Dialog.prototype.show.call(this, width);
        const $el = this.$el;
        const _lang = utils.Lang;
        let server = WorkSuite.DEFAULT_SERVER;

        const error = msg => $el.find('.ws-dlg-error').text(msg || '').toggle(!!msg);
        const showServer = () => $el.find('.ws-dlg-server').text(_lang.wsServerIs.replace('$1', hostOf(server)));
        error('');
        showServer();

        // "Continue as …" for accounts this app knew and that need to sign in again
        const $accounts = $el.find('.ws-dlg-accounts');
        WorkSuite.accounts().filter(a => a.signedOut).forEach(a => {
            const org = [a.user.organization, hostOf(a.server)].filter(Boolean).join(' · ');
            $(`<button class="btn ws-dlg-continue"><span class="ws-continue-name">${esc(_lang.wsContinueAs.replace('$1', a.user.name))}</span>
                 <span class="ws-continue-org text-secondary">${esc(org)}</span></button>`)
                .on('click', () => start(a.server))
                .appendTo($accounts);
        });

        const waiting = (target, viaDesktop) => {
            $el.find('.ws-dlg-start').hide();
            $el.find('.ws-dlg-wait-text').text(viaDesktop ? _lang.wsWaitDesktop : _lang.wsWaitBrowser);
            $el.find('.ws-dlg-wait-server').text(hostOf(target));
            $el.find('.ws-dlg-again').toggle(!viaDesktop);
            $el.find('.ws-dlg-browser').toggle(!!viaDesktop);
            $el.find('.ws-dlg-wait').show();
        };

        const start = async target => {
            error('');
            try {
                server = await WorkSuite.signIn(target);
                waiting(server, false);
            } catch (e) {
                error(e.message);
            }
        };

        // signed in to WorkSuite Desktop on this computer: one click, no browser
        const startDesktop = async account => {
            error('');
            try {
                server = await WorkSuite.signInWithDesktop(account);
                waiting(server, true);
            } catch (e) {
                error(e.message);
            }
        };

        const live = WorkSuite.accounts().filter(a => !a.signedOut).map(a => a.id);
        WorkSuite.desktopAccounts().then(list => {
            if (!this.$el) return;
            list = list.filter(d => !live.includes(d.server + '|' + d.user.id));
            list.forEach(d => {
                const org = [d.user.organization, hostOf(d.server)].filter(Boolean).join(' · ');
                $(`<button class="btn btn--landing ws-dlg-continue"><span class="ws-continue-name">${esc(_lang.wsContinueAs.replace('$1', d.user.name))}</span>
                     <span class="ws-continue-org">${esc(org)}</span><span class="ws-continue-via">${esc(_lang.wsViaDesktop)}</span></button>`)
                    .on('click', () => startDesktop(d))
                    .appendTo($el.find('.ws-dlg-desktop'));
            });
            // WorkSuite Desktop's accounts come first; the browser stays one click away
            if (list.length) $el.find('.ws-dlg-signin').removeClass('btn--landing');
        });

        $el.find('.ws-dlg-signin').on('click', async () => {
            const $url = $el.find('.ws-dlg-url');
            if ($url.is(':visible') && $url.val().trim()) {
                const candidate = WorkSuite.normalizeServer($url.val());
                if (!candidate) return error(_lang.wsErrServerNotFound);

                $el.find('.ws-dlg-signin').prop('disabled', true);
                try {
                    const found = await WorkSuite.checkServer(candidate);
                    if (!found.office) throw new Error(_lang.wsErrServerOld);
                    server = candidate;
                } catch (e) {
                    return error(e.message);
                } finally {
                    $el.find('.ws-dlg-signin').prop('disabled', false);
                }
            }
            start(server);
        });

        $el.find('.ws-dlg-other').on('click', e => {
            e.preventDefault();
            $el.find('.ws-dlg-other, .ws-dlg-server').hide();
            $el.find('.ws-dlg-custom').show().find('input').focus();
        });

        $el.find('.ws-dlg-url').on('keypress', e => { if (e.which === 13) $el.find('.ws-dlg-signin').click(); });
        $el.find('.ws-dlg-again, .ws-dlg-browser').on('click', () => start(server));
        $el.find('.ws-dlg-cancel').on('click', () => { WorkSuite.cancelSignIn(); this.close(); });

        this.done = () => this.$el && this.close();
        this.failed = e => {
            if (!this.$el) return;
            $el.find('.ws-dlg-wait').hide();
            $el.find('.ws-dlg-start').show();
            error(e.message);
        };
        WorkSuite.on('signedin', this.done);
        WorkSuite.on('error', this.failed);

        if (this.desktopAccount) startDesktop(this.desktopAccount);
    };

    DialogSignIn.prototype.close = function (opts) {
        WorkSuite.off('signedin', this.done);
        WorkSuite.off('error', this.failed);
        Dialog.prototype.close.call(this, opts);
        this.$el = null;
    };

    /* ------------------------------------------------------------------ *
     * "New document in WorkSuite Drive": name and folder
     * ------------------------------------------------------------------ */

    function DialogNew(params) {
        const _lang = utils.Lang;
        this.account = params.account;
        this.type = params.type;
        this.oncreated = params.oncreated;

        Dialog.call(this, Object.assign(params, {
            dialogClass: 'dlg-worksuite-new',
            titleText: { word: _lang.wsNewDocument, cell: _lang.wsNewSpreadsheet, slide: _lang.wsNewPresentation }[params.type],
            defaultWidth: 480,
            bodyTemplate: `
                <div class="ws-dlg">
                    <label class="text-secondary">${_lang.wsName}</label>
                    <input type="text" class="tbox ws-new-name" spellcheck="false">
                    <label class="text-secondary">${_lang.wsSaveIn}</label>
                    <div class="ws-picker">
                        <div class="ws-crumbs"></div>
                        <div class="ws-picker-list scrollable"></div>
                    </div>
                    <p class="msg-error ws-dlg-error"></p>
                    <div class="ws-dlg-buttons">
                        <button class="btn btn--landing ws-new-create">${_lang.wsCreate}</button>
                        <button class="btn ws-dlg-cancel">${_lang.wsCancel}</button>
                    </div>
                </div>`,
        }));
    }

    DialogNew.prototype = Object.create(Dialog.prototype);
    DialogNew.prototype.constructor = DialogNew;

    DialogNew.prototype.show = function (width) {
        Dialog.prototype.show.call(this, width);
        const $el = this.$el;
        const _lang = utils.Lang;
        let folder = null;

        const error = msg => $el.find('.ws-dlg-error').text(msg || '').toggle(!!msg);
        error('');
        $el.find('.ws-new-name').val({ word: _lang.wsUntitledDocument, cell: _lang.wsUntitledSpreadsheet, slide: _lang.wsUntitledPresentation }[this.type]).focus().select();

        const browse = async id => {
            folder = id;
            const $list = $el.find('.ws-picker-list').html(`<div class="ws-spinner"></div>`);
            try {
                const data = await WorkSuite.folders(this.account, id);
                const crumbs = [{ id: null, name: _lang.wsMyDrive }].concat(data.breadcrumb || []);
                $el.find('.ws-crumbs').html(crumbs.map((c, i) => i === crumbs.length - 1 ?
                    `<span>${esc(c.name)}</span>` : `<a href="#" data-id="${esc(c.id === null ? '' : c.id)}">${esc(c.name)}</a>`).join('<span class="sep">›</span>'));
                $list.html(data.folders.length ? data.folders.map(f =>
                    `<div class="ws-picker-item" data-id="${esc(f.id)}"><svg class="icon"><use xlink:href="#folder-small"></use></svg>${esc(f.name)}</div>`).join('') :
                    `<p class="text-secondary">${_lang.wsNoFolders}</p>`);
            } catch (e) {
                $list.html(`<p class="msg-error">${esc(e.message)}</p>`);
            }
        };

        $el.on('click', '.ws-crumbs a', e => { e.preventDefault(); browse($(e.currentTarget).data('id') || null); });
        $el.on('click', '.ws-picker-item', e => browse($(e.currentTarget).data('id')));
        $el.find('.ws-dlg-cancel').on('click', () => this.close());
        $el.find('.ws-new-name').on('keypress', e => { if (e.which === 13) $el.find('.ws-new-create').click(); });
        $el.find('.ws-new-create').on('click', async () => {
            const name = $el.find('.ws-new-name').val().trim();
            if (!name) return error(_lang.wsErrName);

            $el.find('.ws-new-create').prop('disabled', true);
            try {
                const file = await WorkSuite.create(this.account, this.type, name, folder);
                this.close();
                this.oncreated && this.oncreated(file);
            } catch (e) {
                error(e.message);
                $el.find('.ws-new-create').prop('disabled', false);
            }
        });

        browse(null);
    };

    /* ------------------------------------------------------------------ *
     * the section
     * ------------------------------------------------------------------ */

    const ControllerWorkSuite = function () {
        this.view = 'recent';
        this.filter = 'all';
        this.folder = null;
        this.query = '';
        this.seq = 0;
        this.thumbs = {};
    };

    ControllerWorkSuite.prototype.init = function () {
        const _lang = utils.Lang;
        const $container = $('.action-panel.recents #box-container');
        if (!$container.length) return this;

        this.$el = $(`
            <div id="box-worksuite">
                <div class="file-list-title ws-title">
                    <h3>${_lang.wsTitle}</h3>
                    <div class="ws-account"></div>
                    <span class="ws-spacer"></span>
                    <div class="ws-tools">
                        <input type="text" class="tbox ws-search" spellcheck="false" placeholder="${_lang.wsSearch}">
                        <button class="btn ws-new">${_lang.wsNew}</button>
                    </div>
                </div>
                <div class="ws-signedout">
                    <p class="text-normal">${_lang.wsSignedOutDescr}</p>
                    <div class="ws-desktop"></div>
                    <button class="btn btn--landing ws-signin">${_lang.wsSignInTitle}</button>
                </div>
                <div class="ws-signedin">
                    <div class="ws-bar">
                        <div class="ws-tabs">
                            <button data-view="recent">${_lang.wsRecent}</button>
                            <button data-view="shared">${_lang.wsShared}</button>
                            <button data-view="starred">${_lang.wsStarred}</button>
                            <button data-view="drive">${_lang.wsMyDrive}</button>
                            <button data-view="search" class="ws-tab-search">${_lang.wsSearchResults}</button>
                        </div>
                        <div class="ws-filters">
                            <button data-filter="all">${_lang.wsAll}</button>
                            <button data-filter="word">${_lang.wsDocuments}</button>
                            <button data-filter="cell">${_lang.wsSpreadsheets}</button>
                            <button data-filter="slide">${_lang.wsPresentations}</button>
                            <button data-filter="pdf">PDF</button>
                        </div>
                    </div>
                    <div class="ws-crumbs"></div>
                    <div class="file-list-head text-normal ws-grid">
                        <div class="col-name">${_lang.colFileName}</div>
                        <div class="col-location">${_lang.colLocation}</div>
                        <div class="col-owner">${_lang.wsOwner}</div>
                        <div class="col-date">${_lang.wsModified}</div>
                    </div>
                    <div class="file-list-body ws-list"></div>
                    <p class="ws-state text-secondary"></p>
                </div>
            </div>`).prependTo($container);

        this.$el.find('.ws-signin').on('click', () => this.signIn());
        this.$el.find('.ws-tabs').on('click', 'button', e => this.select($(e.currentTarget).data('view')));
        this.$el.find('.ws-filters').on('click', 'button', e => { this.filter = $(e.currentTarget).data('filter'); this.render(); });
        this.$el.find('.ws-crumbs').on('click', 'a', e => { e.preventDefault(); this.folder = $(e.currentTarget).data('id') || null; this.load(); });
        this.$el.find('.ws-search').on('keypress', e => {
            if (e.which === 13) {
                this.query = $(e.currentTarget).val().trim();
                if (this.query) this.select('search');
            }
        });
        this.$el.find('.ws-new').on('click', e => this.menu(e.currentTarget, [
            { caption: _lang.wsNewDocument, action: () => this.create('word') },
            { caption: _lang.wsNewSpreadsheet, action: () => this.create('cell') },
            { caption: _lang.wsNewPresentation, action: () => this.create('slide') },
        ]));
        // A picture that does not load (gone, no longer shared) gives its row the file-type icon back.
        this.$el.find('.ws-list')[0].addEventListener('error', e => {
            if (!e.target.classList || !e.target.classList.contains('ws-thumb')) return;
            const item = this.items && this.items[$(e.target).closest('.row').data('index')];
            if (item) delete this.thumbs[item.id];
            $(e.target).parent().removeClass('has-thumb');
            $(e.target).remove();
        }, true);
        this.$el.find('.ws-list')
            .on('click', '.row', e => this.activate($(e.currentTarget).data('index')))
            .on('contextmenu', '.row', e => { e.preventDefault(); this.context($(e.currentTarget).data('index'), e); })
            .on('click', '.btn-quick.more', e => { e.stopPropagation(); this.context($(e.currentTarget).closest('.row').data('index'), e); });

        $(document).on('mousedown.wsmenu', e => { if (!$(e.target).closest('.ws-popup').length) $('.ws-popup').remove(); });

        WorkSuite.on('changed', () => this.refresh());
        WorkSuite.on('signedin', () => {
            this.view = 'recent';
            this.folder = null;
            this.refresh();
            if (this.pendingLink) {
                const link = this.pendingLink;
                this.pendingLink = null;
                this.openLink(link);
            }
        });
        WorkSuite.on('openlink', link => this.openLink(link));
        WorkSuite.on('error', e => !this.dialog && this.state(e.message, true));

        this.refresh();
        return this;
    };

    ControllerWorkSuite.prototype.signIn = function (desktopAccount) {
        if (this.dialog) return;
        this.dialog = new DialogSignIn({ desktopAccount: desktopAccount || null, onclose: () => { this.dialog = null; } });
        this.dialog.show();
    };

    /* Signed out, but WorkSuite Desktop is signed in on this computer: "Continue as <name>", one click */
    ControllerWorkSuite.prototype.renderDesktop = function () {
        const _lang = utils.Lang;
        const $box = this.$el.find('.ws-desktop').empty();
        const live = WorkSuite.accounts().filter(a => !a.signedOut).map(a => a.id);

        WorkSuite.desktopAccounts().then(list => {
            const d = list.find(x => !live.includes(x.server + '|' + x.user.id));
            this.$el.find('.ws-signin').toggleClass('btn--landing', !d);
            if (!d) return;

            const org = [d.user.organization, hostOf(d.server)].filter(Boolean).join(' · ');
            $(`<button class="btn btn--landing ws-continue" title="${esc(_lang.wsViaDesktop)}">
                  <span class="ws-continue-name">${esc(_lang.wsContinueAs.replace('$1', d.user.name))}</span>
                  <span class="ws-continue-org">${esc(org)}</span></button>`)
                .on('click', () => this.signIn(d))
                .appendTo($box.empty());
        });
    };

    /* who is signed in, and the section's two faces */
    ControllerWorkSuite.prototype.refresh = function () {
        const account = WorkSuite.active();
        const live = account && !account.signedOut;
        this.account = account;

        this.$el.toggleClass('signed-in', !!live);
        this.$el.find('.ws-tools').toggle(!!live);
        this.$el.find('.ws-signedout').toggle(!live);
        this.$el.find('.ws-signedin').toggle(!!live);
        this.renderAccount();
        if (!live) this.renderDesktop();

        if (live) this.load();
    };

    ControllerWorkSuite.prototype.renderAccount = function () {
        const _lang = utils.Lang;
        const $acc = this.$el.find('.ws-account').empty();
        const all = WorkSuite.accounts();
        if (!all.length) return;

        const a = this.account;
        $(`<button class="btn-quick ws-account-btn" title="${esc(a.user.email || '')}">
              <span>${esc(a.user.name)}</span><span class="text-secondary">${esc([a.user.organization, hostOf(a.server)].filter(Boolean).join(' · '))}</span>
              <span class="caret"></span></button>`)
            .on('click', e => this.menu(e.currentTarget, all.map(x => ({
                caption: x.user.name + ' · ' + hostOf(x.server) + (x.signedOut ? ' (' + _lang.wsSignedOutShort + ')' : ''),
                checked: x.id === a.id,
                action: () => WorkSuite.setActive(x.id),
            })).concat([
                { separator: true },
                { caption: _lang.wsAddAccount, action: () => this.signIn() },
                { caption: _lang.wsOpenWeb, action: () => WorkSuite.openInBrowser(a, '/files') },
                { caption: _lang.wsSignOut.replace('$1', a.user.name), action: () => WorkSuite.signOut(a) },
            ])))
            .appendTo($acc);
    };

    ControllerWorkSuite.prototype.select = function (view) {
        this.view = view;
        if (view === 'drive') this.folder = null;
        this.load();
    };

    ControllerWorkSuite.prototype.load = async function () {
        const account = this.account;
        if (!account || account.signedOut) return;

        const opts = { folder: this.folder, q: this.query };
        const seq = ++this.seq;

        this.$el.find('.ws-tabs button').each((i, b) => $(b).toggleClass('selected', $(b).data('view') === this.view));
        this.$el.find('.ws-tab-search').toggle(this.view === 'search');

        // what we saw last time, straight away; then what the server says now
        const cached = WorkSuite.cached(account, this.view, opts);
        this.thumbs = WorkSuite.cachedThumbs(account);
        this.data = cached;
        this.render();
        this.state(cached ? '' : utils.Lang.wsLoading);

        try {
            const fresh = await WorkSuite.list(account, this.view, opts);
            if (seq !== this.seq) return;
            this.data = fresh;
            this.render();
            this.state(this.visible().length ? '' : (this.view === 'search' ? utils.Lang.wsNothingFound : utils.Lang.wsEmpty));
            this.pictures(account, seq);
        } catch (e) {
            if (seq !== this.seq || e.signedOut) return;
            this.state(cached ? utils.Lang.wsOffline : e.message, !cached);
        }
    };

    /*
     * Pictures of the documents in the list instead of their file-type icons. The server answers the ones it
     * has, and draws a few more each time it is asked, top rows first; the rest are asked for again, a few
     * rounds, while this list is the one shown. A list without pictures is still a list: failures are quiet.
     */
    ControllerWorkSuite.prototype.pictures = async function (account, seq) {
        let ids = ((this.data && this.data.items) || []).filter(i => i.kind === 'file').map(i => i.id).slice(0, 100);

        for (let round = 0; ids.length && round < PICTURE_ROUNDS; round++) {
            let answer;
            try {
                answer = await WorkSuite.thumbs(account, ids, true);
            } catch (e) {
                return;
            }
            if (seq !== this.seq) return;

            const changed = Object.keys(answer.thumbs).filter(id => (answer.thumbs[id] || null) !== (this.thumbs[id] || null));
            changed.forEach(id => { if (answer.thumbs[id]) this.thumbs[id] = answer.thumbs[id]; else delete this.thumbs[id]; });
            if (changed.length) this.paint(changed);

            // only what is still to be drawn; what the server tried and could not keeps its icon
            ids = answer.pending.filter(id => ids.includes(id));
        }
    };

    /* the icon (or picture) of these rows, again, without drawing the whole list */
    ControllerWorkSuite.prototype.paint = function (ids) {
        this.$el.find('.ws-list .row').each((i, row) => {
            const item = this.items && this.items[$(row).data('index')];
            if (item && item.kind === 'file' && ids.includes(String(item.id)))
                $(row).find('.col-name > .icon').replaceWith(this.icon(item));
        });
    };

    ControllerWorkSuite.prototype.icon = function (item) {
        const icon = item.kind === 'folder' ? 'folder-small' : (FORMAT_ICONS.includes(item.ext) ? item.ext : 'neutral');
        const fallback = !isSvgIcons ? `<i class="icon ${item.kind === 'folder' ? 'img-el folder' : 'img-format ' + esc(item.ext)}"></i>` : '';
        const thumb = item.kind === 'file' && this.thumbs[item.id];
        return `<div class="icon${thumb ? ' has-thumb' : ''}"><svg class="icon"><use xlink:href="#${icon}"></use></svg>${fallback}` +
               (thumb ? `<img class="ws-thumb" src="${esc(thumb)}" alt="" draggable="false">` : '') + '</div>';
    };

    ControllerWorkSuite.prototype.visible = function () {
        const items = (this.data && this.data.items) || [];
        return this.filter === 'all' ? items : items.filter(i => i.kind === 'folder' || WorkSuite.typeOf(i.ext) === this.filter);
    };

    ControllerWorkSuite.prototype.render = function () {
        const _lang = utils.Lang;
        this.$el.find('.ws-filters button').each((i, b) => $(b).toggleClass('selected', $(b).data('filter') === this.filter));

        const $crumbs = this.$el.find('.ws-crumbs').empty();
        if (this.view === 'drive') {
            const crumbs = [{ id: null, name: _lang.wsMyDrive }].concat((this.data && this.data.breadcrumb) || []);
            $crumbs.html(crumbs.map((c, i) => i === crumbs.length - 1 ?
                `<span>${esc(c.name)}</span>` : `<a href="#" data-id="${esc(c.id === null ? '' : c.id)}">${esc(c.name)}</a>`).join('<span class="sep">›</span>'));
        }
        $crumbs.toggle(this.view === 'drive');

        this.items = this.visible();
        this.$el.find('.ws-list').html(this.items.map((item, index) => {
            const dot = item.name.lastIndexOf('.');
            const base = item.kind === 'file' && dot > 0 ? item.name.substring(0, dot) : item.name;
            const ext = item.kind === 'file' && dot > 0 ? item.name.substring(dot) : '';
            const readonly = item.level === 'view' ? `<span class="ws-badge">${_lang.wsViewOnly}</span>` : '';
            return `
                <div class="row text-normal ws-grid" data-index="${index}">
                    <div class="col-name" title="${esc(item.name)}">
                        ${this.icon(item)}
                        <p class="name">${esc(base)}<span class="ext">${esc(ext)}</span></p>${readonly}
                    </div>
                    <div class="col-location" title="${esc(item.location)}">${esc(item.location)}</div>
                    <div class="col-owner">${esc(item.owner)}</div>
                    <div class="col-date"><p>${when(item.modified)}</p></div>
                    <div class="col-more">${item.kind === 'file' ? `<button class="btn-quick more"><svg class="icon"><use xlink:href="#more"/></svg></button>` : ''}</div>
                </div>`;
        }).join(''));
    };

    ControllerWorkSuite.prototype.state = function (text, error) {
        this.$el.find('.ws-state').text(text || '').toggleClass('msg-error', !!error).toggle(!!text);
    };

    ControllerWorkSuite.prototype.activate = function (index) {
        const item = this.items && this.items[index];
        if (!item) return;

        if (item.kind === 'folder') {
            this.view = 'drive';
            this.folder = item.id;
            this.load();
        } else this.open(item);
    };

    ControllerWorkSuite.prototype.open = async function (file, account) {
        account = account || this.account;
        if (performance.now() - (this.lastOpen || 0) < 1000) return;
        this.lastOpen = performance.now();

        try {
            await WorkSuite.open(account, file);
        } catch (e) {
            !e.signedOut && this.state(e.message, true);
        }
    };

    ControllerWorkSuite.prototype.context = function (index, e) {
        const _lang = utils.Lang;
        const item = this.items && this.items[index];
        if (!item || item.kind !== 'file') return;

        const items = [{ caption: _lang.menuFileOpen, action: () => this.open(item) }];
        if (item.level === 'view')
            items.push({ caption: _lang.wsRequestEdit, action: () => WorkSuite.requestEdit(this.account, item)
                .then(() => this.state(_lang.wsRequestSent), err => this.state(err.message, true)) });
        items.push({ caption: item.starred ? _lang.wsUnstar : _lang.wsStar, action: () => WorkSuite.star(this.account, item, !item.starred)
            .then(() => this.load(), err => this.state(err.message, true)) });
        items.push({ caption: _lang.wsShareInBrowser, action: () => WorkSuite.openInBrowser(this.account, '/files?file=' + encodeURIComponent(item.id)) });

        this.menu({ x: e.clientX, y: e.clientY }, items);
    };

    ControllerWorkSuite.prototype.create = function (type) {
        new DialogNew({
            account: this.account,
            type: type,
            oncreated: file => { this.open(file); this.load(); },
        }).show();
    };

    /* worksuiteoffice://open?file=<id>&server=<host> — from WorkSuite Desktop or a chat card */
    ControllerWorkSuite.prototype.openLink = async function (link) {
        const all = WorkSuite.accounts().filter(a => !a.signedOut);
        const current = this.account && !this.account.signedOut ? this.account : null;
        const account = link.server ?
                (current && current.server === link.server ? current : all.find(a => a.server === link.server)) :
                current;

        if (!account) {
            // sign in first (signedin brings it back here), then open it
            this.pendingLink = link;
            this.signIn();
            return;
        }

        if (!current || account.id !== current.id) WorkSuite.setActive(account.id);

        try {
            this.open(await WorkSuite.details(account, link.id), account);
        } catch (e) {
            !e.signedOut && this.state(e.message, true);
        }
    };

    /* a small popup menu at an element or a point */
    ControllerWorkSuite.prototype.menu = function (at, items) {
        $('.ws-popup').remove();
        const $menu = $('<ul class="ws-popup dropdown-menu"></ul>');
        items.forEach(it => {
            if (it.separator) return $menu.append('<li class="divider"></li>');
            $(`<li><a href="#" class="${it.checked ? 'checked' : ''}">${esc(it.caption)}</a></li>`)
                .on('click', e => { e.preventDefault(); $menu.remove(); it.action(); })
                .appendTo($menu);
        });
        $menu.appendTo('body');

        let x, y;
        if (at.x !== undefined) { x = at.x; y = at.y; }
        else { const r = at.getBoundingClientRect(); x = r.left; y = r.bottom + 2; }
        x = Math.min(x, window.innerWidth - $menu.outerWidth() - 8);
        y = Math.min(y, window.innerHeight - $menu.outerHeight() - 8);
        $menu.css({ left: Math.max(8, x), top: Math.max(8, y) });
    };

    window.ControllerWorkSuite = ControllerWorkSuite;
    window.DialogWorkSuiteSignIn = DialogSignIn;
}();
