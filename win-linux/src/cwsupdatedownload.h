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

#ifndef CWSUPDATEDOWNLOAD_H
#define CWSUPDATEDOWNLOAD_H

#include <QObject>
#include <QByteArray>
#include <QList>
#include <QPointer>
#include <QString>
#include <QUrl>

class QFile;
class QNetworkAccessManager;
class QNetworkReply;

/*
 * WorkSuite Office on Windows: the start page's "Download" of an update, with progress (WinSparkle 0.9
 * reports none). Reads the same appcast WinSparkle reads, picks the newest Windows item above this build,
 * downloads its enclosure over https into the temp folder and, before anything can run it, checks that
 *   - the appcast gives a sparkle:edSignature and a length (a file with neither is not downloaded),
 *   - the file is exactly that length (a longer download is stopped as it arrives),
 *   - the Ed25519 signature over the whole file verifies against the app's public key (cwsed25519).
 * A file that fails any of these is deleted. CWinSparkle runs a verified one the way it runs WinSparkle's
 * own download: at exit, from "Restart to update".
 *
 * Signals come on the thread that owns the object (the Qt thread).
 */
struct WsAppcastItem
{
    QString version;        // sparkle:version (what WinSparkle compares with the build)
    QString shortVersion;   // sparkle:shortVersionString (shown)
    QUrl url;
    qint64 length = 0;
    QByteArray signature;   // base64, as in the appcast
    QString os;
};

class CWsUpdateDownload : public QObject
{
    Q_OBJECT
public:
    explicit CWsUpdateDownload(QObject * parent = nullptr);
    ~CWsUpdateDownload();

    /* the items of an appcast; enclosures without a url are left out */
    static QList<WsAppcastItem> parseAppcast(const QByteArray& xml);
    /* Sparkle's comparison of dotted versions: <0, 0, >0 */
    static int compareVersions(const QString& a, const QString& b);
    /* the newest item for Windows (sparkle:os windows or none) newer than `current`; false when none */
    static bool pickUpdate(const QList<WsAppcastItem>& items, const QString& current, WsAppcastItem * out);
    /* the length and Ed25519 checks of a downloaded file; "" when it passes, else the reason */
    static QString checkFile(const QString& path, qint64 length, const QByteArray& signatureB64, const QByteArray& publicKeyB64);

    /* reads the appcast; found(item) or upToDate() or failed(reason) */
    void probe(const QUrl& appcast, const QString& currentBuild);
    /* probe, then download the update found */
    void start(const QUrl& appcast, const QString& currentBuild, const QByteArray& publicKeyB64);
    void cancel();
    bool busy() const;

    /* tests only: file:// sources (the app accepts https only) */
    void setAllowInsecureForTests(bool v) { m_insecure = v; }
    /* where the installer is written; default: the temp folder */
    void setTargetFolder(const QString& dir) { m_folder = dir; }

signals:
    void found(const WsAppcastItem& item);
    void upToDate();
    /* state: "downloading" | "verifying"; total 0 when unknown */
    void progress(const QString& state, qint64 received, qint64 total);
    void ready(const QString& path, const WsAppcastItem& item);
    /* reason: "network" | "appcast" | "unsigned" | "insecure" | "length" | "signature" | "disk" | "cancelled" */
    void failed(const QString& reason);

private:
    void fetchAppcast(const QUrl& appcast, const QString& currentBuild, bool thenDownload);
    void download(const WsAppcastItem& item);
    void fail(const QString& reason);
    bool allowed(const QUrl& url) const;

    QNetworkAccessManager * m_net;
    QPointer<QNetworkReply> m_reply;
    QFile * m_file = nullptr;
    WsAppcastItem m_item;
    QByteArray m_key;
    QString m_folder;
    qint64 m_lastSent = -1;
    bool m_insecure = false;
    bool m_cancelled = false;
};

#endif // CWSUPDATEDOWNLOAD_H
