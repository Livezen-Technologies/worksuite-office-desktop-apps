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

#include "cwinsparkle.h"

#ifdef WS_WINSPARKLE

#include "cworksuite.h"
#include "cwsupdatedownload.h"
#include "cascapplicationmanagerwrapper.h"
#include "clangater.h"
#include "defines.h"
#include "utils.h"
#include "version.h"
#include <QApplication>
#include <QDateTime>
#include <QFileInfo>
#include <QMetaObject>
#include <QMutex>
#include <QProcess>
#include <QSettings>
#include <QThread>
#include <atomic>
#include <cstring>
#include <windows.h>
#include <winsparkle.h>
#if __has_include(<winsparkle-version.h>)
# include <winsparkle-version.h>
#endif

#ifndef WS_EDDSA_PUBLIC_KEY
# define WS_EDDSA_PUBLIC_KEY ""
#endif
#ifndef WS_BUILD_NUMBER
# define WS_BUILD_NUMBER ""
#endif

namespace {
    std::atomic_bool g_active{false};
    QMutex g_lock;
    QString g_installer;    // the downloaded, verified installer (guarded by g_lock)
    QString g_readyVersion;
    bool g_relaunch = false; // "Restart to update": open the app again after the update
    /* the start page's own download, with progress (Qt thread only) */
    CWsUpdateDownload * g_download = nullptr;
    QJsonObject g_found;     // {"version","size"}: the update the appcast offers, for the Download button

    /* run `fn` on the Qt thread; WinSparkle calls back from its own threads */
    template<typename F> void onQtThread(F fn, bool wait = false)
    {
        if ( QThread::currentThread() == qApp->thread() )
            fn();
        else QMetaObject::invokeMethod(qApp, fn, wait ? Qt::BlockingQueuedConnection : Qt::QueuedConnection);
    }

    QString channel()
    {
        const QString forced = CWorkSuite::policy().value("updateChannel").toString().toLower();
        if ( forced == "stable" || forced == "beta" )
            return forced;
        GET_REGISTRY_USER(reg_user);
        const QString mine = reg_user.value("Updates/channel", "stable").toString().toLower();
        return mine == "beta" ? mine : "stable";
    }

    /* WS_APPCAST_URL with its /channels/<x>/ part set to the channel */
    QByteArray appcastUrl(const QString& ch)
    {
        QString url = QString::fromUtf8(WS_APPCAST_URL);
        const int at = url.indexOf("/channels/");
        if ( at >= 0 ) {
            const int from = at + int(strlen("/channels/"));
            const int to = url.indexOf('/', from);
            if ( to > from )
                url.replace(from, to - from, ch);
        }
        return url.toUtf8();
    }

    QString versionOf(const QString& exe)
    {
        const std::wstring path = exe.toStdWString();
        DWORD ignored = 0;
        const DWORD size = GetFileVersionInfoSizeW(path.c_str(), &ignored);
        if ( !size ) return QString();
        QByteArray data(int(size), 0);
        if ( !GetFileVersionInfoW(path.c_str(), 0, size, data.data()) ) return QString();
        VS_FIXEDFILEINFO * info = nullptr;
        UINT len = 0;
        if ( !VerQueryValueW(data.data(), L"\\", reinterpret_cast<LPVOID*>(&info), &len) || !info ) return QString();
        return QString("%1.%2.%3").arg(HIWORD(info->dwProductVersionMS)).arg(LOWORD(info->dwProductVersionMS))
                                  .arg(HIWORD(info->dwProductVersionLS));
    }

    /* the build WinSparkle compares with the appcast's sparkle:version */
    QString currentBuild()
    {
        return *WS_BUILD_NUMBER ? QString::fromUtf8(WS_BUILD_NUMBER) : QString(VER_FILEVERSION_STR);
    }

    /* "worksuite:update-progress" {state: downloading|verifying|ready|error|idle, received, total, version,
       cancellable, reason}: the Updates card's progress bar (Settings › WorkSuite) */
    void sendProgress(const QString& st, qint64 received = 0, qint64 total = 0, const QString& reason = QString())
    {
        QJsonObject p{{"state", st}, {"received", double(received)}, {"total", double(total)},
                      {"version", g_found.value("version").toString()}, {"cancellable", st == "downloading"}};
        if ( !reason.isEmpty() ) p["reason"] = reason;
        AscAppManager::sendCommandTo(SEND_TO_ALL_START_PAGE, "worksuite:update-progress", Utils::stringifyJson(p));
    }

    void sendState();

    void sendReady()
    {
        QMutexLocker l(&g_lock);
        if ( g_installer.isEmpty() ) return;
        // WinSparkle checked the EdDSA signature of the download before handing it over
        QJsonObject ready{{"version", g_readyVersion}, {"channel", channel()}, {"verified", true},
                          {"signatureChecked", true}, {"signer", "WorkSuite"}, {"notes", ""}};
        AscAppManager::sendCommandTo(SEND_TO_ALL_START_PAGE, "worksuite:update-ready", Utils::stringifyJson(ready));
    }

    /* WinSparkle: may the app quit now for an update? Not while a document has unsaved changes. */
    int __cdecl canShutdown()
    {
        if ( !g_active )
            return 0;   // shutting down: the Qt thread may be waiting in win_sparkle_cleanup()
        bool ok = false;
        onQtThread([&ok]() { ok = !AscAppManager::hasUnsavedChanges(); }, true);
        return ok ? 1 : 0;
    }

    void __cdecl shutdownRequest()
    {
        onQtThread([]() { AscAppManager::closeAppWindows(); });
    }

    /* WinSparkle downloaded and verified the installer: keep it for when the app closes */
    int __cdecl runInstaller(const wchar_t * path)
    {
        const QString exe = QString::fromWCharArray(path);
        if ( !QFileInfo(exe).isFile() )
            return 0;   // let WinSparkle report it
        {
            QMutexLocker l(&g_lock);
            g_installer = exe;
            g_readyVersion = versionOf(exe);
        }
        onQtThread([]() { sendReady(); });
        return 1;       // handled: it runs at exit (cleanup)
    }

    QString state(bool busy = false)
    {
        const time_t last = win_sparkle_get_last_check_time();
        QJsonObject st{{"available", true},
                       {"version", QString(VER_FILEVERSION_STR)},
                       {"channel", channel()},
                       {"auto", win_sparkle_get_automatic_check_for_updates() == 1},
                       {"lastCheck", double(last > 0 ? last : 0)},
                       {"host", "download.worksuitecloud.com"}};
        if ( busy ) st["busy"] = true;
        if ( !g_found.isEmpty() ) st["found"] = g_found;
        st["download"] = true;      // the start page may download it itself ("op":"download")
        if ( g_download && g_download->busy() ) st["downloading"] = true;
        return Utils::stringifyJson(st);
    }

    void sendState()
    {
        AscAppManager::sendCommandTo(SEND_TO_ALL_START_PAGE, "worksuite:updates", state());
    }

    /* what the appcast offers now, without WinSparkle's window (for the card's Download button) */
    void probe(bool force = false)
    {
        static qint64 last = 0;
        const qint64 now = QDateTime::currentSecsSinceEpoch();
        if ( !force && last && now - last < 600 )
            return;     // the settings page opens often; the appcast is asked at most every 10 minutes
        last = now;
        if ( g_download && !g_download->busy() )
            g_download->probe(QUrl(QString::fromUtf8(appcastUrl(channel()))), currentBuild());
    }

    /* WinSparkle callbacks (its threads): keep the card in step with WinSparkle's own window */
    void __cdecl didFindUpdate() { onQtThread([]() { probe(true); }); }
    void __cdecl didNotFindUpdate() { onQtThread([]() { g_found = QJsonObject(); sendState(); }); }
    void __cdecl updateSkipped() { onQtThread([]() { g_found = QJsonObject(); sendState(); }); }

    void createDownload()
    {
        g_download = new CWsUpdateDownload(qApp);
        QObject::connect(g_download, &CWsUpdateDownload::found, qApp, [](const WsAppcastItem& item) {
            g_found = QJsonObject{{"version", item.shortVersion.isEmpty() ? item.version : item.shortVersion},
                                  {"size", double(item.length)}};
            sendState();
        });
        QObject::connect(g_download, &CWsUpdateDownload::upToDate, qApp, []() {
            g_found = QJsonObject();
            sendState();
        });
        QObject::connect(g_download, &CWsUpdateDownload::progress, qApp, [](const QString& st, qint64 received, qint64 total) {
            sendProgress(st, received, total);
        });
        QObject::connect(g_download, &CWsUpdateDownload::ready, qApp, [](const QString& path, const WsAppcastItem& item) {
            {
                QMutexLocker l(&g_lock);
                g_installer = path;     // length and Ed25519 signature checked (CWsUpdateDownload::checkFile)
                g_readyVersion = item.shortVersion.isEmpty() ? versionOf(path) : item.shortVersion;
            }
            sendProgress("ready", item.length, item.length);
            sendReady();
        });
        QObject::connect(g_download, &CWsUpdateDownload::failed, qApp, [](const QString& reason) {
            if ( reason == "cancelled" ) {
                sendProgress("idle");
                return;
            }
            sendProgress("error", 0, 0, reason);
            // our download failed or was refused: WinSparkle's own window downloads and checks it again
            if ( g_active && reason != "appcast" )
                win_sparkle_check_update_with_ui();
        });
    }
}

bool CWinSparkle::active()
{
    return g_active;
}

void CWinSparkle::init()
{
    if ( g_active || !*WS_EDDSA_PUBLIC_KEY )
        return;     // no key, no trust: no updates offered

    win_sparkle_set_registry_path("Software\\WorkSuite\\WorkSuite Office\\WinSparkle");
    win_sparkle_set_appcast_url(appcastUrl(channel()).constData());
    if ( win_sparkle_set_eddsa_public_key(WS_EDDSA_PUBLIC_KEY) != 1 )
        return;     // a key WinSparkle cannot read: do not start
    win_sparkle_set_app_details(L"WorkSuite", L"WorkSuite Office", QString(VER_FILEVERSION_STR).toStdWString().c_str());
    if ( *WS_BUILD_NUMBER )
        win_sparkle_set_app_build_version(QString::fromUtf8(WS_BUILD_NUMBER).toStdWString().c_str());
    win_sparkle_set_lang(CLangater::getLangName().replace('_', '-').toUtf8().constData());

    win_sparkle_set_can_shutdown_callback(canShutdown);
    win_sparkle_set_shutdown_request_callback(shutdownRequest);
    win_sparkle_set_user_run_installer_callback(runInstaller);
    win_sparkle_set_did_find_update_callback(didFindUpdate);
    win_sparkle_set_did_not_find_update_callback(didNotFindUpdate);
#if defined(WIN_SPARKLE_CHECK_VERSION) && WIN_SPARKLE_CHECK_VERSION(0,7,0)
    win_sparkle_set_update_skipped_callback(updateSkipped);
#else
    (void)updateSkipped;
#endif

    // ADM-01: the organisation may set automatic checks; otherwise the person's choice (default on)
    const QJsonObject policy = CWorkSuite::policy();
    GET_REGISTRY_USER(reg_user);
    const bool autoCheck = policy.contains("updateAuto") ? CWorkSuite::policyBool(policy.value("updateAuto"))
                                                         : reg_user.value("Updates/auto", true).toBool();
    win_sparkle_set_automatic_check_for_updates(autoCheck ? 1 : 0);
    win_sparkle_set_update_check_interval(86400);

    win_sparkle_init();
    g_active = true;
    createDownload();
}

void CWinSparkle::cleanup()
{
    if ( !g_active )
        return;
    g_active = false;
    if ( g_download ) {
        delete g_download;  // stops a download in progress and deletes its partial file
        g_download = nullptr;
    }
    win_sparkle_cleanup();

    QMutexLocker l(&g_lock);
    if ( !g_installer.isEmpty() && QFileInfo(g_installer).isFile() ) {
        // the arguments the Update Center gives (sparkle:installerArguments), plus a relaunch when asked
        QStringList args{"/SILENT", "/SP-", "/NOCANCEL", "/NORESTART", "/CLOSEAPPLICATIONS"};
        if ( g_relaunch )
            args << "/WSRELAUNCH=1";
        QProcess::startDetached(g_installer, args);
        g_installer.clear();
    }
}

QString CWinSparkle::command(const QJsonObject& in)
{
    if ( !g_active )
        return "{\"available\":false}";

    const QString op = in.value("op").toString();
    const QJsonObject policy = CWorkSuite::policy();
    if ( op == "set" ) {
        GET_REGISTRY_USER(reg_user);
        const QString ch = in.value("channel").toString();
        if ( (ch == "stable" || ch == "beta") && !policy.contains("updateChannel") )
            reg_user.setValue("Updates/channel", ch);   // the feed address changes at the next start
        if ( in.contains("auto") && !policy.contains("updateAuto") ) {
            reg_user.setValue("Updates/auto", in.value("auto").toBool());
            win_sparkle_set_automatic_check_for_updates(in.value("auto").toBool() ? 1 : 0);
        }
    } else
    if ( op == "check" ) {
        win_sparkle_check_update_with_ui();
        return state(true);
    } else
    if ( op == "download" ) {
        // the Updates card's Download: ours, with progress; WinSparkle's window if it fails
        bool ready;
        {
            QMutexLocker l(&g_lock);
            ready = !g_installer.isEmpty();
        }
        if ( ready )
            onQtThread([]() { sendReady(); });
        else if ( g_download && !g_download->busy() )
            g_download->start(QUrl(QString::fromUtf8(appcastUrl(channel()))), currentBuild(), QByteArray(WS_EDDSA_PUBLIC_KEY));
    } else
    if ( op == "cancel" ) {
        if ( g_download ) g_download->cancel();
    } else
    if ( op == "restart" ) {
        bool ready;
        {
            QMutexLocker l(&g_lock);
            ready = !g_installer.isEmpty();
            if ( ready ) g_relaunch = true;
        }
        if ( ready )
            AscAppManager::closeAppWindows();   // asks about unsaved documents; the update runs at exit
        else win_sparkle_check_update_with_ui();
    } else {
        // "get": also repeats a pending "update ready" for a start page that loaded after it, and asks the
        // appcast what it offers, so the card can show Download
        onQtThread([]() { sendReady(); });
        if ( g_found.isEmpty() ) probe();
    }
    return state();
}

void CWinSparkle::checkWithUi()
{
    if ( g_active )
        win_sparkle_check_update_with_ui();
}

#else // !WS_WINSPARKLE

void CWinSparkle::init() {}
void CWinSparkle::cleanup() {}
bool CWinSparkle::active() { return false; }
QString CWinSparkle::command(const QJsonObject&) { return "{\"available\":false}"; }
void CWinSparkle::checkWithUi() {}

#endif
