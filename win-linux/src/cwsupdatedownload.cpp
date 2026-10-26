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

#include "cwsupdatedownload.h"
#include "cwsed25519.h"
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QRegularExpression>
#include <QXmlStreamReader>
#include <cstring>

namespace {
    const char SPARKLE_NS[] = "http://www.andymatuschak.org/xml-namespaces/sparkle";
    const qint64 MAX_INSTALLER = qint64(2) * 1024 * 1024 * 1024;    // no installer is anywhere near 2 GB

    bool isSparkle(const QXmlStreamAttribute& a, const char * name)
    {
        return a.name() == QLatin1String(name) &&
               (a.namespaceUri() == QLatin1String(SPARKLE_NS) || a.prefix() == QLatin1String("sparkle"));
    }

    bool isSparkleElement(const QXmlStreamReader& x, const char * name)
    {
        return x.name() == QLatin1String(name) &&
               (x.namespaceUri() == QLatin1String(SPARKLE_NS) || x.prefix() == QLatin1String("sparkle"));
    }

    QStringList numbers(const QString& v)
    {
        static const QRegularExpression sep("[^0-9]+");
        QStringList parts = v.split(sep);
        parts.removeAll(QString());
        return parts;
    }
}

CWsUpdateDownload::CWsUpdateDownload(QObject * parent)
    : QObject(parent)
    , m_net(new QNetworkAccessManager(this))
    , m_folder(QDir::tempPath() + "/WorkSuiteOfficeUpdate")
{
}

CWsUpdateDownload::~CWsUpdateDownload()
{
    m_cancelled = true;
    if ( m_reply ) m_reply->abort();
    if ( m_file ) {
        m_file->remove();
        delete m_file;
    }
}

QList<WsAppcastItem> CWsUpdateDownload::parseAppcast(const QByteArray& xml)
{
    QList<WsAppcastItem> items;
    QXmlStreamReader x(xml);
    WsAppcastItem item;
    bool inItem = false;
    while ( !x.atEnd() ) {
        x.readNext();
        if ( x.isStartElement() ) {
            if ( x.name() == QLatin1String("item") ) {
                inItem = true;
                item = WsAppcastItem();
            } else
            if ( inItem && isSparkleElement(x, "version") ) {
                item.version = x.readElementText().trimmed();
            } else
            if ( inItem && isSparkleElement(x, "shortVersionString") ) {
                item.shortVersion = x.readElementText().trimmed();
            } else
            if ( inItem && x.name() == QLatin1String("enclosure") ) {
                for (const QXmlStreamAttribute& a: x.attributes()) {
                    if ( a.name() == QLatin1String("url") && a.namespaceUri().isEmpty() ) item.url = QUrl(a.value().toString().trimmed());
                    else if ( a.name() == QLatin1String("length") && a.namespaceUri().isEmpty() ) item.length = a.value().toString().toLongLong();
                    else if ( isSparkle(a, "edSignature") ) item.signature = a.value().toString().trimmed().toLatin1();
                    else if ( isSparkle(a, "version") && item.version.isEmpty() ) item.version = a.value().toString().trimmed();
                    else if ( isSparkle(a, "shortVersionString") && item.shortVersion.isEmpty() ) item.shortVersion = a.value().toString().trimmed();
                    else if ( isSparkle(a, "os") ) item.os = a.value().toString().trimmed().toLower();
                }
            }
        } else
        if ( x.isEndElement() && x.name() == QLatin1String("item") ) {
            inItem = false;
            if ( item.url.isValid() && !item.version.isEmpty() )
                items.append(item);
        }
    }
    return x.hasError() ? QList<WsAppcastItem>() : items;
}

int CWsUpdateDownload::compareVersions(const QString& a, const QString& b)
{
    const QStringList x = numbers(a), y = numbers(b);
    for (int i = 0; i < qMax(x.size(), y.size()); ++i) {
        const qulonglong p = i < x.size() ? x.at(i).toULongLong() : 0,
                         q = i < y.size() ? y.at(i).toULongLong() : 0;
        if ( p != q ) return p < q ? -1 : 1;
    }
    return 0;
}

bool CWsUpdateDownload::pickUpdate(const QList<WsAppcastItem>& items, const QString& current, WsAppcastItem * out)
{
    const WsAppcastItem * best = nullptr;
    for (const WsAppcastItem& i: items) {
        if ( !i.os.isEmpty() && i.os != "windows" && i.os != "windows-x64" ) continue;
        if ( compareVersions(i.version, current) <= 0 ) continue;
        if ( !best || compareVersions(i.version, best->version) > 0 ) best = &i;
    }
    if ( best && out ) *out = *best;
    return best != nullptr;
}

QString CWsUpdateDownload::checkFile(const QString& path, qint64 length, const QByteArray& signatureB64, const QByteArray& publicKeyB64)
{
    const QByteArray sig = QByteArray::fromBase64(signatureB64), key = QByteArray::fromBase64(publicKeyB64);
    if ( sig.size() != 64 || key.size() != 32 )
        return "unsigned";
    QFile f(path);
    if ( !f.open(QIODevice::ReadOnly) )
        return "disk";
    if ( length <= 0 || f.size() != length )
        return "length";

    WsEd25519::Verifier v(reinterpret_cast<const uint8_t *>(sig.constData()), reinterpret_cast<const uint8_t *>(key.constData()));
    QByteArray chunk;
    qint64 read = 0;
    while ( !(chunk = f.read(1024 * 1024)).isEmpty() ) {
        v.update(reinterpret_cast<const uint8_t *>(chunk.constData()), size_t(chunk.size()));
        read += chunk.size();
    }
    if ( read != length )
        return "length";
    return v.finish() ? QString() : QString("signature");
}

bool CWsUpdateDownload::allowed(const QUrl& url) const
{
    if ( url.scheme() == "https" && !url.host().isEmpty() && url.userInfo().isEmpty() ) return true;
    return m_insecure && url.isLocalFile();
}

bool CWsUpdateDownload::busy() const
{
    return m_reply || m_file;
}

void CWsUpdateDownload::probe(const QUrl& appcast, const QString& currentBuild)
{
    fetchAppcast(appcast, currentBuild, false);
}

void CWsUpdateDownload::start(const QUrl& appcast, const QString& currentBuild, const QByteArray& publicKeyB64)
{
    if ( busy() ) return;
    m_key = publicKeyB64;
    fetchAppcast(appcast, currentBuild, true);
}

void CWsUpdateDownload::fetchAppcast(const QUrl& appcast, const QString& currentBuild, bool thenDownload)
{
    if ( busy() ) return;
    if ( !allowed(appcast) ) {
        fail("insecure");
        return;
    }
    m_cancelled = false;
    QNetworkRequest req(appcast);
    req.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::NoLessSafeRedirectPolicy);
    m_reply = m_net->get(req);
    QNetworkReply * reply = m_reply;
    connect(reply, &QNetworkReply::finished, this, [=]() {
        reply->deleteLater();
        m_reply = nullptr;
        if ( m_cancelled ) {
            fail("cancelled");
            return;
        }
        if ( reply->error() != QNetworkReply::NoError ) {
            fail("network");
            return;
        }
        const QList<WsAppcastItem> items = parseAppcast(reply->read(4 * 1024 * 1024));
        WsAppcastItem item;
        if ( !pickUpdate(items, currentBuild, &item) ) {
            if ( items.isEmpty() ) fail("appcast");
            else emit upToDate();
            return;
        }
        emit found(item);
        if ( thenDownload )
            download(item);
    });
}

void CWsUpdateDownload::download(const WsAppcastItem& item)
{
    // refused before a byte is fetched: nothing to check it against
    if ( QByteArray::fromBase64(item.signature).size() != 64 || QByteArray::fromBase64(m_key).size() != 32 ) {
        fail("unsigned");
        return;
    }
    if ( item.length <= 0 || item.length > MAX_INSTALLER ) {
        fail("length");
        return;
    }
    if ( !allowed(item.url) ) {
        fail("insecure");
        return;
    }

    QString name = QFileInfo(item.url.path()).fileName();
    static const QRegularExpression safe("^[A-Za-z0-9._-]{1,120}\\.(exe|msi)$", QRegularExpression::CaseInsensitiveOption);
    if ( !safe.match(name).hasMatch() )
        name = "WorkSuite-Office-Update-" + QString(item.version).replace(QRegularExpression("[^0-9A-Za-z.]"), "_") + ".exe";
    if ( !QDir().mkpath(m_folder) ) {
        fail("disk");
        return;
    }

    m_item = item;
    m_file = new QFile(m_folder + "/" + name + ".part");
    if ( !m_file->open(QIODevice::WriteOnly | QIODevice::Truncate) ) {
        delete m_file, m_file = nullptr;
        fail("disk");
        return;
    }

    m_lastSent = -1;
    QNetworkRequest req(item.url);
    req.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::NoLessSafeRedirectPolicy);
    m_reply = m_net->get(req);
    QNetworkReply * reply = m_reply;
    emit progress("downloading", 0, item.length);

    connect(reply, &QNetworkReply::readyRead, this, [=]() {
        if ( !m_file || !reply->isOpen() ) return;
        const QByteArray data = reply->readAll();
        if ( m_file->size() + data.size() > m_item.length ) {
            reply->setProperty("ws-too-long", true);
            reply->abort();     // more than the appcast said: not the file that was signed
            return;
        }
        if ( m_file->write(data) != data.size() ) {
            reply->setProperty("ws-disk", true);
            reply->abort();
        }
    });
    connect(reply, &QNetworkReply::downloadProgress, this, [=](qint64 received, qint64) {
        const qint64 step = qMax<qint64>(64 * 1024, m_item.length / 200);
        if ( m_lastSent < 0 || received - m_lastSent >= step || received == m_item.length ) {
            m_lastSent = received;
            emit progress("downloading", qMin(received, m_item.length), m_item.length);
        }
    });
    connect(reply, &QNetworkReply::finished, this, [=]() {
        reply->deleteLater();
        m_reply = nullptr;
        if ( !m_file ) return;
        if ( reply->error() == QNetworkReply::NoError && reply->isOpen() )
            m_file->write(reply->readAll());
        m_file->close();

        QString reason;
        if ( reply->property("ws-too-long").toBool() ) reason = "length";
        else if ( reply->property("ws-disk").toBool() ) reason = "disk";
        else if ( m_cancelled ) reason = "cancelled";
        else if ( reply->error() != QNetworkReply::NoError ) reason = "network";

        if ( reason.isEmpty() ) {
            emit progress("verifying", m_file->size(), m_item.length);
            reason = checkFile(m_file->fileName(), m_item.length, m_item.signature, m_key);
        }

        const QString part = m_file->fileName(), final = part.left(part.size() - int(strlen(".part")));
        if ( reason.isEmpty() ) {
            QFile::remove(final);
            if ( !m_file->rename(final) ) reason = "disk";
        }
        if ( !reason.isEmpty() ) {
            m_file->remove();
            delete m_file, m_file = nullptr;
            fail(reason);
            return;
        }
        delete m_file, m_file = nullptr;
        emit ready(final, m_item);
    });
}

void CWsUpdateDownload::cancel()
{
    m_cancelled = true;
    if ( m_reply ) m_reply->abort();
}

void CWsUpdateDownload::fail(const QString& reason)
{
    emit failed(reason);
}
