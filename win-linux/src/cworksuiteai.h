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

#ifndef CWORKSUITEAI_H
#define CWORKSUITEAI_H

#include <QString>
#include <QJsonObject>
#include <functional>

/*
 * Local AI (docs/local-ai-bridge.md): the per-user service worksuite-ai, next to the app binary
 * (worksuite-ai.exe on Windows, worksuite-ai on Linux), found through ~/.worksuite/ai/endpoint.json
 * ({"port","token","pid","apiVersion"}, written by the service, readable by this user only).
 *
 * "ws-ai:endpoint", {"req":"…","start":true|false} in, from the start page or an editor tab:
 *   {"req","ok":true,"port","token","apiVersion","base","pid","launched","policy"}
 *   {"req","ok":false,"reason":"disabled-by-policy|not-running|not-installed|start-failed|timeout","policy"}
 * With start:true and no live service (no file, or its pid is gone) the app starts one and answers
 * once its endpoint.json names a live pid (up to 20 s). Answered asynchronously through `reply`.
 */
namespace CWorkSuiteAi
{
    void endpoint(const QString& json, std::function<void(const QString&)> reply);

    /* the AI part of the managed configuration (docs/managed-configuration.md), in GET /v1/policy's shape */
    QJsonObject policy();

    /* no AI at all (aiFunctions "off"), or speech to text turned off: the app does not enable media capture */
    bool microphoneAllowed();

    /* on app exit: stops the service when this app started it and it has nothing queued (GET /v1/health) */
    void stopIfIdle();
}

#endif // CWORKSUITEAI_H
