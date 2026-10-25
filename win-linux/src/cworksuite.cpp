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
#include <QHash>
#include <QPointer>
#include <QDesktopServices>

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
# include <dlfcn.h>
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
        if ( obj.isEmpty() ) {
            // nothing left in the file: no file (AUTH-13, after moving its sign-ins to the Secret Service)
            return !QFile::exists(storePath()) || QFile::remove(storePath());
        }
        QDir().mkpath(Utils::getAppCommonPath());

        QSaveFile file(storePath());
        if ( !file.open(QIODevice::WriteOnly) )
            return false;

        file.setPermissions(QFileDevice::ReadOwner | QFileDevice::WriteOwner);
        file.write(QJsonDocument(obj).toJson(QJsonDocument::Compact));
        return file.commit();
    }

    /*
     * The Secret Service (AUTH-13, G-04): GNOME Keyring, KWallet (5.97+) or KeePassXC, through
     * libsecret. libsecret is opened at run time, not linked: build_tools' Linux dependencies do
     * not carry its headers, and a computer without it still runs the app (the file above is then
     * the last resort, and the start page says so). Only the few symbols below are used; their
     * structures are libsecret's stable ABI (secret-schema.h).
     */
    namespace SecretService {
        struct GErrorAbi { quint32 domain; int code; char * message; };
        struct AttributeAbi { const char * name; int type; };
        struct SchemaAbi {
            const char * name; int flags; AttributeAbi attributes[32];
            int reserved; void * reserved1, * reserved2, * reserved3, * reserved4, * reserved5, * reserved6, * reserved7;
        };

        typedef int (*StoreFn)(const SchemaAbi *, const char *, const char *, const char *, void *, GErrorAbi **, ...);
        typedef char * (*LookupFn)(const SchemaAbi *, void *, GErrorAbi **, ...);
        typedef int (*ClearFn)(const SchemaAbi *, void *, GErrorAbi **, ...);
        typedef void (*FreeFn)(char *);
        typedef void (*ErrorFreeFn)(GErrorAbi *);

        struct Api {
            StoreFn store = nullptr; LookupFn lookup = nullptr; ClearFn clear = nullptr;
            FreeFn free = nullptr; ErrorFreeFn error_free = nullptr;
            bool loaded = false;
        };

        const SchemaAbi * schema()
        {
            static const SchemaAbi s = { "lk.worksuite.Office.SignIn", 0 /* SECRET_SCHEMA_NONE */,
                                         { {"key", 0 /* SECRET_SCHEMA_ATTRIBUTE_STRING */}, {nullptr, 0} },
                                         0, nullptr, nullptr, nullptr, nullptr, nullptr, nullptr, nullptr };
            return &s;
        }

        const Api& api()
        {
            static Api a = [] {
                Api r;
                void * lib = dlopen("libsecret-1.so.0", RTLD_NOW | RTLD_LOCAL);
                if ( !lib ) return r;
                r.store = reinterpret_cast<StoreFn>(dlsym(lib, "secret_password_store_sync"));
                r.lookup = reinterpret_cast<LookupFn>(dlsym(lib, "secret_password_lookup_sync"));
                r.clear = reinterpret_cast<ClearFn>(dlsym(lib, "secret_password_clear_sync"));
                r.free = reinterpret_cast<FreeFn>(dlsym(lib, "secret_password_free"));
                r.error_free = reinterpret_cast<ErrorFreeFn>(dlsym(lib, "g_error_free"));
                r.loaded = r.store && r.lookup && r.clear && r.free && r.error_free;
                return r;
            }();
            return a;
        }

        enum Result { Ok, NotFound, Unavailable };

        /* the service failed (none running, no D-Bus session): remembered, so the file is used without asking again */
        bool s_failed = false;

        bool failed(GErrorAbi * error)
        {
            if ( !error ) return false;
            api().error_free(error);
            s_failed = true;
            return true;
        }

        bool usable() { return api().loaded && !s_failed; }

        Result lookup(const QString& key, QString& value)
        {
            if ( !usable() ) return Unavailable;
            GErrorAbi * error = nullptr;
            const QByteArray k = key.toUtf8();
            char * v = api().lookup(schema(), nullptr, &error, "key", k.constData(), static_cast<char *>(nullptr));
            if ( failed(error) ) return Unavailable;
            if ( !v ) return NotFound;
            value = QString::fromUtf8(v);
            api().free(v);
            return Ok;
        }

        bool store(const QString& key, const QString& value)
        {
            if ( !usable() ) return false;
            GErrorAbi * error = nullptr;
            const QByteArray k = key.toUtf8(), v = value.toUtf8();
            const QByteArray label = ("WorkSuite Office sign-in (" + key.section('|', 0, 0).mid(QString("worksuite:").size()) + ")").toUtf8();
            const int ok = api().store(schema(), "default", label.constData(), v.constData(), nullptr, &error,
                                       "key", k.constData(), static_cast<char *>(nullptr));
            return !failed(error) && ok;
        }

        Result clear(const QString& key)
        {
            if ( !usable() ) return Unavailable;
            GErrorAbi * error = nullptr;
            const QByteArray k = key.toUtf8();
            const int removed = api().clear(schema(), nullptr, &error, "key", k.constData(), static_cast<char *>(nullptr));
            if ( failed(error) ) return Unavailable;
            return removed ? Ok : NotFound;
        }

        /* Once per run: the sign-ins an older version kept in the file go into the Secret Service, and the file goes */
        void migrateFile()
        {
            static bool done = false;
            if ( done || !usable() ) return;
            done = true;

            QJsonObject file = readStore();
            if ( file.isEmpty() ) return;
            for ( const QString& key : file.keys() ) {
                if ( validKey(key) && store(key, file.value(key).toString()) )
                    file.remove(key);
                else if ( !usable() ) break;
            }
            writeStore(file);
        }
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
    SecretService::migrateFile();
    if ( SecretService::store(key, value) ) {
        QJsonObject file = readStore();
        if ( file.contains(key) ) { file.remove(key); writeStore(file); }
        return true;
    }
    // last resort, when no Secret Service runs: the user-only file; the start page warns (handleSecret's "store")
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
    SecretService::migrateFile();
    QString value;
    if ( SecretService::lookup(key, value) == SecretService::Ok )
        return value;

    value = readStore().value(key).toString();
    if ( !value.isEmpty() && SecretService::store(key, value) ) {
        QJsonObject file = readStore();
        file.remove(key);
        writeStore(file);
    }
    return value;
#endif
}

bool CWorkSuite::removeSecret(const QString& key)
{
    if ( !validKey(key) ) return false;

#ifdef Q_OS_WIN
    std::wstring target = targetName(key);
    return CredDeleteW(target.c_str(), CRED_TYPE_GENERIC, 0) == TRUE || GetLastError() == ERROR_NOT_FOUND;
#else
    SecretService::clear(key);
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

#ifdef Q_OS_WIN
    out["store"] = "os";
#else
    // "file" only while sign-ins are in the user-only file (no Secret Service): the start page warns
    out["store"] = SecretService::usable() ? "secret-service" : "file";
#endif

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

namespace {
    QHash<QString, QPointer<QNetworkReply>> & downloads()
    {
        static QHash<QString, QPointer<QNetworkReply>> all;
        return all;
    }

    QString downloadsFolder()
    {
        QString dir = QStandardPaths::writableLocation(QStandardPaths::DownloadLocation);
        if ( dir.isEmpty() ) dir = QDir::homePath();
        return QFileInfo(dir).canonicalFilePath();
    }

    /* "Report.docx", or "Report (2).docx" when that is taken; no path, no reserved characters */
    QString freeName(const QString& folder, QString name)
    {
        name.replace(QRegularExpression("[\\\\/:*?\"<>|\\x00-\\x1f]"), "_");
        name = name.trimmed().left(180);
        if ( name.isEmpty() || name == "." || name == ".." ) name = "download";
        const QFileInfo fi(name);
        const QString base = fi.completeBaseName(), ext = fi.suffix().isEmpty() ? QString() : "." + fi.suffix();
        QString path = folder + "/" + name;
        for (int n = 2; QFileInfo::exists(path) && n < 1000; ++n)
            path = folder + "/" + base + QString(" (%1)").arg(n) + ext;
        return path;
    }
}

void CWorkSuite::transfer(const QString& json, std::function<void(const QString&)> reply)
{
    const QJsonObject in = QJsonDocument::fromJson(json.toUtf8()).object();
    const QString op = in.value("op").toString();
    const QString req = in.value("req").toString().left(64);
    auto send = [reply](const QJsonObject& out) { reply(QString::fromUtf8(QJsonDocument(out).toJson(QJsonDocument::Compact))); };
    static QNetworkAccessManager * nam = new QNetworkAccessManager();

    if ( op == "cancel" ) {
        if ( QNetworkReply * r = downloads().value(req) ) r->abort();
        return;
    }

    if ( op == "reveal" ) {
        const QString root = downloadsFolder();
        const QString path = QFileInfo(in.value("path").toString()).canonicalFilePath();
        if ( !root.isEmpty() && path.startsWith(root + "/") )
            QDesktopServices::openUrl(QUrl::fromLocalFile(QFileInfo(path).absolutePath()));
        return;
    }

    const QUrl url(in.value("url").toString(), QUrl::StrictMode);
    const bool https = url.isValid() && url.scheme() == "https" && url.userInfo().isEmpty() && !url.host().isEmpty();

    if ( op == "chunk" ) {
        static const QRegularExpression path_re("^/api/uploads/[0-9a-fA-F-]{36}/chunk$");
        const QString token = in.value("token").toString();
        const int index = in.value("index").toInt(-1);
        const QByteArray data = QByteArray::fromBase64(in.value("data").toString().toLatin1());
        if ( !https || !path_re.match(url.path()).hasMatch() || url.hasQuery() || token.isEmpty() || token.contains('\n') ||
                index < 0 || data.size() > 16 * 1024 * 1024 ) {
            send({{"req", req}, {"status", 400}, {"body", ""}});
            return;
        }
        QHttpMultiPart * multi = new QHttpMultiPart(QHttpMultiPart::FormDataType);
        QHttpPart indexPart;
        indexPart.setHeader(QNetworkRequest::ContentDispositionHeader, "form-data; name=\"chunk_index\"");
        indexPart.setBody(QByteArray::number(index));
        multi->append(indexPart);
        QHttpPart filePart;
        filePart.setHeader(QNetworkRequest::ContentDispositionHeader, QString("form-data; name=\"chunk\"; filename=\"%1.part\"").arg(index));
        filePart.setHeader(QNetworkRequest::ContentTypeHeader, "application/octet-stream");
        filePart.setBody(data);
        multi->append(filePart);
        QNetworkRequest request(url);
        request.setRawHeader("Authorization", "Bearer " + token.toUtf8());
        request.setRawHeader("Accept", "application/json");
        QNetworkReply * r = nam->post(request, multi);
        multi->setParent(r);
        QObject::connect(r, &QNetworkReply::finished, [r, req, send]() {
            const int status = r->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
            send({{"req", req}, {"status", status}, {"body", QString::fromUtf8(r->readAll().left(64 * 1024))}});
            r->deleteLater();
        });
        return;
    }

    if ( op == "download" ) {
        static const QRegularExpression path_re("^/media/[A-Za-z0-9._~-]{8,2048}$");
        const QString root = downloadsFolder();
        if ( !https || !path_re.match(url.path()).hasMatch() || (url.hasQuery() && url.query() != "download=1") || root.isEmpty() || req.isEmpty() ) {
            send({{"req", req}, {"status", 400}, {"done", true}});
            return;
        }
        const QString path = freeName(root, in.value("name").toString());
        QFile * file = new QFile(path + ".part");
        if ( !file->open(QIODevice::WriteOnly) ) {
            delete file;
            send({{"req", req}, {"status", 507}, {"done", true}});
            return;
        }
        QNetworkRequest request(url);
        request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::NoLessSafeRedirectPolicy);
        QNetworkReply * r = nam->get(request);
        file->setParent(r);
        downloads().insert(req, r);
        auto last = std::make_shared<qint64>(0);
        QObject::connect(r, &QNetworkReply::readyRead, [r, file]() { file->write(r->readAll()); });
        QObject::connect(r, &QNetworkReply::downloadProgress, [req, send, last](qint64 received, qint64 total) {
            if ( received - *last < 256 * 1024 && received != total ) return;
            *last = received;
            send({{"req", req}, {"received", double(received)}, {"total", double(total)}});
        });
        QObject::connect(r, &QNetworkReply::finished, [r, file, req, path, send]() {
            downloads().remove(req);
            const int status = r->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
            file->write(r->readAll());
            file->close();
            const bool ok = r->error() == QNetworkReply::NoError && status >= 200 && status < 300;
            if ( ok && QFile::rename(file->fileName(), path) )
                send({{"req", req}, {"status", status}, {"done", true}, {"path", path}});
            else {
                QFile::remove(file->fileName());
                send({{"req", req}, {"status", r->error() == QNetworkReply::OperationCanceledError ? 499 : (status ? status : 0)}, {"done", true}});
            }
            r->deleteLater();
        });
        return;
    }
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
