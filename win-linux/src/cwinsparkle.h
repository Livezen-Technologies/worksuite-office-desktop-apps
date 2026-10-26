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

#ifndef CWINSPARKLE_H
#define CWINSPARKLE_H

#include <QString>
#include <QJsonObject>

/*
 * WorkSuite Office self-update on Windows through WinSparkle (UPD-04, G-02). Compiled in only when
 * qmake saw WS_UPDATE_APPCAST_URL and WINSPARKLE_DIR (DEFINES WS_WINSPARKLE); the upstream update
 * service (_UPDMODULE) is then left out. Without WS_EDDSA_PUBLIC_KEY nothing starts: a build that
 * cannot verify an update must not offer one.
 *
 * Channel: the appcast address's /channels/<stable|beta>/ part, from the organisation's policy
 * (updateChannel) or the person's choice in Settings › WorkSuite ("Updates/channel" in the user
 * registry key, written by "worksuite:updates" {"op":"set","channel"}). A new channel is used from
 * the next start.
 *
 * Once WinSparkle has downloaded and verified an update it does not run the installer at once: the
 * start page shows "worksuite:update-ready", and the installer runs when the app closes ("Restart to
 * update" closes the app and opens it again afterwards).
 *
 * Download with progress (WinSparkle 0.9 reports none): the Updates card's Download ("op":"download") is
 * done by CWsUpdateDownload from the same appcast, with "worksuite:update-progress"
 * {state: downloading|verifying|ready|error|idle, received, total, version, cancellable, reason} to the
 * start page and "op":"cancel" to stop it. It refuses an item without sparkle:edSignature or length and
 * a file whose length or Ed25519 signature (WS_EDDSA_PUBLIC_KEY) does not match, deletes it, and then
 * opens WinSparkle's own window instead. A verified file is kept like WinSparkle's own download and runs
 * at exit. WinSparkle's did-find / did-not-find / skipped callbacks keep the card's "found" in step.
 */
namespace CWinSparkle
{
    /* at startup, after the main window exists */
    void init();
    /* on exit: runs a downloaded update, if any, then win_sparkle_cleanup() */
    void cleanup();

    bool active();

    /* "worksuite:updates" {"op":"get|set|check|download|cancel|restart",...} → the state for Settings › WorkSuite */
    QString command(const QJsonObject& in);
    /* About › Check for updates ("updates:action" "check") */
    void checkWithUi();
}

#endif // CWINSPARKLE_H
