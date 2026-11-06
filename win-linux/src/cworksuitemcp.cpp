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

#include "cworksuitemcp.h"
#include "cworksuite.h"
#include <QByteArray>
#include <QDir>
#include <QFileInfo>
#include <QHash>
#include <QHostAddress>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QPointer>
#include <QProcess>
#include <QProcessEnvironment>
#include <QRegularExpression>
#include <QStandardPaths>
#include <QTimer>
#include <QUrl>
#include <memory>

namespace {
    const int MAX_PROCESSES = 16;
    const int MAX_BODY = 8 * 1024 * 1024;
    const int MAX_LINE = 8 * 1024 * 1024;
    const int MAX_STDERR = 4096;
    const int DEFAULT_TIMEOUT_MS = 30000;
    const int MAX_TIMEOUT_MS = 300000;

    typedef std::function<void(const QString&)> Reply;

    struct Server {
        QPointer<QProcess> process;
        QByteArray buffer;
    };

    QHash<QString, std::shared_ptr<Server>>& servers()
    {
        static QHash<QString, std::shared_ptr<Server>> s;
        return s;
    }

    QNetworkAccessManager * nam()
    {
        static QNetworkAccessManager * n = new QNetworkAccessManager();
        return n;
    }

    void answer(const Reply& reply, const QJsonObject& out)
    {
        reply(QString::fromUtf8(QJsonDocument(out).toJson(QJsonDocument::Compact)));
    }

    QJsonObject failure(const QJsonValue& req, const QString& error, const QString& detail = QString())
    {
        QJsonObject out{{"req", req}, {"ok", false}, {"error", error}};
        if ( !detail.isEmpty() ) out["detail"] = detail.left(500);
        return out;
    }

    /* ours only, so the page cannot reach the WorkSuite sign-ins through this command */
    bool validSecretKey(const QString& key)
    {
        static const QRegularExpression re("^ai:[A-Za-z0-9_.:-]{1,180}$");
        return re.match(key).hasMatch();
    }

    bool validId(const QString& id)
    {
        static const QRegularExpression re("^[A-Za-z0-9_-]{1,64}$");
        return re.match(id).hasMatch();
    }

    bool validHeaderName(const QString& name)
    {
        static const QRegularExpression re("^[A-Za-z0-9-]{1,64}$");
        return re.match(name).hasMatch();
    }

    bool validHeaderValue(const QString& value)
    {
        return value.size() <= 8192 && !value.contains('\r') && !value.contains('\n') && !value.contains(QChar(0));
    }

    bool validEnvName(const QString& name)
    {
        static const QRegularExpression re("^[A-Za-z_][A-Za-z0-9_]{0,127}$");
        return re.match(name).hasMatch();
    }

    bool loopback(const QUrl& url)
    {
        const QString host = url.host().toLower();
        if ( host == "localhost" ) return true;
        QHostAddress address;
        return address.setAddress(host) && address.isLoopback();
    }

    QString storeName()
    {
#ifdef Q_OS_WIN
        return "os";
#else
        return "secret-service";
#endif
    }

    void opHttp(const QJsonObject& in, const Reply& reply)
    {
        const QJsonValue req = in.value("req");
        const QUrl url(in.value("url").toString(), QUrl::StrictMode);
        const QString scheme = url.scheme().toLower();
        if ( !url.isValid() || (scheme != "https" && scheme != "http") || url.host().isEmpty() || !url.userInfo().isEmpty() ) {
            answer(reply, failure(req, "bad-url"));
            return;
        }

        QNetworkRequest request(url);
        request.setAttribute(QNetworkRequest::FollowRedirectsAttribute, false);
        const QJsonObject headers = in.value("headers").toObject();
        for ( auto it = headers.constBegin(); it != headers.constEnd(); ++it ) {
            const QString value = it.value().toString();
            if ( !validHeaderName(it.key()) || !validHeaderValue(value) ) {
                answer(reply, failure(req, "bad-request", "header " + it.key()));
                return;
            }
            request.setRawHeader(it.key().toLatin1(), value.toUtf8());
        }

        const QJsonObject auth = in.value("auth").toObject();
        if ( !auth.isEmpty() ) {
            const QString key = auth.value("secret").toString();
            const QString header = auth.value("header").toString("Authorization");
            const QString prefix = auth.value("prefix").toString();
            if ( !validSecretKey(key) || !validHeaderName(header) || !validHeaderValue(prefix) ) {
                answer(reply, failure(req, "bad-request", "auth"));
                return;
            }
            // a key never travels in clear text off this computer
            if ( scheme != "https" && !loopback(url) ) {
                answer(reply, failure(req, "insecure-secret"));
                return;
            }
            const QString value = CWorkSuite::secret(key);
            if ( value.isEmpty() ) {
                answer(reply, failure(req, "secret-store", "no secret saved"));
                return;
            }
            if ( !validHeaderValue(value) ) {
                answer(reply, failure(req, "secret-store", "the saved secret is not a valid header value"));
                return;
            }
            request.setRawHeader(header.toLatin1(), (prefix + value).toUtf8());
        }

        const QString method = in.value("method").toString("POST").toUpper();
        const QByteArray body = in.value("body").toString().toUtf8();
        QNetworkReply * r = nullptr;
        if ( method == "GET" ) r = nam()->get(request);
        else if ( method == "DELETE" ) r = nam()->deleteResource(request);
        else if ( method == "POST" ) r = nam()->post(request, body);
        else {
            answer(reply, failure(req, "bad-request", "method"));
            return;
        }

        int timeout = in.value("timeoutMs").toInt(DEFAULT_TIMEOUT_MS);
        if ( timeout <= 0 || timeout > MAX_TIMEOUT_MS ) timeout = DEFAULT_TIMEOUT_MS;
        auto timedOut = std::make_shared<bool>(false);
        QTimer * timer = new QTimer(r);
        timer->setSingleShot(true);
        QObject::connect(timer, &QTimer::timeout, r, [r, timedOut]() { *timedOut = true; r->abort(); });
        timer->start(timeout);

        QObject::connect(r, &QNetworkReply::finished, [r, req, reply, timedOut]() {
            const int status = r->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
            const QByteArray data = r->read(MAX_BODY);
            QJsonObject out{{"req", req}, {"status", status}};
            QJsonObject h;
            for ( const char * name : {"content-type", "mcp-session-id", "www-authenticate", "location"} ) {
                if ( r->hasRawHeader(name) ) h[name] = QString::fromUtf8(r->rawHeader(name));
            }
            out["headers"] = h;
            out["body"] = QString::fromUtf8(data);
            if ( *timedOut ) {
                out["ok"] = false;
                out["error"] = "timeout";
            } else
            if ( status == 0 ) {
                out["ok"] = false;
                out["error"] = "network";
                out["detail"] = r->errorString().left(500);
            } else {
                out["ok"] = status >= 200 && status < 300;
            }
            answer(reply, out);
            r->deleteLater();
        });
    }

    QString resolveCommand(const QString& command, const QProcessEnvironment& env)
    {
        if ( command.contains('/') || command.contains('\\') ) {
            const QFileInfo info(QDir::fromNativeSeparators(command));
            return info.isFile() && info.isExecutable() ? info.absoluteFilePath() : QString();
        }
#ifdef Q_OS_WIN
        const QChar separator(';');
#else
        const QChar separator(':');
#endif
#if QT_VERSION >= QT_VERSION_CHECK(5, 14, 0)
        const QStringList path = env.value("PATH").split(separator, Qt::SkipEmptyParts);
#else
        const QStringList path = env.value("PATH").split(separator, QString::SkipEmptyParts);
#endif
        // findExecutable tries PATHEXT on Windows, so "npx" finds npx.cmd
        return QStandardPaths::findExecutable(command, path);
    }

    void opSpawn(const QJsonObject& in, const Reply& reply)
    {
        const QJsonValue req = in.value("req");
        const QString id = in.value("id").toString();
        const QString command = in.value("command").toString().trimmed();
        if ( !validId(id) || command.isEmpty() || command.size() > 1024 ) {
            answer(reply, failure(req, "bad-request"));
            return;
        }
        if ( servers().contains(id) ) {
            std::shared_ptr<Server> old = servers().take(id);
            if ( old->process ) { old->process->kill(); old->process->deleteLater(); }
        }
        if ( servers().size() >= MAX_PROCESSES ) {
            answer(reply, failure(req, "too-many"));
            return;
        }

        QProcessEnvironment env = QProcessEnvironment::systemEnvironment();
        const QJsonObject vars = in.value("env").toObject();
        for ( auto it = vars.constBegin(); it != vars.constEnd(); ++it ) {
            if ( !validEnvName(it.key()) ) { answer(reply, failure(req, "bad-request", "env " + it.key())); return; }
            env.insert(it.key(), it.value().toString());
        }
        const QJsonObject secretVars = in.value("secretEnv").toObject();
        for ( auto it = secretVars.constBegin(); it != secretVars.constEnd(); ++it ) {
            const QString key = it.value().toString();
            if ( !validEnvName(it.key()) || !validSecretKey(key) ) { answer(reply, failure(req, "bad-request", "env " + it.key())); return; }
            const QString value = CWorkSuite::secret(key);
            if ( value.isEmpty() ) { answer(reply, failure(req, "secret-store", it.key())); return; }
            env.insert(it.key(), value);
        }

        const QString program = resolveCommand(command, env);
        if ( program.isEmpty() ) {
            answer(reply, failure(req, "not-found", command));
            return;
        }

        QStringList args;
        for ( const QJsonValue& a : in.value("args").toArray() ) args.append(a.toString());

        auto server = std::make_shared<Server>();
        QProcess * p = new QProcess();
        server->process = p;
        p->setProcessEnvironment(env);
        p->setProcessChannelMode(QProcess::SeparateChannels);
        const QString cwd = in.value("cwd").toString();
        if ( !cwd.isEmpty() ) {
            if ( !QFileInfo(cwd).isDir() ) { delete p; answer(reply, failure(req, "bad-request", "cwd")); return; }
            p->setWorkingDirectory(cwd);
        }

        auto started = std::make_shared<bool>(false);
        QObject::connect(p, &QProcess::started, [p, req, reply, started]() {
            *started = true;
            answer(reply, QJsonObject{{"req", req}, {"ok", true}, {"pid", double(p->processId())}});
        });
        QObject::connect(p, &QProcess::readyReadStandardOutput, [p, id, reply]() {
            std::shared_ptr<Server> s = servers().value(id);
            if ( !s || s->process != p ) return;
            s->buffer.append(p->readAllStandardOutput());
            int nl;
            while ( (nl = s->buffer.indexOf('\n')) >= 0 ) {
                const QByteArray line = s->buffer.left(nl).trimmed();
                s->buffer.remove(0, nl + 1);
                if ( !line.isEmpty() )
                    answer(reply, QJsonObject{{"op", "stdout"}, {"id", id}, {"line", QString::fromUtf8(line)}});
            }
            if ( s->buffer.size() > MAX_LINE ) {
                s->buffer.clear();
                answer(reply, QJsonObject{{"op", "stderr"}, {"id", id}, {"text", "worksuite: a message longer than 8 MB was dropped"}});
            }
        });
        QObject::connect(p, &QProcess::readyReadStandardError, [p, id, reply]() {
            const QByteArray text = p->readAllStandardError();
            answer(reply, QJsonObject{{"op", "stderr"}, {"id", id}, {"text", QString::fromUtf8(text.right(MAX_STDERR))}});
        });
        QObject::connect(p, &QProcess::errorOccurred, [p, id, req, reply, started](QProcess::ProcessError error) {
            if ( error == QProcess::FailedToStart && !*started ) {
                answer(reply, failure(req, "spawn-failed", p->errorString()));
                std::shared_ptr<Server> s = servers().value(id);
                if ( s && s->process == p ) servers().remove(id);
                p->deleteLater();
            }
        });
        QObject::connect(p, static_cast<void (QProcess::*)(int, QProcess::ExitStatus)>(&QProcess::finished),
                         [p, id, reply](int code, QProcess::ExitStatus status) {
            QJsonObject out{{"op", "exit"}, {"id", id}, {"code", code}};
            if ( status == QProcess::CrashExit ) out["error"] = "crashed";
            answer(reply, out);
            std::shared_ptr<Server> s = servers().value(id);
            if ( s && s->process == p ) servers().remove(id);
            p->deleteLater();
        });

        servers().insert(id, server);
        p->start(program, args);
    }

    void opWrite(const QJsonObject& in, const Reply& reply)
    {
        const QString id = in.value("id").toString();
        std::shared_ptr<Server> s = servers().value(id);
        if ( !s || !s->process || s->process->state() != QProcess::Running ) {
            answer(reply, failure(in.value("req"), "no-process"));
            return;
        }
        QByteArray data = in.value("data").toString().toUtf8();
        data.replace('\n', ' ');   // JSON-RPC over stdio is one message per line
        data.append('\n');
        s->process->write(data);
    }

    void opKill(const QJsonObject& in)
    {
        std::shared_ptr<Server> s = servers().take(in.value("id").toString());
        if ( !s || !s->process ) return;
        QProcess * p = s->process;
        p->closeWriteChannel();    // the MCP way to ask a stdio server to stop
        p->terminate();
        QTimer::singleShot(2000, p, [p]() { if ( p->state() != QProcess::NotRunning ) p->kill(); });
    }

    void opSecret(const QString& op, const QJsonObject& in, const Reply& reply)
    {
        const QJsonValue req = in.value("req");
        const QString key = in.value("key").toString();
        if ( !validSecretKey(key) ) {
            answer(reply, failure(req, "bad-request", "key"));
            return;
        }
        QJsonObject out{{"req", req}, {"store", storeName()}};
        if ( op == "secret-set" ) {
            const QString value = in.value("value").toString();
            out["ok"] = !value.isEmpty() && validHeaderValue(value) && CWorkSuite::setSecret(key, value);
            if ( !out["ok"].toBool() ) out["error"] = "secret-store";
        } else
        if ( op == "secret-delete" ) {
            out["ok"] = CWorkSuite::removeSecret(key);
        } else {
            out["ok"] = true;
            out["has"] = !CWorkSuite::secret(key).isEmpty();
        }
        answer(reply, out);
    }
}

void CWorkSuiteMcp::handle(const QString& json, std::function<void(const QString&)> reply)
{
    const QJsonObject in = QJsonDocument::fromJson(json.toUtf8()).object();
    const QString op = in.value("op").toString();
    if ( op == "http" ) opHttp(in, reply);
    else if ( op == "spawn" ) opSpawn(in, reply);
    else if ( op == "write" ) opWrite(in, reply);
    else if ( op == "kill" ) opKill(in);
    else if ( op == "secret-set" || op == "secret-delete" || op == "secret-has" ) opSecret(op, in, reply);
    else answer(reply, failure(in.value("req"), "bad-request", "op"));
}

void CWorkSuiteMcp::shutdown()
{
    for ( const std::shared_ptr<Server>& s : servers() ) {
        if ( s->process ) {
            s->process->closeWriteChannel();
            s->process->kill();
            s->process->waitForFinished(500);
        }
    }
    servers().clear();
}
