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

#ifndef CWORKSUITEMCP_H
#define CWORKSUITEMCP_H

#include <QString>
#include <functional>

/*
 * Settings › AI & MCP Connectors (common/loginpage/src/settings/ai-connectors): the transports the
 * start page's MCP client and AI provider checks need, and the secrets they use. The MCP protocol
 * itself (initialize, tools/list, …) runs in the page (mcp-client.js); this only moves bytes, so that
 *   - a stdio server (a local command) can be started at all — a web page cannot start processes;
 *   - a remote server or AI provider can be reached from the file:// page without CORS;
 *   - API keys never reach the page: they are kept by CWorkSuite::setSecret (Windows Credential
 *     Manager, the Secret Service on Linux) under "ai:…" keys and added to a request or a server's
 *     environment here. There is no way to read one back.
 *
 * "ws-mcp", {"op","req",…} in from the start page only; answers and events go to the start page as
 * "ws-mcp" too:
 *   http   {url, method:"GET|POST|DELETE", headers:{}, body, timeoutMs,
 *           auth:{secret:"ai:…", header:"Authorization", prefix:"Bearer "}}
 *          → {req, ok, status, headers:{content-type, mcp-session-id, www-authenticate}, body, error}
 *          The secret is added only over https or to a loopback address. Redirects are not followed.
 *   spawn  {id, command, args:[], env:{}, secretEnv:{NAME:"ai:…"}, cwd} → {req, ok, pid, error}
 *          then events {op:"stdout", id, line} (one per line), {op:"stderr", id, text}, {op:"exit", id, code, error}
 *   write  {id, data}  one line to the process's stdin (a newline is added); {req, ok, error}
 *   kill   {id}
 *   secret-set {key, value}, secret-delete {key}, secret-has {key} → {req, ok, has, store}
 * Errors: bad-request, bad-url, insecure-secret, not-found (command), spawn-failed, too-many, no-process,
 * timeout, network, secret-store.
 */
namespace CWorkSuiteMcp
{
    void handle(const QString& json, std::function<void(const QString&)> reply);

    /* on app exit: stops the stdio servers the page started */
    void shutdown();
}

#endif // CWORKSUITEMCP_H
