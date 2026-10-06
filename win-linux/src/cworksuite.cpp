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
#include <QJsonDocument>
#include <QJsonObject>
#include <QRegularExpression>

#ifdef Q_OS_WIN
# include <windows.h>
# include <wincred.h>
#else
# include <QSaveFile>
# include "utils.h"
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
    const QString app_data = qEnvironmentVariable("APPDATA");
#else
    QString app_data = qEnvironmentVariable("XDG_CONFIG_HOME");
    if ( app_data.isEmpty() )
        app_data = QDir::homePath() + "/.config";
#endif
    QFile file(app_data + "/WorkSuite/desktop-accounts.json");
    if ( app_data.isEmpty() || !file.open(QIODevice::ReadOnly) || file.size() > 256 * 1024 )
        return "{}";

    const QJsonDocument doc = QJsonDocument::fromJson(file.readAll());
    return doc.isObject() ? QString::fromUtf8(doc.toJson(QJsonDocument::Compact)) : "{}";
}
