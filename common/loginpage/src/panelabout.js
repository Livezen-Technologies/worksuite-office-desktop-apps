/*
 * (c) Copyright Ascensio System SIA 2010-2019
 *
 * This program is a free software product. You can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License (AGPL)
 * version 3 as published by the Free Software Foundation. In accordance with
 * Section 7(a) of the GNU AGPL its Section 15 shall be amended to the effect
 * that Ascensio System SIA expressly excludes the warranty of non-infringement
 * of any third-party rights.
 *
 * This program is distributed WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR  PURPOSE. For
 * details, see the GNU AGPL at: http://www.gnu.org/licenses/agpl-3.0.html
 *
 * The  interactive user interfaces in modified source and object code versions
 * of the Program must display Appropriate Legal Notices, as required under
 * Section 5 of the GNU AGPL version 3.
 *
 * All the Product's GUI elements, including illustrations and icon sets, as
 * well as technical writing content are licensed under the terms of the
 * Creative Commons Attribution-ShareAlike 4.0 International. See the License
 * terms at http://creativecommons.org/licenses/by-sa/4.0/legalcode
 *
*/

/*
    'about' panel
    controller + view
*/

+function(){ 'use strict'
    var ControllerAbout = function(args={}) {
        args.caption = 'About panel';
        this.action = "about";
    };

    ControllerAbout.prototype = Object.create(baseController.prototype);
    ControllerAbout.prototype.constructor = ControllerAbout;

    var ViewAbout = function(args) {
        var _lang = utils.Lang;

        args.tplPage = `<div class="action-panel ${args.action}"></div>`;
        args.itemcls = 'bottom extra';
        args.menu = '.main-column.tool-menu';
        args.field = '.main-column.col-center';
        // args.itemindex = 3;
        args.itemtext = _lang.actAbout;
        args.tplItem = 'nomenuitem';

        baseView.prototype.constructor.call(this, args);
    };

    // "Version 9.3.1 (Community)"; the full build number goes on its own line
    const version = function(opts) {
        const _lang = utils.Lang;
        const edition = opts.commercial === true ? _lang.aboutEditionCommercial : _lang.aboutEditionCommunity;
        const short = (opts.version || '').split('.').slice(0, 3).join('.');
        return _lang.aboutVersion.replace('$1', short).replace('$2', edition);
    };

    const build = function(opts) {
        let _ext_ver = '';
        if ( !!opts.arch ) _ext_ver += opts.arch;
        if ( !!opts.pkg ) _ext_ver += ` ${opts.pkg}`;

        let _build = utils.Lang.aboutBuild.replace('$1', opts.version || '');
        if ( !!_ext_ver ) _build += ` (${_ext_ver.trim()})`;
        return _build;
    };

    const linksRow = function(opts) {
        const _lang = utils.Lang;
        const _links = [];
        const _link = (url, text, cls) => `<a class="link ${cls}" draggable="false" href="#" data-url="${url}">${text}</a>`;

        if ( !!opts.license ) _links.push(_link(opts.license, _lang.aboutLicenseAgreement, 'ver-license'));
        if ( !!opts.source ) _links.push(_link(opts.source, _lang.aboutSourceCode, 'ver-source'));
        if ( !!opts.notices ) _links.push(_link(opts.notices, _lang.aboutThirdPartyNotices, 'ver-notices'));

        return _links.join('<span class="ver-links-sep">·</span>');
    };

    ViewAbout.prototype = Object.create(baseView.prototype);
    ViewAbout.prototype.constructor = ViewAbout;
    ViewAbout.prototype.paneltemplate = function(args) {
        var _opts = args.opts;
        // The license is linked from the row at the bottom when the app passes its url
        !!_opts.license && (_opts.edition = '');
        !!_opts.active && (_opts.edition = !!_opts.edition ? _opts.edition + ' ' + _opts.active : _opts.active);
        _opts.edition = !!_opts.edition ? `<div id="idx-ver-edition" class="about-field">${_opts.edition}</div>` : '';

        var _lang = utils.Lang;
        const _publisher = !!_opts.publisher ?
                    `<div class="ver-publisher about-field">${_lang.aboutBuiltBy.replace('$1', `<b>${_opts.publisher}</b>`)}</div>` : '';
        const _based_on = !!_opts.upstream ? `${_lang.aboutBasedOn.replace('$1', _opts.upstream)}<br>` : '';
        const _updates_status = `<section id="idx-update-cnt">
                                    <div class="status-field hbox">
                                        <svg class="icon" id="idx-update-status-icon">
                                            <use href=""></use>
                                        </svg>
                                        <label id="idx-update-status-text"></label>
                                    </div>
                                    <div class="status-field">
                                        <button id="idx-update-btnaction" class="btn btn--landing btn-update-action"></button>
                                    </div>
                                </section>`;
        let _html = `<div class="flexbox">
                        <div class="box-ver">
                            <section class="hbox">
                                <div id="idx-about-cut-logo" class="${_opts.logocls}">
                                    <svg class="ver-logo">
                                        <use id="idx-ver-logo--light" href="#idx-logo-light-eo" />
                                        <use id="idx-ver-logo--dark" href="#idx-logo-dark-eo" />
                                    </svg>
                                </div>
                                <div class="vbox">
                                    <p id="idx-about-appname">${_opts.appname}</p>
                                    <p id="idx-about-version">${version(_opts)}</p>
                                    <p id="idx-about-build">${build(_opts)}</p>
                                </div>
                            </section><p></p>
                            <div class="separator"></div>
                            ${_updates_status}
                            <div class="box-copyright">
                                <div id='id-features-available' l10n>${_lang.aboutProFeaturesAvailable}</div>
                                ${_opts.edition}
                                <a class="ver-checkupdate link hidden" draggable='false' data-state='check' href="#" l10n>${_lang.checkUpdates}</a>
                                <div class="about-field"><a class="ver-changelog link" draggable='false' target="popup" href=${_opts.changelog} l10n>${_lang.aboutChangelog}</a></div>
                                ${_publisher}
                                <a class="ver-site link about-field" target="popup" href="${_opts.link}"><b>${_opts.site}</b></a>
                                <div class="ver-copyright about-field">${_based_on}${_opts.rights}</div>
                                <div class="ver-links about-field">${linksRow(_opts)}</div>
                            </div>                    
                        </div>`+
                        // '<div class="box-license flex-fill">'+
                        //   '<iframe id="framelicense" src="license.htm"></iframe>'+
                        // '</div>'+
                    '</div>';

        if (window.utils.inParams.osver == 'winxp' || /windows nt 5/i.test(navigator.appVersion)) {
            _html = _html.replace(' href=', ' xlink:href=');
        }

        return _html;
    };

    window.ControllerAbout = ControllerAbout;

    utils.fn.extend(ControllerAbout.prototype, (function() {
        let features = undefined;
        let action = null;

        let _on_features_avalable = function (params) {
            if ( !!this.view ) {
                let _label = $('#id-features-available', this.view.$body);
                if ( _label )
                    if ( !!params )
                        _label.show();
                    else _label.hide();
            }

            if ( !Array.isArray(params) ) params = [];
            sdk.execCommand('extra:features', JSON.stringify({available:params}));
        };

        const _on_native_message = function(cmd, param) {
            if (/app\:version/.test(cmd)) {
                let args = {action: this.action};
                try {
                    args.opts = JSON.parse( $('<div>').html(param).text() );
                } catch (e) {
                    delete args.opts;
                }

                if (args.opts) {
                    !args.opts.site && (args.opts.site = utils.skipUrlProtocol(args.opts.link));
                }

                if (!this.view) {
                    this.view = new ViewAbout(args);
                    this.view.args = args;
                    this.view.$menuitem && this.view.$menuitem.removeClass('extra');
                    this.view.$body = $(this.view.paneltemplate(args));
                    this.view.$body.on('click', '.ver-links a[data-url]', e => {
                        e.preventDefault();
                        window.open($(e.currentTarget).data('url'));
                    });
                    this.view.$dialog = new AboutDialog();
                } else {
                    if ( !!args.opts && !!args.opts.edition ) {
                        $('#idx-ver-edition', this.view.$body).html(args.opts.edition);
                    }
                }

                // const $label = this.view.$panel.find('.ver-checkupdate');
                // $label.on('click', (e) => {
                //     if ( performance.now() - last_click_time < 1000 ) return;
                //     last_click_time = performance.now();

                //     window.sdk.execCommand('update', $label.data('state'));
                // });
                // $label[this.updates===true?'show':'hide']();
                if ( args.opts ) {
                    this.view.$body.find('.ver-changelog')[!!args.opts.changelog?'show':'hide']();
                }

                if ( !!features && features.length )
                    _on_features_avalable.call(this, features);
            } else
            if (/^updates:turn/.test(cmd)) {
                this.updates = param == 'on';

                if ( this.view ) {
                    // this.view.$panel.find('.ver-checkupdate')[this.updates?'show':'hide']();
                    this.view.$body.find('#idx-update-cnt')[this.updates?'show':'hide']();

                    if ( this.updates ) {
                        $('body').on('click', '.btn-update-action', e=>{
                            sdk.execCommand('updates:action', action);
                        });
                    }
                }
            } else
            if (/^updates:checking/.test(cmd)) {
                // const $label = this.view.$panel.find('.ver-checkupdate');
                // const opts = JSON.parse(param);
                // if ( opts.version == 'no' ) {
                //     $label.text(utils.Lang.updateNoUpdates);
                // } else {
                //     $label.text(utils.Lang.updateAvialable.replace('$1', opts.version));
                //     $label.data('state', 'download');
                // }
                // $label.show();
            } else
            if (/updates:download/.test(cmd)) {
                // const opts = JSON.parse(param);
                // const $label = this.view.$panel.find('.ver-checkupdate');

                // if ( opts.progress == 'done' ) {
                //     $label.text(utils.Lang.updateDownloadFinished);
                //     $label.data('state', 'install');
                // } else
                // if ( opts.progress == 'aborted' ) {
                //     $label.text(utils.Lang.updateDownloadCanceled);
                // } else {
                //     $label.text(utils.Lang.updateDownloadProgress.replace('$1', opts.progress));
                //     $label.data('state', 'abort');
                // }
            } else
            if (/updates:link/.test(cmd)) {
                // const $label = this.view.$panel.find('.ver-checkupdate');
                // let opts = {};
                // if ( param == 'lock' || param == 'unlock' )
                //     opts.disabled = param == 'lock';
                // else opts = JSON.parse(param);

                // if ( opts.disabled != undefined ) {
                    // $label.attr('disabled', opts.disabled ? 'disabled' : false);
                // }
            } else
            if (/updates:status/.test(cmd)) {
                on_updates_info.call(this, JSON.parse(param))
            }
        };

        const on_updates_info = function(info) {
                if ( info.text ) {
                    $('#idx-update-status-text', this.view.$body).text(info.text);
                }

                if ( info.icon ) {
                    const $icon = $('#idx-update-status-icon', this.view.$body);

                    let icon_id;
                    switch (info.icon) {
                    case 'error': icon_id = 'error'; break;
                    case 'load': icon_id = 'load'; break;
                    case 'lastcheck': icon_id = 'lastcheck'; break;
                    default: icon_id = 'success'; break;
                    }

                    $icon.attr('data-icon', icon_id);
                    $('use', $icon).attr('href', `#${icon_id}`)
                }

                if ( info.button ) {
                    const $button = $('#idx-update-btnaction', this.view.$body);
                    if ( info.button.text ) {
                        $button.text(info.button.text);
                        action = info.button.action;
                    }

                    if ( info.button.lock ) {
                        $button.disable(info.button.lock=='true');
                    }

                    if ( info.button == 'lock' ) {
                        $button.disable(true);
                    } else
                    if ( info.button == 'unlock' ) {
                        $button.disable(false);
                    }

                }
        }

        const onPanelShow = function(panel) {
            if (panel === this.action) {
                this.view.$dialog.show();
                this.view.$dialog.setBody(this.view.$body);
            }
        }

        return {
            init: function() {
                baseController.prototype.init.apply(this, arguments);

                window.sdk.on('on_native_message', _on_native_message.bind(this));

                if ( utils.brandCheck('onfeaturesavailable') ) {
                    features = sdk.GetLocalFeatures();
                    if ( !!features && features.length )
                        _on_features_avalable.call(this, features);

                    sdk.on('onfeaturesavailable', _on_features_avalable.bind(this));
                } else sdk.GetLocalFeatures = e => false;

                CommonEvents.on('panel:show', onPanelShow.bind(this));
                CommonEvents.on('lang:changed', () => {
                    if (this.view) {
                        this.view.$dialog.titleText = utils.Lang.actAbout;
                        const opts = this.view.args.opts;
                        $('#idx-about-version', this.view.$body).text(version(opts));
                        $('#idx-about-build', this.view.$body).text(build(opts));
                        $('.ver-links', this.view.$body).html(linksRow(opts));
                        !!opts.publisher && $('.ver-publisher', this.view.$body)
                                .html(utils.Lang.aboutBuiltBy.replace('$1', `<b>${opts.publisher}</b>`));
                        !!opts.upstream && $('.ver-copyright', this.view.$body)
                                .html(`${utils.Lang.aboutBasedOn.replace('$1', opts.upstream)}<br>${opts.rights}`);
                    }
                });

                return this;
            },
            onfeaturesavailable: _on_features_avalable
        }
    })());
}();

/*
*   controller definition
*/

// window.CommonEvents.on('main:ready', function(){
//     var p = new ControllerAbout({});
//     p.init();
// });
