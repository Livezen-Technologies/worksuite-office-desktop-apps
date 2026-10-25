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
//  ASCWorkSuiteUpdater.h
//  WorkSuite Office
//
//  Sparkle 2 for WorkSuite Office, with download progress for Settings › WorkSuite › Updates.
//

#import <Cocoa/Cocoa.h>
#import <Sparkle/Sparkle.h>

NS_ASSUME_NONNULL_BEGIN

/// Posted on the main thread while Sparkle finds, downloads, extracts and readies an update. userInfo:
///   state       "found" | "downloading" | "extracting" | "ready" | "installing" | "error" | "idle"
///   received    bytes so far (downloading), or extraction progress × 1000 (extracting)
///   total       expected bytes (0 when the server sent no length), or 1000 (extracting)
///   version     the update's display version
///   cancellable YES while the download can still be stopped (until extraction starts)
extern NSNotificationName const ASCWorkSuiteUpdateProgressNotification;

/// The app's one Sparkle updater (replaces the storyboard's SUUpdater, whose user driver reports no
/// progress). Sparkle's standard windows are kept as they were: every user-driver call is forwarded to
/// SPUStandardUserDriver, and the wrapper only also reports what it sees. The storyboard object
/// (Main.storyboard, "Check for Updates…") is this same instance: -init returns +sharedUpdater.
@interface ASCWorkSuiteUpdater : NSObject <SPUUpdaterDelegate, NSMenuItemValidation>

+ (instancetype)sharedUpdater;

@property (nonatomic, readonly) SPUUpdater * updater;
/// the last progress notification's userInfo, for a start page that loads after it ({} before any)
@property (nonatomic, readonly, copy) NSDictionary * lastProgress;
/// the update Sparkle offers now (its "update found" step is open), or nil
@property (nonatomic, readonly, copy, nullable) NSString * foundVersion;

- (IBAction)checkForUpdates:(nullable id)sender;

/// The Updates card's Download: answers Sparkle's "update found" step with Install (Sparkle then downloads
/// and checks the EdDSA signature). NO when no update is waiting for an answer.
- (BOOL)startDownload;
/// stops a download that has not reached extraction; NO when there is none
- (BOOL)cancelDownload;
/// "Restart to update": answers "ready to install" with Install (Sparkle relaunches); NO when not ready
- (BOOL)installAndRelaunch;

@end

NS_ASSUME_NONNULL_END
