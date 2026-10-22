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

#include "cworksuite.h"
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonObject>
#include <memory>
#include <QTimer>
#include <QRegularExpression>
#include <QUrl>
#ifdef Q_OS_WIN
# include <QDesktopServices>
#endif
#include "utils.h"
#include <QSettings>
#include <QJsonArray>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QHttpMultiPart>
#include <QStandardPaths>

#ifdef Q_OS_WIN
# include <windows.h>
# include <wincred.h>
#else
# include <QLocalSocket>
# include <QProcess>
# include <unistd.h>
# include <QProcessEnvironment>
# include <QSaveFile>
# include <QStandardPaths>
#endif

#define SECRET_SERVICE "WorkSuite Office"

namespace {
    /* Keys are ours ("worksuite:<server>|<user id>"); anything else is refused. */
    bool validKey(const QString& key)
    {
        static const QRegularExpression re("^[A-Za-z0-9_.:|/@-]{1,200}$");
        return re.match(key).hasMatch();
    }

#ifndef Q_OS_WIN
    QString storePath()
    {
        return Utils::getAppCommonPath() + "/worksuite-secrets.json";
    }

    QJsonObject readStore()
    {
        QFile file(storePath());
        if ( file.open(QIODevice::ReadOnly) )
            return QJsonDocument::fromJson(file.readAll()).object();
        return QJsonObject();
    }

    bool writeStore(const QJsonObject& obj)
    {
        QDir().mkpath(Utils::getAppCommonPath());

        QSaveFile file(storePath());
        if ( !file.open(QIODevice::WriteOnly) )
            return false;

        file.setPermissions(QFileDevice::ReadOwner | QFileDevice::WriteOwner);
        file.write(QJsonDocument(obj).toJson(QJsonDocument::Compact));
        return file.commit();
    }
#else
    std::wstring targetName(const QString& key)
    {
        return (QString(SECRET_SERVICE "/") + key).toStdWString();
    }
#endif

    /* Whether WorkSuite Desktop is installed: its installer registers worksuite:// links */
    bool desktopAppInstalled()
    {
#ifdef Q_OS_WIN
        // the user's registration or the machine's (HKEY_CLASSES_ROOT has both), as long as its program is still there
        HKEY key = nullptr;
        if ( RegOpenKeyExW(HKEY_CLASSES_ROOT, L"worksuite\\shell\\open\\command", 0, KEY_QUERY_VALUE, &key) != ERROR_SUCCESS )
            return false;

        wchar_t command[2048] = {};
        DWORD size = sizeof(command) - sizeof(wchar_t), type = 0;
        const LONG result = RegQueryValueExW(key, nullptr, nullptr, &type, reinterpret_cast<LPBYTE>(command), &size);
        RegCloseKey(key);
        if ( result != ERROR_SUCCESS || (type != REG_SZ && type != REG_EXPAND_SZ) )
            return false;

        // "C:\...\WorkSuite.exe" "%1"
        QString program = QString::fromWCharArray(command).trimmed();
        program = program.startsWith('"') ? program.mid(1, program.indexOf('"', 1) - 1) : program.section(' ', 0, 0);
        if ( type == REG_EXPAND_SZ ) {
            wchar_t expanded[2048] = {};
            const std::wstring raw = program.toStdWString();
            if ( ExpandEnvironmentStringsW(raw.c_str(), expanded, 2048) > 0 )
                program = QString::fromWCharArray(expanded);
        }
        return !program.isEmpty() && QFileInfo::exists(program);
#else
        // the desktop file xdg-mime names for worksuite: links, where applications are installed
        QProcessEnvironment env = QProcessEnvironment::systemEnvironment();
        env.remove("LD_LIBRARY_PATH");      // the app's own libraries, not for system tools (as Utils::openUrl)

        QProcess xdg;
        xdg.setProcessEnvironment(env);
        xdg.start("xdg-mime", {"query", "default", "x-scheme-handler/worksuite"});
        if ( !xdg.waitForFinished(3000) ) {
            xdg.kill();
            xdg.waitForFinished(1000);
            return false;
        }
        if ( xdg.exitStatus() != QProcess::NormalExit || xdg.exitCode() != 0 )
            return false;

        const QString desktop_file = QString::fromUtf8(xdg.readAllStandardOutput()).trimmed();
        return !desktop_file.isEmpty() && !QStandardPaths::locate(QStandardPaths::ApplicationsLocation, desktop_file).isEmpty();
#endif
    }
}

bool CWorkSuite::setSecret(const QString& key, const QString& value)
{
    if ( !validKey(key) ) return false;

#ifdef Q_OS_WIN
    const QByteArray blob = value.toUtf8();
    if ( blob.size() > CRED_MAX_CREDENTIAL_BLOB_SIZE ) return false;

    std::wstring target = targetName(key);
    CREDENTIALW cred{};
    cred.Type = CRED_TYPE_GENERIC;
    cred.TargetName = const_cast<LPWSTR>(target.c_str());
    cred.CredentialBlobSize = DWORD(blob.size());
    cred.CredentialBlob = reinterpret_cast<LPBYTE>(const_cast<char *>(blob.data()));
    cred.Persist = CRED_PERSIST_LOCAL_MACHINE;
    cred.UserName = const_cast<LPWSTR>(L"" SECRET_SERVICE);

    return CredWriteW(&cred, 0) == TRUE;
#else
    QJsonObject store = readStore();
    store[key] = value;
    return writeStore(store);
#endif
}

QString CWorkSuite::secret(const QString& key)
{
    if ( !validKey(key) ) return QString();

#ifdef Q_OS_WIN
    PCREDENTIALW cred = nullptr;
    std::wstring target = targetName(key);
    if ( CredReadW(target.c_str(), CRED_TYPE_GENERIC, 0, &cred) != TRUE )
        return QString();

    QString value = QString::fromUtf8(reinterpret_cast<const char *>(cred->CredentialBlob), int(cred->CredentialBlobSize));
    CredFree(cred);
    return value;
#else
    return readStore().value(key).toString();
#endif
}

bool CWorkSuite::removeSecret(const QString& key)
{
    if ( !validKey(key) ) return false;

#ifdef Q_OS_WIN
    std::wstring target = targetName(key);
    return CredDeleteW(target.c_str(), CRED_TYPE_GENERIC, 0) == TRUE || GetLastError() == ERROR_NOT_FOUND;
#else
    QJsonObject store = readStore();
    if ( !store.contains(key) ) return true;
    store.remove(key);
    return writeStore(store);
#endif
}

QString CWorkSuite::handleSecret(const QString& json)
{
    const QJsonObject in = QJsonDocument::fromJson(json.toUtf8()).object();
    const QString op = in["op"].toString(),
                  key = in["key"].toString();

    QJsonObject out{{"req", in["req"]}, {"ok", false}};
    if ( op == "get" ) {
        const QString value = secret(key);
        out["ok"] = !value.isEmpty();
        out["value"] = value;
    } else
    if ( op == "set" ) {
        out["ok"] = setSecret(key, in["value"].toString());
    } else
    if ( op == "delete" ) {
        out["ok"] = removeSecret(key);
    }

    return QString::fromUtf8(QJsonDocument(out).toJson(QJsonDocument::Compact));
}

QString CWorkSuite::desktopAccounts()
{
#ifdef Q_OS_WIN
    const QString app_data = QString::fromLocal8Bit(qgetenv("APPDATA"));
#else
    QString app_data = QString::fromLocal8Bit(qgetenv("XDG_CONFIG_HOME"));
    if ( app_data.isEmpty() )
        app_data = QDir::homePath() + "/.config";
#endif
    QFile file(app_data + "/WorkSuite/desktop-accounts.json");
    if ( app_data.isEmpty() || !file.open(QIODevice::ReadOnly) || file.size() > 256 * 1024 )
        return "{}";

    const QJsonDocument doc = QJsonDocument::fromJson(file.readAll());
    return doc.isObject() ? QString::fromUtf8(doc.toJson(QJsonDocument::Compact)) : "{}";
}

void CWorkSuite::openApp(const QString& json)
{
    if ( desktopAppInstalled() ) {
        Utils::openUrl("worksuite://home");
        return;
    }

    // a server's address only, rebuilt from its parts: Utils::openUrl hands it to a shell on Linux
    static const QRegularExpression host_re("^[A-Za-z0-9.-]{1,253}$");
    const QUrl web(QJsonDocument::fromJson(json.toUtf8()).object().value("web").toString());
    const QString host = web.host(QUrl::FullyEncoded);      // an international name as xn--…
    if ( !web.isValid() || web.scheme() != "https" || !host_re.match(host).hasMatch() )
        return;

    QUrl home;
    home.setScheme("https");
    home.setHost(host);
    home.setPort(web.port());
    home.setPath("/");
    Utils::openUrl(home.toString());
}

QString CWorkSuite::openLink(const QString& json)
{
    const QJsonObject in = QJsonDocument::fromJson(json.toUtf8()).object();
    QJsonObject reply{{"req", in.value("req").toString()}, {"ok", false}, {"reason", ""}};

    const QUrl url(in.value("url").toString(), QUrl::StrictMode);
    static const QRegularExpression host_re("^[A-Za-z0-9.-]{1,253}$");
    const bool web = url.isValid() && url.scheme() == "https" && host_re.match(url.host(QUrl::FullyEncoded)).hasMatch();
    const bool desktop = url.isValid() && url.scheme() == "worksuite" && url.host() == "office" && url.path() == "/signin";

    if ( desktop && !desktopAppInstalled() ) {
        reply["reason"] = "no-app";
    } else
    if ( web || desktop ) {
        const QString link = url.toString(QUrl::FullyEncoded);
#ifdef Q_OS_WIN
        reply["ok"] = QDesktopServices::openUrl(QUrl(link));
#else
        // xdg-open with the address as its argument: no shell (Utils::openUrl uses one), not the app's libraries.
        // Qt 5.9 (the Linux build) has no QProcess::startDetached() with an environment, so the variable is
        // taken out of ours for the call and put back.
        const QByteArray ld = qgetenv("LD_LIBRARY_PATH");
        qunsetenv("LD_LIBRARY_PATH");
        reply["ok"] = QProcess::startDetached("xdg-open", QStringList{link});
        if ( !ld.isEmpty() ) qputenv("LD_LIBRARY_PATH", ld);
#endif
    }
    return QString::fromUtf8(QJsonDocument(reply).toJson(QJsonDocument::Compact));
}

QString CWorkSuite::shareRequest(const QString& tabUrl, const QString& json)
{
    const QUrl tab(tabUrl);
    static const QRegularExpression host_re("^[A-Za-z0-9.-]{1,253}$");
    if ( !tab.isValid() || tab.scheme() != "https" || !tab.userInfo().isEmpty() || !host_re.match(tab.host(QUrl::FullyEncoded)).hasMatch() )
        return "";

    const QJsonValue v = QJsonDocument::fromJson(json.toUtf8()).object().value("file");
    const QString file = v.isDouble() ? QString::number(qint64(v.toDouble())) : v.toString();
    static const QRegularExpression id_re("^[0-9]{1,18}$");
    if ( !id_re.match(file).hasMatch() )
        return "";

    QString server = "https://" + tab.host(QUrl::FullyEncoded).toLower();
    if ( tab.port() > 0 && tab.port() != 443 )
        server += ":" + QString::number(tab.port());
    const QJsonObject out{{"server", server}, {"file", file}};
    return QString::fromUtf8(QJsonDocument(out).toJson(QJsonDocument::Compact));
}

namespace {
    QString compact(const QJsonObject& o) { return QString::fromUtf8(QJsonDocument(o).toJson(QJsonDocument::Compact)); }

#ifndef Q_OS_WIN
    bool httpsAddress(const QString& s)
    {
        const QUrl u(s, QUrl::StrictMode);
        return u.isValid() && u.scheme() == "https" && !u.host().isEmpty() && u.userInfo().isEmpty();
    }

    /* The enrolled organisation's server, from the device agent (0644, every user may read it), or "" */
    QString deviceServer()
    {
        QFile file("/run/worksuite-device-agent/status.json");
        if ( !file.open(QIODevice::ReadOnly) || file.size() > 64 * 1024 )
            return "";
        const QJsonObject st = QJsonDocument::fromJson(file.readAll()).object();
        const QString server = st.value("server").toString();
        return st.value("managed").toBool() && httpsAddress(server) ? server : "";
    }

    QString brokerSocketPath()
    {
        QString dir = QString::fromLocal8Bit(qgetenv("XDG_RUNTIME_DIR"));
        if ( dir.isEmpty() )
            dir = QString("/run/user/%1").arg(getuid());
        return dir + "/worksuite/credentials.sock";
    }
#endif
}

void CWorkSuite::brokerRequest(const QString& json, std::function<void(const QString&)> reply)
{
    const QJsonObject in = QJsonDocument::fromJson(json.toUtf8()).object();
    const QString req = in.value("req").toString().left(64);
    QJsonObject out{{"req", req}, {"ok", false}};

#ifdef Q_OS_WIN
    out["error"] = "not_os";
    reply(compact(out));
#else
    if ( !QFileInfo::exists("/etc/worksuite/os-release") ) {
        out["error"] = "not_os";
        return reply(compact(out));
    }

    // only the three methods, with only their own parameters: the page cannot ask the broker anything else
    const QString method = in.value("method").toString();
    const QJsonObject p = in.value("params").toObject();
    QJsonObject params;
    int timeout_ms = 15000;
    if ( method == "Status" ) {
    } else
    if ( method == "GetAccessToken" && p.value("account_id").isString() ) {
        params["account_id"] = p.value("account_id").toString();
        params["force_refresh"] = p.value("force_refresh").toBool();
    } else
    if ( method == "SignIn" && httpsAddress(p.value("server_url").toString()) &&
            (p.value("mode").toString() == "personal" || p.value("mode").toString() == "enterprise") ) {
        params["server_url"] = p.value("server_url").toString();
        params["mode"] = p.value("mode").toString();
        timeout_ms = 10 * 60 * 1000;    // the person is in the browser
    } else {
        out["error"] = "invalid_argument";
        return reply(compact(out));
    }

    QLocalSocket * sock = new QLocalSocket;
    QTimer * timer = new QTimer(sock);
    auto buffer = std::make_shared<QByteArray>();
    auto done = std::make_shared<bool>(false);
    const QString device_server = method == "Status" ? deviceServer() : QString();

    auto finish = [=](QJsonObject r) {
        if ( *done ) return;
        *done = true;
        timer->stop();
        r["req"] = req;
        reply(compact(r));
        sock->abort();
        sock->deleteLater();
    };

    timer->setSingleShot(true);
    QObject::connect(timer, &QTimer::timeout, [=] { finish({{"ok", false}, {"error", "broker_timeout"}}); });
    QObject::connect(sock, &QLocalSocket::connected, [=] {
        sock->write(QJsonDocument(QJsonObject{{"method", method}, {"params", params}}).toJson(QJsonDocument::Compact) + "\n");
    });
    QObject::connect(sock, &QLocalSocket::readyRead, [=] {
        buffer->append(sock->readAll());
        if ( buffer->size() > 64 * 1024 )
            return finish({{"ok", false}, {"error", "bad_reply"}});
        const int nl = buffer->indexOf('\n');
        if ( nl < 0 ) return;

        const QJsonDocument doc = QJsonDocument::fromJson(buffer->left(nl));
        if ( !doc.isObject() )
            return finish({{"ok", false}, {"error", "bad_reply"}});
        const QJsonObject res = doc.object();
        QJsonObject r;
        if ( res.contains("error") && !res.value("error").isNull() ) {
            r["ok"] = false;
            r["error"] = res.value("error").isString() ? res.value("error").toString() : "broker_error";
        } else {
            r["ok"] = true;
            r["result"] = res.value("result");
            if ( res.value("expires_at").isDouble() )
                r["expires_at"] = res.value("expires_at");
            if ( method == "Status" )
                r["device_server"] = device_server;
        }
        finish(r);
    });
#if QT_VERSION >= QT_VERSION_CHECK(5, 15, 0)
    QObject::connect(sock, &QLocalSocket::errorOccurred, [=](QLocalSocket::LocalSocketError) {
#else
    QObject::connect(sock, QOverload<QLocalSocket::LocalSocketError>::of(&QLocalSocket::error), [=](QLocalSocket::LocalSocketError) {
#endif
        finish({{"ok", false}, {"error", "broker_unavailable"}});
    });

    timer->start(timeout_ms);
    sock->connectToServer(brokerSocketPath());
#endif
}

/* ---- ADM-01: the organisation policy ------------------------------------ */

namespace {
    const char * const POLICY_KEYS[] = {"organization", "server", "lockServer", "allowOtherClouds",
                                        "updateChannel", "updateAuto", "usageReports", "aiFunctions"};

    QJsonObject readPolicy(QString& source)
    {
        QJsonObject out;
#ifdef Q_OS_WIN
        QSettings reg("HKEY_LOCAL_MACHINE\\Software\\Policies\\WorkSuite\\Office", QSettings::NativeFormat);
        for (const char * key : POLICY_KEYS) {
            const QVariant v = reg.value(key);
            if ( !v.isValid() || v.toString().trimmed().isEmpty() ) continue;
            out[key] = v.type() == QVariant::String ? QJsonValue(v.toString().trimmed()) : QJsonValue(v.toInt());
        }
        source = "registry";
#else
        QFile file("/etc/worksuite-office/policy.json");
        if ( file.open(QIODevice::ReadOnly) && file.size() < 64 * 1024 ) {
            const QJsonObject in = QJsonDocument::fromJson(file.readAll()).object();
            for (const char * key : POLICY_KEYS) {
                const QJsonValue v = in.value(key);
                if ( v.isBool() || v.isDouble() || (v.isString() && !v.toString().trimmed().isEmpty()) )
                    out[key] = v;
            }
        }
        source = "file";
#endif
        return out;
    }
}

QJsonObject CWorkSuite::policy()
{
    QString source;
    return readPolicy(source);
}

bool CWorkSuite::policyBool(const QJsonValue& v)
{
    if ( v.isBool() ) return v.toBool();
    if ( v.isDouble() ) return v.toInt() != 0;
    const QString s = v.toString().trimmed().toLower();
    return s == "1" || s == "true" || s == "yes" || s == "on";
}

QString CWorkSuite::policyAnswer()
{
    QString source;
    const QJsonObject p = readPolicy(source);
    QJsonObject out{{"managed", !p.isEmpty()}, {"source", source}, {"policy", p}};
    return QString::fromUtf8(QJsonDocument(out).toJson(QJsonDocument::Compact));
}

/* ---- DOC-07: offline working copies back to Drive ------------------------ */

QString CWorkSuite::offlineFolder()
{
    return QStandardPaths::writableLocation(QStandardPaths::AppDataLocation) + "/offline";
}

void CWorkSuite::upload(const QString& json, std::function<void(const QString&)> reply)
{
    const QJsonObject in = QJsonDocument::fromJson(json.toUtf8()).object();
    const QString req = in.value("req").toString().left(64);
    auto answer = [reply, req](int status, const QByteArray& body) {
        QJsonObject out{{"req", req}, {"status", status}, {"body", QString::fromUtf8(body.left(256 * 1024))}};
        reply(QString::fromUtf8(QJsonDocument(out).toJson(QJsonDocument::Compact)));
    };

    // https://<host>/api/files/<id>/versions only, a file from the offline folder only
    static const QRegularExpression path_re("^/api/files/[0-9]{1,20}/versions$");
    const QUrl url(in.value("url").toString(), QUrl::StrictMode);
    const QString root = QFileInfo(offlineFolder()).canonicalFilePath();
    const QString path = QFileInfo(in.value("path").toString()).canonicalFilePath();
    const QString token = in.value("token").toString();
    if ( !url.isValid() || url.scheme() != "https" || !url.userInfo().isEmpty() || !path_re.match(url.path()).hasMatch() ||
            root.isEmpty() || path.isEmpty() || !path.startsWith(root + "/") || token.isEmpty() || token.contains('\n') ) {
        answer(400, QByteArray());
        return;
    }

    QFile * file = new QFile(path);
    if ( !file->open(QIODevice::ReadOnly) ) {
        delete file;
        answer(404, QByteArray());
        return;
    }

    QHttpMultiPart * multi = new QHttpMultiPart(QHttpMultiPart::FormDataType);
    const QJsonObject fields = in.value("fields").toObject();
    for (auto it = fields.begin(); it != fields.end(); ++it) {
        static const QRegularExpression name_re("^[a-z_]{1,32}$");
        if ( !name_re.match(it.key()).hasMatch() ) continue;
        QHttpPart part;
        part.setHeader(QNetworkRequest::ContentDispositionHeader, QString("form-data; name=\"%1\"").arg(it.key()));
        part.setBody(it.value().toString().left(1024).toUtf8());
        multi->append(part);
    }
    QHttpPart filePart;
    QString name = QFileInfo(path).fileName();
    name.replace('"', '_');
    filePart.setHeader(QNetworkRequest::ContentDispositionHeader, QString("form-data; name=\"file\"; filename=\"%1\"").arg(name));
    filePart.setHeader(QNetworkRequest::ContentTypeHeader, "application/octet-stream");
    filePart.setBodyDevice(file);
    file->setParent(multi);
    multi->append(filePart);

    static QNetworkAccessManager * nam = new QNetworkAccessManager();
    QNetworkRequest request(url);
    request.setRawHeader("Authorization", "Bearer " + token.toUtf8());
    request.setRawHeader("Accept", "application/json");
    QNetworkReply * r = nam->post(request, multi);
    multi->setParent(r);
    QObject::connect(r, &QNetworkReply::finished, [r, answer]() {
        const int status = r->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        answer(status, r->readAll());
        r->deleteLater();
    });
}
