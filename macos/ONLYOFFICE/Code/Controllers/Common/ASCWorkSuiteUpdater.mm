/*
 * Copyright (C) Ascensio System SIA, 2009-2026
 *
 * This program is a free software product. You can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License (AGPL)
 * version 3 as published by the Free Software Foundation, together with the
 * additional terms provided in the LICENSE file.
 *
 * This program is distributed WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. For
 * details, see the GNU AGPL at: https://www.gnu.org/licenses/agpl-3.0.html
 *
 * You can contact Ascensio System SIA by email at info@onlyoffice.com
 * or by postal mail at 20A-6 Ernesta Birznieka-Upisha Street, Riga,
 * LV-1050, Latvia, European Union.
 *
 * The interactive user interfaces in modified versions of the Program
 * are required to display Appropriate Legal Notices in accordance with
 * Section 5 of the GNU AGPL version 3.
 *
 * No trademark rights are granted under this License.
 *
 * All non-code elements of the Product, including illustrations,
 * icon sets, and technical writing content, are licensed under the
 * Creative Commons Attribution-ShareAlike 4.0 International License:
 * https://creativecommons.org/licenses/by-sa/4.0/legalcode
 *
 * This license applies only to such non-code elements and does not
 * modify or replace the licensing terms applicable to the Program's
 * source code, which remains licensed under the GNU Affero General
 * Public License v3.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */
//
//  ASCWorkSuiteUpdater.mm
//  WorkSuite Office
//

#import "ASCWorkSuiteUpdater.h"

NSNotificationName const ASCWorkSuiteUpdateProgressNotification = @"ASCWorkSuiteUpdateProgressNotification";

/// SPUStandardUserDriver with a tap on what it is shown: every call goes on to the standard driver unchanged,
/// so Sparkle's windows behave as before. Sparkle calls a user driver on the main thread only.
@interface ASCWorkSuiteUserDriver : NSObject <SPUUserDriver>
@property (nonatomic, strong) SPUStandardUserDriver * standard;
@property (nonatomic, copy, nullable) void (^cancellation)(void);
@property (nonatomic, copy, nullable) void (^foundReply)(SPUUserUpdateChoice);
@property (nonatomic, copy, nullable) void (^readyReply)(SPUUserUpdateChoice);
@property (nonatomic, copy, nullable) NSString * version;
@property (nonatomic, copy) NSDictionary * last;
@end

@implementation ASCWorkSuiteUserDriver {
    uint64_t _expected;
    uint64_t _received;
    uint64_t _sent;
}

- (instancetype)initWithStandard:(SPUStandardUserDriver *)standard {
    if (self = [super init]) {
        _standard = standard;
        _last = @{};
    }
    return self;
}

- (void)post:(NSString *)state received:(uint64_t)received total:(uint64_t)total {
    self.last = @{@"state": state, @"received": @(received), @"total": @(total), @"version": self.version ?: @"",
                  @"cancellable": @([state isEqualToString:@"downloading"] && self.cancellation != nil)};
    [[NSNotificationCenter defaultCenter] postNotificationName:ASCWorkSuiteUpdateProgressNotification object:self userInfo:self.last];
}

/// a reply that runs once, whoever answers first: Sparkle's window or the start page
static void (^wsOnce(void (^reply)(SPUUserUpdateChoice)))(SPUUserUpdateChoice) {
    __block BOOL answered = NO;
    return ^(SPUUserUpdateChoice choice) {
        if (answered) return;
        answered = YES;
        reply(choice);
    };
}

#pragma mark - SPUUserDriver

- (void)showUpdatePermissionRequest:(SPUUpdatePermissionRequest *)request reply:(void (^)(SUUpdatePermissionResponse *))reply {
    [self.standard showUpdatePermissionRequest:request reply:reply];
}

- (void)showUserInitiatedUpdateCheckWithCancellation:(void (^)(void))cancellation {
    [self.standard showUserInitiatedUpdateCheckWithCancellation:cancellation];
}

- (void)showUpdateFoundWithAppcastItem:(SUAppcastItem *)appcastItem state:(SPUUserUpdateState *)state reply:(void (^)(SPUUserUpdateChoice))reply {
    self.version = appcastItem.displayVersionString ?: appcastItem.versionString;
    void (^answer)(SPUUserUpdateChoice) = wsOnce(reply);
    __weak ASCWorkSuiteUserDriver * weakSelf = self;
    self.foundReply = ^(SPUUserUpdateChoice choice) {
        weakSelf.foundReply = nil;
        answer(choice);
    };
    if (state.stage == SPUUserUpdateStageNotDownloaded)
        [self post:@"found" received:0 total:appcastItem.contentLength];
    else if (state.stage == SPUUserUpdateStageDownloaded)
        [self post:@"ready" received:appcastItem.contentLength total:appcastItem.contentLength];
    [self.standard showUpdateFoundWithAppcastItem:appcastItem state:state reply:self.foundReply];
}

- (void)showUpdateReleaseNotesWithDownloadData:(SPUDownloadData *)downloadData {
    [self.standard showUpdateReleaseNotesWithDownloadData:downloadData];
}

- (void)showUpdateReleaseNotesFailedToDownloadWithError:(NSError *)error {
    [self.standard showUpdateReleaseNotesFailedToDownloadWithError:error];
}

- (void)showUpdateNotFoundWithError:(NSError *)error acknowledgement:(void (^)(void))acknowledgement {
    self.foundReply = nil;
    [self post:@"idle" received:0 total:0];
    [self.standard showUpdateNotFoundWithError:error acknowledgement:acknowledgement];
}

- (void)showUpdaterError:(NSError *)error acknowledgement:(void (^)(void))acknowledgement {
    self.foundReply = nil;
    self.cancellation = nil;
    [self post:@"error" received:0 total:0];
    [self.standard showUpdaterError:error acknowledgement:acknowledgement];
}

- (void)showDownloadInitiatedWithCancellation:(void (^)(void))cancellation {
    self.foundReply = nil;
    __weak ASCWorkSuiteUserDriver * weakSelf = self;
    __block BOOL cancelled = NO;
    void (^cancel)(void) = ^{
        if (cancelled) return;
        cancelled = YES;
        weakSelf.cancellation = nil;
        cancellation();
    };
    self.cancellation = cancel;
    _expected = 0;
    _received = 0;
    _sent = 0;
    [self post:@"downloading" received:0 total:0];
    [self.standard showDownloadInitiatedWithCancellation:cancel];
}

- (void)showDownloadDidReceiveExpectedContentLength:(uint64_t)expectedContentLength {
    _expected = expectedContentLength;
    [self post:@"downloading" received:_received total:_expected];
    [self.standard showDownloadDidReceiveExpectedContentLength:expectedContentLength];
}

- (void)showDownloadDidReceiveDataOfLength:(uint64_t)length {
    _received += length;
    // about every half per cent (or 64 KB when the length is unknown): enough for a smooth bar
    const uint64_t step = MAX((uint64_t)64 * 1024, _expected / 200);
    if (_received - _sent >= step || (_expected && _received >= _expected)) {
        _sent = _received;
        [self post:@"downloading" received:_received total:_expected];
    }
    [self.standard showDownloadDidReceiveDataOfLength:length];
}

- (void)showDownloadDidStartExtractingUpdate {
    self.cancellation = nil;    // Sparkle: no cancelling once extraction starts
    [self post:@"extracting" received:0 total:1000];
    [self.standard showDownloadDidStartExtractingUpdate];
}

- (void)showExtractionReceivedProgress:(double)progress {
    [self post:@"extracting" received:(uint64_t)(MAX(0.0, MIN(1.0, progress)) * 1000) total:1000];
    [self.standard showExtractionReceivedProgress:progress];
}

- (void)showInstallingUpdate {
    [self post:@"installing" received:0 total:0];
    [self.standard showInstallingUpdate];
}

- (void)showReadyToInstallAndRelaunch:(void (^)(SPUUserUpdateChoice))reply {
    void (^answer)(SPUUserUpdateChoice) = wsOnce(reply);
    __weak ASCWorkSuiteUserDriver * weakSelf = self;
    self.readyReply = ^(SPUUserUpdateChoice choice) {
        weakSelf.readyReply = nil;
        answer(choice);
    };
    [self post:@"ready" received:_expected total:_expected];
    [self.standard showReadyToInstallAndRelaunch:self.readyReply];
}

- (void)showSendingTerminationSignal {
    [self.standard showSendingTerminationSignal];
}

- (void)showUpdateInstalledAndRelaunched:(BOOL)relaunched acknowledgement:(void (^)(void))acknowledgement {
    [self post:@"idle" received:0 total:0];
    [self.standard showUpdateInstalledAndRelaunched:relaunched acknowledgement:acknowledgement];
}

- (void)showUpdateInFocus {
    [self.standard showUpdateInFocus];
}

- (void)dismissUpdateInstallation {
    // the session ended (installed, cancelled, skipped, dismissed or failed)
    const BOOL wasReady = [self.last[@"state"] isEqualToString:@"ready"] && self.readyReply != nil;
    self.cancellation = nil;
    self.foundReply = nil;
    self.readyReply = nil;
    if (!wasReady && ![self.last[@"state"] isEqualToString:@"error"])
        [self post:@"idle" received:0 total:0];
    [self.standard dismissUpdateInstallation];
}

@end

@interface ASCWorkSuiteUpdater ()
@property (nonatomic, strong) ASCWorkSuiteUserDriver * driver;
@property (nonatomic, strong, readwrite) SPUUpdater * updater;
@end

@implementation ASCWorkSuiteUpdater

+ (instancetype)sharedUpdater {
    static ASCWorkSuiteUpdater * shared = nil;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        shared = [[ASCWorkSuiteUpdater alloc] initShared];
    });
    return shared;
}

/// The storyboard's object ("Check for Updates…") is a stand-in that hands its menu item to the shared updater, so
/// there is still one Sparkle session per app. -init must return the object it was given: the storyboard loader
/// refuses any other ("This coder is expecting the replaced object … to be returned from
/// NSClassSwapper.initWithCoder"), and macOS 26's AppKit stops the app there at launch.
- (instancetype)init {
    return [super init];
}

/// the instance that runs Sparkle: this one when it is the shared updater, otherwise the shared updater
- (ASCWorkSuiteUpdater *)session {
    return _updater ? self : [ASCWorkSuiteUpdater sharedUpdater];
}

- (instancetype)initShared {
    if (self = [super init]) {
        NSBundle * bundle = [NSBundle mainBundle];
        SPUStandardUserDriver * standard = [[SPUStandardUserDriver alloc] initWithHostBundle:bundle delegate:nil];
        _driver = [[ASCWorkSuiteUserDriver alloc] initWithStandard:standard];
        _updater = [[SPUUpdater alloc] initWithHostBundle:bundle applicationBundle:bundle userDriver:_driver delegate:self];
        NSError * error = nil;
        if (![_updater startUpdater:&error])
            NSLog(@"WorkSuite updates: Sparkle did not start: %@", error);
    }
    return self;
}

- (NSDictionary *)lastProgress {
    return self.session.driver.last ?: @{};
}

- (NSString *)foundVersion {
    ASCWorkSuiteUserDriver * driver = self.session.driver;
    return driver.foundReply ? driver.version : nil;
}

- (IBAction)checkForUpdates:(id)sender {
    [self.session.updater checkForUpdates];
}

- (BOOL)validateMenuItem:(NSMenuItem *)item {
    if (item.action == @selector(checkForUpdates:))
        return self.session.updater.canCheckForUpdates;
    return YES;
}

- (BOOL)startDownload {
    void (^reply)(SPUUserUpdateChoice) = self.session.driver.foundReply;
    if (!reply) return NO;
    reply(SPUUserUpdateChoiceInstall);
    return YES;
}

- (BOOL)cancelDownload {
    void (^cancel)(void) = self.session.driver.cancellation;
    if (!cancel) return NO;
    cancel();
    return YES;
}

- (BOOL)installAndRelaunch {
    void (^reply)(SPUUserUpdateChoice) = self.session.driver.readyReply;
    if (!reply) return NO;
    reply(SPUUserUpdateChoiceInstall);
    return YES;
}

@end
