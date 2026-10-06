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

#ifndef CSECRETSTORE_H
#define CSECRETSTORE_H

#include <QString>

/*
 * Small secrets kept for the user by the operating system: WorkSuite sign-ins
 * (refresh tokens) for the start page's WorkSuite section.
 *
 * Windows: Windows Credential Manager (generic credentials, this user only).
 * Linux:   a file in the app's data folder that only this user can read; no
 *          secret service is required at build or run time.
 *
 * The start page reaches it through the "worksuite:secret" command
 * (see CAscApplicationManagerWrapper::processCommonEvent).
 */
namespace CSecretStore
{
    bool set(const QString& key, const QString& value);
    QString get(const QString& key);
    bool remove(const QString& key);

    /* {"op":"get|set|delete","key":"…","value":"…","req":"…"} in, {"req","ok","value"} out */
    QString handle(const QString& json);
}

#endif // CSECRETSTORE_H
