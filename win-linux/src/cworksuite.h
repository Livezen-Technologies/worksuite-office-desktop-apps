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

#ifndef CWORKSUITE_H
#define CWORKSUITE_H

#include <QString>
#include <QJsonObject>
#include <QJsonValue>
#include <functional>

/*
 * What the start page's WorkSuite section needs from the app (common/loginpage/src/worksuite.js).
 * Answered for the start page only, never for a web page in a tab
 * (CAscApplicationManagerWrapper::processCommonEvent).
 *
 * Secrets: WorkSuite sign-ins (refresh tokens), kept for the user by the operating system.
 *   Windows: Windows Credential Manager (generic credentials, this user only).
 *   Linux:   the Secret Service (GNOME Keyring, KWallet), through libsecret opened at run time
 *            (AUTH-13); sign-ins an older version kept in the file below move there and the file
 *            is deleted. Only when no Secret Service runs: a file in the app's data folder that
 *            only this user can read, and the start page shows a warning ("store":"file"). The
 *            WorkSuite OS broker keeps its own tokens and is not involved. No library is
 *            needed at build time.
 *
 * WorkSuite Desktop: the accounts WorkSuite Desktop is signed in to on this computer, so
 *   the start page can offer "Continue as <name>". Not a secret: WorkSuite Desktop writes
 *   names and addresses only, to <app data>/WorkSuite/desktop-accounts.json
 *   (%APPDATA% on Windows, $XDG_CONFIG_HOME or ~/.config on Linux).
 */
namespace CWorkSuite
{
    bool setSecret(const QString& key, const QString& value);
    QString secret(const QString& key);
    bool removeSecret(const QString& key);

    /* "worksuite:secret": {"op":"get|set|delete","key":"…","value":"…","req":"…"} in, {"req","ok","value"} out */
    QString handleSecret(const QString& json);

    /* "worksuite:desktop": the file WorkSuite Desktop keeps, as JSON, or {} */
    QString desktopAccounts();

    /* "worksuite:app", {"web":"https://…"}: WorkSuite Desktop on its Home (worksuite://home) when it is
     * installed — something here opens worksuite:// links — otherwise that address in the browser */
    void openApp(const QString& json);

    /* "worksuite:open", {"url":"…","req":"…"}: a sign-in, in the browser (an https page) or in WorkSuite
     * Desktop (worksuite://office/signin), opened by the system rather than by the page's popup handling,
     * which drops a link opened after an await. {"req","ok","reason"} out: "no-app" when nothing here
     * opens worksuite:// links */
    QString openLink(const QString& json);

    /* "worksuite:broker", {"method":"Status|GetAccessToken|SignIn","params":{…},"req":"…"}: on WorkSuite OS
     * (/etc/worksuite/os-release), one request to the OS credentials broker, worksuite-credentials, at
     * $XDG_RUNTIME_DIR/worksuite/credentials.sock (line JSON, one request per connection; Worksuite-OS
     * services/credentials). The refresh token never leaves the broker: the page gets an access token only.
     * Status also carries "device_server", the enrolled organisation's server (the device agent's status.json).
     * Asynchronous (a SignIn waits for the system browser, up to ten minutes); `reply` gets
     * {"req","ok","result","expires_at","error"}, error "not_os" anywhere but WorkSuite OS on Linux. */
    void brokerRequest(const QString& json, std::function<void(const QString&)> reply);

    /* "worksuite:share", {"file":"<Drive file id>"} from a WorkSuite Drive editor tab (DRV-10): the start page's
     * Share dialog for that file. The server is the tab's own https origin (`tabUrl`, the address the tab was
     * opened with), never one the page names. {"server","file"} out for the start page, or "" to ignore it. */
    QString shareRequest(const QString& tabUrl, const QString& json);

    /* ADM-01, ADM-02, CLD-02: what the organisation set for WorkSuite Office on this computer.
     *   Windows: HKLM\Software\Policies\WorkSuite\Office (Group Policy, or the MSI properties
     *            WS_SERVER, WS_LOCK_SERVER, WS_ALLOW_OTHER_CLOUDS, WS_UPDATE_CHANNEL, WS_UPDATE_AUTO,
     *            WS_USAGE_REPORTS, WS_AI_FUNCTIONS, WS_ORGANIZATION)
     *   Linux:   /etc/worksuite-office/policy.json
     * Value names: organization, server, lockServer, allowOtherClouds, updateChannel, updateAuto,
     * usageReports, aiFunctions (README "Managed configuration"). Empty values are left out. */
    QJsonObject policy();
    bool policyBool(const QJsonValue& v);

    /* "worksuite:policy", "": {"managed","source","policy":{…}} */
    QString policyAnswer();

    /* "worksuite:upload", {"req","url","token","path","fields":{…}}: DOC-07, an offline working copy
     * (only from <app data>/offline) posted as multipart "file" plus fields to
     * https://<server>/api/files/<id>/versions. `reply` gets {"req","status","body"} */
    void upload(const QString& json, std::function<void(const QString&)> reply);

    /* "worksuite:transfer": Clouds › WorkSuite Drive's uploads and downloads, which the file:// start page cannot make
     * itself. {"op":"chunk","req","url","token","index","data"} posts one part (base64) as multipart "chunk" plus
     * "chunk_index" to https://<server>/api/uploads/<uuid>/chunk → {"req","status","body"}.
     * {"op":"download","req","url","name"} saves https://<server>/media/<token> into Downloads, telling
     * {"req","received","total"} as it goes and {"req","status","done":true,"path"} at the end.
     * {"op":"cancel","req"} stops a download; {"op":"reveal","path"} shows a downloaded file's folder. */
    void transfer(const QString& json, std::function<void(const QString&)> reply);

    /* where offline working copies of Drive documents are kept (DOC-07) */
    QString offlineFolder();
}

#endif // CWORKSUITE_H
