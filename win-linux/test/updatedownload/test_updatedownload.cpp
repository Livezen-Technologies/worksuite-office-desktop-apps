/*
 * WorkSuite Office: CWsUpdateDownload (win-linux/src/cwsupdatedownload.cpp), the start page's own update
 * download on Windows, run against file:// sources (the app itself takes https only): appcast parsing and
 * version choice, a signed file that passes, and every file it must refuse (unsigned, wrong signature,
 * wrong key, longer or shorter than the appcast's length). Needs Qt 5.15 or 6 (Core, Network). Run: make
 * The signatures are made by gen.py with Python `cryptography` (OpenSSL).
 */
#include "../../src/cwsupdatedownload.h"
#include <QCoreApplication>
#include <QDir>
#include <QEventLoop>
#include <QFile>
#include <QTemporaryDir>
#include <QTimer>
#include <cstdio>

static int failures = 0;
#define CHECK(c) do { if (!(c)) { ++failures; std::printf("FAIL line %d: %s\n", __LINE__, #c); } } while (0)

struct Run { QString reason, path; QList<qint64> received; QStringList states; bool found = false; };

static Run run(const QString& appcast, const QString& build, const QByteArray& key, const QString& folder)
{
    CWsUpdateDownload d;
    d.setAllowInsecureForTests(true);
    d.setTargetFolder(folder);
    Run r;
    QEventLoop loop;
    QObject::connect(&d, &CWsUpdateDownload::found, [&](const WsAppcastItem&) { r.found = true; });
    QObject::connect(&d, &CWsUpdateDownload::progress, [&](const QString& s, qint64 rec, qint64) { r.states << s; r.received << rec; });
    QObject::connect(&d, &CWsUpdateDownload::ready, [&](const QString& p, const WsAppcastItem&) { r.path = p; loop.quit(); });
    QObject::connect(&d, &CWsUpdateDownload::failed, [&](const QString& why) { r.reason = why; loop.quit(); });
    QObject::connect(&d, &CWsUpdateDownload::upToDate, [&]() { r.reason = "uptodate"; loop.quit(); });
    QTimer::singleShot(20000, &loop, &QEventLoop::quit);
    d.start(QUrl::fromLocalFile(appcast), build, key);
    loop.exec();
    return r;
}

static QByteArray readAll(const QString& p) { QFile f(p); f.open(QIODevice::ReadOnly); return f.readAll().trimmed(); }

int main(int argc, char ** argv)
{
    QCoreApplication app(argc, argv);
    const QString data = QString::fromLocal8Bit(qgetenv("WS_TEST_DATA"));
    const QByteArray key = readAll(data + "/key.pub");

    CHECK(CWsUpdateDownload::compareVersions("10.1.3.120", "10.1.3.99") > 0);
    CHECK(CWsUpdateDownload::compareVersions("1120", "1119") > 0);
    CHECK(CWsUpdateDownload::compareVersions("9.3", "9.3.0") == 0);
    CHECK(CWsUpdateDownload::compareVersions("9.3.2", "9.10.0") < 0);

    const QList<WsAppcastItem> items = CWsUpdateDownload::parseAppcast(readAll(data + "/good.xml"));
    CHECK(items.size() == 3);
    WsAppcastItem pick;
    CHECK(CWsUpdateDownload::pickUpdate(items, "1100", &pick));
    CHECK(pick.version == "1120");             // the newest Windows item; the macOS one (1200) is skipped
    CHECK(pick.shortVersion == "9.3.3");
    CHECK(pick.signature.size() > 80);
    CHECK(!CWsUpdateDownload::pickUpdate(items, "1120", &pick));

    QTemporaryDir tmp;
    Run ok = run(data + "/good.xml", "1100", key, tmp.path());
    CHECK(ok.reason.isEmpty());
    CHECK(ok.found);
    CHECK(QFile::exists(ok.path) && ok.path.endsWith(".exe"));
    CHECK(readAll(ok.path) == readAll(data + "/installer.exe"));
    CHECK(ok.states.contains("downloading") && ok.states.last() == "verifying");
    CHECK(!ok.received.isEmpty() && ok.received.first() == 0);

    struct { const char * xml; const char * reason; } bad[] = {
        {"unsigned.xml", "unsigned"}, {"badsig.xml", "signature"}, {"otherkey.xml", "signature"},
        {"short.xml", "length"}, {"long.xml", "length"}, {"nolength.xml", "length"},
    };
    for (auto& b: bad) {
        QTemporaryDir t;
        Run r = run(data + "/" + b.xml, "1100", key, t.path());
        if ( r.reason != b.reason ) std::printf("  %s: got '%s'\n", b.xml, qPrintable(r.reason));
        CHECK(r.reason == b.reason);
        CHECK(QDir(t.path()).entryList(QDir::Files).isEmpty());   // nothing left behind to run
    }
    {
        QTemporaryDir t;
        CHECK(run(data + "/good.xml", "1120", key, t.path()).reason == "uptodate");
    }
    CHECK(CWsUpdateDownload::checkFile(data + "/installer.exe", QFileInfo(data + "/installer.exe").size(),
                                       readAll(data + "/installer.sig"), key).isEmpty());

    std::printf("%s (%d failures)\n", failures ? "FAILED" : "ok", failures);
    return failures ? 1 : 0;
}
