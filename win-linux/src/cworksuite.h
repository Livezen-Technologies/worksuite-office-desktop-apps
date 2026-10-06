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

/*
 * What the start page's WorkSuite section needs from the app (common/loginpage/src/worksuite.js).
 * Answered for the start page only, never for a web page in a tab
 * (CAscApplicationManagerWrapper::processCommonEvent).
 *
 * Secrets: WorkSuite sign-ins (refresh tokens), kept for the user by the operating system.
 *   Windows: Windows Credential Manager (generic credentials, this user only).
 *   Linux:   a file in the app's data folder that only this user can read; no
 *            secret service is required at build or run time.
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
}

#endif // CWORKSUITE_H
