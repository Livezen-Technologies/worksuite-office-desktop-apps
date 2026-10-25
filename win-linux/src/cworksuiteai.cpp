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

#include "cworksuiteai.h"
#include "cworksuite.h"
#include <QCoreApplication>
#include <QDateTime>
#include <QDir>
#include <QEventLoop>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QProcess>
#include <QRegularExpression>
#include <QSettings>
#include <QStringList>
#include <QTimer>
#include <QUrl>
#include <QVariant>
#include <memory>
#include <vector>
#ifdef Q_OS_WIN
# include <windows.h>
#else
# include <errno.h>
# include <signal.h>
# include <sys/types.h>
#endif

namespace {
    const int START_TIMEOUT_MS = 20000;
    const int POLL_MS = 250;

    qint64 s_launchedPid = 0;
    bool s_starting = false;
    std::vector<std::function<void(const QJsonObject&)>> s_waiting;

    QString endpointFile()
    {
        return QDir::homePath() + "/.worksuite/ai/endpoint.json";
    }

    QString serviceBinary()
    {
#ifdef Q_OS_WIN
        return QCoreApplication::applicationDirPath() + "/worksuite-ai.exe";
#else
        return QCoreApplication::applicationDirPath() + "/worksuite-ai";
#endif
    }

    bool pidAlive(qint64 pid)
    {
        if ( pid <= 0 ) return false;
#ifdef Q_OS_WIN
        HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, (DWORD)pid);
        if ( !h ) return false;
        DWORD code = 0;
        const bool alive = GetExitCodeProcess(h, &code) && code == STILL_ACTIVE;
        CloseHandle(h);
        return alive;
#else
        return ::kill((pid_t)pid, 0) == 0 || errno == EPERM;
#endif
    }

    /* endpoint.json naming a live service, or an empty object */
    QJsonObject liveEndpoint()
    {
        QFile file(endpointFile());
        if ( !file.open(QIODevice::ReadOnly) || file.size() > 16 * 1024 )
            return {};
        const QJsonObject in = QJsonDocument::fromJson(file.readAll()).object();
        const int port = in.value("port").toInt();
        const QString token = in.value("token").toString();
        const qint64 pid = (qint64)in.value("pid").toDouble();
        if ( port <= 0 || port > 65535 || token.isEmpty() || token.size() > 512 || !pidAlive(pid) )
            return {};
        return QJsonObject{{"port", port}, {"token", token}, {"pid", (double)pid},
                           {"apiVersion", in.value("apiVersion").toVariant().toString()},
                           {"base", QString("http://127.0.0.1:%1/v1").arg(port)}};
    }

    QString compact(const QJsonObject& o)
    {
        return QString::fromUtf8(QJsonDocument(o).toJson(QJsonDocument::Compact));
    }

    /* ---- managed configuration, AI keys ---- */

    const char * const FEATURE_KEYS[][2] = {
        {"aiSpeechToText", "stt"}, {"aiSuggestions", "suggestions"}, {"aiCorrection", "correction"},
        {"aiTranslation", "translate"}, {"aiReadAloud", "tts"}, {"aiAssistant", "assistant"},
    };

    QJsonObject rawPolicy()
    {
        static const char * const KEYS[] = {"aiSpeechToText", "aiSuggestions", "aiCorrection", "aiTranslation", "aiReadAloud",
                                            "aiAssistant", "aiCloudAllowed", "aiApprovedModels", "aiMaxMemoryMB", "aiGpuAllowed",
                                            "aiDictionaryUrl", "aiCatalogUrl", "aiStoragePath"};
        QJsonObject out;
#ifdef Q_OS_WIN
        QSettings reg("HKEY_LOCAL_MACHINE\\Software\\Policies\\WorkSuite\\Office", QSettings::NativeFormat);
        for (const char * key : KEYS) {
            const QVariant v = reg.value(key);
            if ( !v.isValid() ) continue;
            if ( v.canConvert<QStringList>() && v.toStringList().size() > 1 )
                out[key] = QJsonArray::fromStringList(v.toStringList());      // REG_MULTI_SZ
            else if ( !v.toString().trimmed().isEmpty() )
                out[key] = v.toString().trimmed();                            // REG_SZ, or a DWORD read as text
        }
#else
        QFile file("/etc/worksuite-office/policy.json");
        if ( file.open(QIODevice::ReadOnly) && file.size() < 64 * 1024 ) {
            const QJsonObject in = QJsonDocument::fromJson(file.readAll()).object();
            for (const char * key : KEYS) {
                const QJsonValue v = in.value(key);
                if ( v.isBool() || v.isDouble() || v.isArray() || (v.isString() && !v.toString().trimmed().isEmpty()) )
                    out[key] = v;
            }
        }
#endif
        return out;
    }
}

QJsonObject CWorkSuiteAi::policy()
{
    const QJsonObject raw = rawPolicy();
    const bool off = CWorkSuite::policy().value("aiFunctions").toString().trimmed().toLower() == "off";

    QJsonObject features;
    for (const auto& k : FEATURE_KEYS)
        if ( off || raw.contains(k[0]) )
            features[k[1]] = off ? false : CWorkSuite::policyBool(raw.value(k[0]));

    QJsonArray approved;
    const QJsonValue models = raw.value("aiApprovedModels");
    if ( models.isArray() ) {
        for (const QJsonValue& v : models.toArray())
            if ( !v.toString().trimmed().isEmpty() ) approved.append(v.toString().trimmed());
    } else {
        static const QRegularExpression separators("[,;\\s]+");
        for (const QString& id : models.toString().split(separators))
            if ( !id.isEmpty() ) approved.append(id);
    }

    QJsonObject out{{"managed", off || !raw.isEmpty()}, {"features", features}, {"approvedModels", approved}};
    if ( off || raw.contains("aiCloudAllowed") )
        out["cloudAllowed"] = off ? false : CWorkSuite::policyBool(raw.value("aiCloudAllowed"));
    if ( raw.contains("aiGpuAllowed") )
        out["gpuAllowed"] = CWorkSuite::policyBool(raw.value("aiGpuAllowed"));
    if ( raw.contains("aiMaxMemoryMB") )
        out["maxMemMB"] = raw.value("aiMaxMemoryMB").toVariant().toInt();
    if ( raw.contains("aiDictionaryUrl") )
        out["orgDictionaryUrl"] = raw.value("aiDictionaryUrl").toString();
    if ( raw.contains("aiCatalogUrl") )
        out["catalogUrl"] = raw.value("aiCatalogUrl").toString();
    if ( raw.contains("aiStoragePath") )
        out["storagePath"] = raw.value("aiStoragePath").toString();
    return out;
}

bool CWorkSuiteAi::microphoneAllowed()
{
    const QJsonObject p = policy();
    return p.value("features").toObject().value("stt").toBool(true);
}

void CWorkSuiteAi::endpoint(const QString& json, std::function<void(const QString&)> reply)
{
    const QJsonObject in = QJsonDocument::fromJson(json.toUtf8()).object();
    const QString req = in.value("req").toString().left(64);
    const bool start = in.value("start").toBool(false);
    const QJsonObject pol = policy();

    auto answer = [req, pol, reply](QJsonObject out) {
        out["req"] = req;
        out["policy"] = pol;
        reply(compact(out));
    };

    if ( CWorkSuite::policy().value("aiFunctions").toString().trimmed().toLower() == "off" ) {
        answer({{"ok", false}, {"reason", "disabled-by-policy"}});
        return;
    }

    QJsonObject live = liveEndpoint();
    if ( !live.isEmpty() ) {
        live["ok"] = true;
        live["launched"] = s_launchedPid > 0 && (qint64)live.value("pid").toDouble() == s_launchedPid;
        answer(live);
        return;
    }
    if ( !start ) {
        answer({{"ok", false}, {"reason", "not-running"}});
        return;
    }

    s_waiting.push_back([answer](const QJsonObject& out) { answer(out); });
    if ( s_starting ) return;

    auto finish = [](const QJsonObject& out) {
        s_starting = false;
        auto waiting = std::move(s_waiting);
        s_waiting.clear();
        for (auto& w : waiting) w(out);
    };

    const QString bin = serviceBinary();
    if ( !QFileInfo(bin).isExecutable() ) {
        finish({{"ok", false}, {"reason", "not-installed"}});
        return;
    }

    qint64 pid = 0;
    s_starting = true;
    if ( !QProcess::startDetached(bin, QStringList(), QDir::homePath(), &pid) || pid <= 0 ) {
        finish({{"ok", false}, {"reason", "start-failed"}});
        return;
    }
    s_launchedPid = pid;

    auto * timer = new QTimer;
    const qint64 deadline = QDateTime::currentMSecsSinceEpoch() + START_TIMEOUT_MS;
    QObject::connect(timer, &QTimer::timeout, [timer, deadline, pid, finish]() {
        QJsonObject ep = liveEndpoint();
        QJsonObject out;
        if ( !ep.isEmpty() ) {
            ep["ok"] = true;
            ep["launched"] = (qint64)ep.value("pid").toDouble() == pid;
            out = ep;
        } else
        if ( !pidAlive(pid) ) {
            // a second service may have won the race and written the file; that one is fine too
            out = QJsonObject{{"ok", false}, {"reason", "start-failed"}};
        } else
        if ( QDateTime::currentMSecsSinceEpoch() > deadline ) {
            out = QJsonObject{{"ok", false}, {"reason", "timeout"}};
        } else return;

        timer->stop();
        timer->deleteLater();
        finish(out);
    });
    timer->start(POLL_MS);
}

void CWorkSuiteAi::stopIfIdle()
{
    if ( s_launchedPid <= 0 || !pidAlive(s_launchedPid) ) return;
    const QJsonObject ep = liveEndpoint();
    if ( ep.isEmpty() || (qint64)ep.value("pid").toDouble() != s_launchedPid ) return;

    QNetworkAccessManager nam;
    QNetworkRequest request(QUrl(ep.value("base").toString() + "/health"));
    request.setRawHeader("Authorization", "Bearer " + ep.value("token").toString().toUtf8());
    request.setRawHeader("Origin", "worksuite://office");
    QNetworkReply * r = nam.get(request);
    QEventLoop loop;
    QTimer::singleShot(1500, &loop, &QEventLoop::quit);
    QObject::connect(r, &QNetworkReply::finished, &loop, &QEventLoop::quit);
    loop.exec();
    if ( !r->isFinished() || r->error() != QNetworkReply::NoError ) {
        r->abort();
        r->deleteLater();
        return;
    }
    const QJsonObject health = QJsonDocument::fromJson(r->readAll()).object();
    r->deleteLater();
    if ( health.value("queueDepth").toInt() != 0 ) return;   // a download or job is running: it exits by itself when idle

#ifdef Q_OS_WIN
    if ( HANDLE h = OpenProcess(PROCESS_TERMINATE, FALSE, (DWORD)s_launchedPid) ) {
        TerminateProcess(h, 0);
        CloseHandle(h);
    }
#else
    ::kill((pid_t)s_launchedPid, SIGTERM);
#endif
    s_launchedPid = 0;
}
