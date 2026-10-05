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

//
//  ASCAboutController.m
//  ONLYOFFICE
//
//  Created by Alexander Yuzhin on 18.02.16.
//  Copyright © 2017 Ascensio System SIA. All rights reserved.
//

#import "ASCAboutController.h"

#import "ASCConstants.h"
#import "ASCExternalController.h"
#import "ASCSharedSettings.h"
#import "ASCLicenseController.h"

static NSString * const kAboutPublisherName = @"Livezen Technologies LLC";
static NSString * const kAboutWebsiteTitle  = @"worksuitecloud.com";
static NSString * const kAboutWebsiteUrl    = @"https://worksuitecloud.com";
static NSString * const kAboutSourceCodeUrl = @"https://github.com/Livezen-Technologies/worksuite-office";
static NSString * const kAboutUpstreamName  = @"ONLYOFFICE Desktop Editors";
static NSString * const kAboutUpstreamCopyright = @"Copyright © 2026 Ascensio System SIA and contributors.";

@interface ASCAboutController () {
    BOOL isCommercialVersion;
}
@property (weak) IBOutlet NSTextField *appNameText;
@property (weak) IBOutlet NSTextField *versionText;
@property (weak) IBOutlet NSTextField *copyrightText;
@property (weak) IBOutlet NSButton *licenseButton;
@property (weak) IBOutlet NSStackView *infoStackView;
@end

@implementation ASCAboutController

- (void)viewDidLoad {
    [super viewDidLoad];

    id <ASCExternalDelegate> externalDelegate = [[ASCExternalController shared] delegate];
    
    NSString * locProductName   = [ASCHelper appName];

    if (externalDelegate && [externalDelegate respondsToSelector:@selector(onCommercialInfo)]) {
        NSString * commercialInfo = [externalDelegate onCommercialInfo];

        if (commercialInfo) {
            NSTextField * commercialTextField;
            if (@available(macOS 10.12, *)) {
                commercialTextField = [NSTextField labelWithString:commercialInfo];
            } else {
                commercialTextField = [[NSTextField alloc] initWithFrame:NSMakeRect(0, 0, self.infoStackView.frame.size.width, 35)];
                [commercialTextField setStringValue:commercialInfo];
                [commercialTextField setFont:[NSFont systemFontOfSize:[NSFont systemFontSize]]];
                [commercialTextField setBezeled:NO];
                [commercialTextField setDrawsBackground:NO];
                [commercialTextField setEditable:NO];
                [commercialTextField setSelectable:NO];
            }
            [commercialTextField setAlignment:NSTextAlignmentCenter];
            [commercialTextField setLineBreakMode:NSLineBreakByWordWrapping];
            [commercialTextField setUsesSingleLineMode:NO];

            [self.infoStackView insertArrangedSubview:commercialTextField atIndex:2];
        }
    }

    NSURL * eulaUrl = [[NSBundle mainBundle] URLForResource:@"EULA" withExtension:@"html" subdirectory:@"license"];
    isCommercialVersion = eulaUrl != nil;

        // About View
        [self styleLinkButton:self.licenseButton];
        [self setupLinksRow];

#ifdef _MAS
        [self.licenseButton setHidden:YES];
#endif
        
        // Product name
        [self.appNameText setStringValue:locProductName];
        
        // Version
        [self.versionText setStringValue:[self versionString:NO]];

        NSClickGestureRecognizer *click = [[NSClickGestureRecognizer alloc] initWithTarget:self action:@selector(onVersionClick:)];
        [self.versionText addGestureRecognizer:click];
        
        // If has extra features
        if ([[[ASCSharedSettings sharedInstance] settingByKey:kSettingsHasExtraFeatures] boolValue]) {
            [self.versionText setStringValue:[NSString stringWithFormat:@"%@\n%@",
                                              self.versionText.stringValue,
                                              NSLocalizedString(@"With access to pro features", nil)]];
        }
        
        // Publisher and website, above the upstream copyright
        NSTextField * builtByText = [self labelWithString:[NSString stringWithFormat:NSLocalizedString(@"Built by %@", nil), kAboutPublisherName]];
        NSFont * font = builtByText.font;
        NSMutableAttributedString * builtBy = [[NSMutableAttributedString alloc] initWithString:builtByText.stringValue
                                                                                      attributes:@{NSFontAttributeName: font}];
        [builtBy addAttribute:NSFontAttributeName
                        value:[NSFont boldSystemFontOfSize:font.pointSize]
                        range:[builtBy.string rangeOfString:kAboutPublisherName]];
        [builtByText setAttributedStringValue:builtBy];

        NSButton * websiteButton = [self linkButtonWithTitle:kAboutWebsiteTitle action:@selector(onWebsiteClick:)];
        websiteButton.font = [NSFont boldSystemFontOfSize:font.pointSize];
        [self styleLinkButton:websiteButton];

        NSStackView * publisherStack = [NSStackView stackViewWithViews:@[builtByText, websiteButton]];
        [publisherStack setOrientation:NSUserInterfaceLayoutOrientationVertical];
        [publisherStack setAlignment:NSLayoutAttributeCenterX];
        [publisherStack setSpacing:0];

        NSUInteger copyrightIndex = [self.infoStackView.arrangedSubviews indexOfObject:self.copyrightText];
        [self.infoStackView insertArrangedSubview:publisherStack atIndex:copyrightIndex];

        // Upstream attribution, kept as required by the AGPL
        [self.copyrightText setStringValue:[NSString stringWithFormat:NSLocalizedString(@"Based on %@.\n%@", nil), kAboutUpstreamName, kAboutUpstreamCopyright]];
        
        // Window
        [self setTitle:[NSString stringWithFormat:NSLocalizedString(@"About %@", nil), locProductName]];
}

- (void)viewDidAppear {
    [super viewDidAppear];
        
    [self.view.window setStyleMask:[self.view.window styleMask] & ~NSResizableWindowMask];

    // Nothing is focused when the window opens; the links still get a focus
    // ring once the user moves to them with the keyboard.
    [self.view.window setAutorecalculatesKeyViewLoop:YES];
    [self.view.window setInitialFirstResponder:nil];
    [self.view.window makeFirstResponder:nil];
}

- (NSString *)versionString:(BOOL)detailed {
    NSDictionary * infoDictionary = [[NSBundle mainBundle] infoDictionary];
    NSString * edition = !isCommercialVersion ? NSLocalizedString(@"Community", nil) : NSLocalizedString(@"Enterprise", nil);
    NSString * version = [infoDictionary objectForKey:@"CFBundleShortVersionString"];

    if (!detailed) {
        return [NSString stringWithFormat:NSLocalizedString(@"Version %@ (%@)", nil), version, edition];
    }

    NSString * build = [NSString stringWithFormat:@"%@.%@", version, [infoDictionary objectForKey:@"ASCBundleBuildNumber"]];
    return [NSString stringWithFormat:NSLocalizedString(@"Version %@ (%@)\nBuild %@", nil), version, edition, build];
}

- (NSTextField *)labelWithString:(NSString *)string {
    NSTextField * label = [[NSTextField alloc] initWithFrame:NSZeroRect];
    [label setStringValue:string];
    [label setFont:[NSFont systemFontOfSize:[NSFont systemFontSize]]];
    [label setAlignment:NSTextAlignmentCenter];
    [label setBezeled:NO];
    [label setDrawsBackground:NO];
    [label setEditable:NO];
    [label setSelectable:NO];
    [label setRefusesFirstResponder:YES];
    return label;
}

- (NSButton *)linkButtonWithTitle:(NSString *)title action:(SEL)action {
    NSButton * button = [[NSButton alloc] initWithFrame:NSZeroRect];
    [button setTitle:title];
    [button setTarget:self];
    [button setAction:action];
    [button setButtonType:NSMomentaryChangeButton];
    [button setBordered:NO];
    [button setFont:[NSFont systemFontOfSize:12]];
    [button setFocusRingType:NSFocusRingTypeDefault];
    [button setToolTip:title];
    return button;
}

- (void)styleLinkButton:(NSButton *)button {
    NSMutableAttributedString * attrTitle = [[NSMutableAttributedString alloc] initWithString:button.title
                                                                                    attributes:@{NSFontAttributeName: button.font}];
    NSRange range = NSMakeRange(0, attrTitle.length);
    [attrTitle addAttribute:NSForegroundColorAttributeName value:[NSColor linkColor] range:range];
    [attrTitle fixAttributesInRange:range];
    [button setAttributedTitle:attrTitle];
    [[button cell] setShowsStateBy:NSNoCellMask];
    [[button cell] setHighlightsBy:NSNoCellMask];
}

- (NSTextField *)separatorLabel {
    NSTextField * label = [self labelWithString:@"·"];
    [label setTextColor:[NSColor secondaryLabelColor]];
    return label;
}

// [License agreement] · [Source code] · [Third-party notices]
- (void)setupLinksRow {
    NSView * container = self.licenseButton.superview;
    NSButton * licenseButton = self.licenseButton;
    [licenseButton removeFromSuperview];
    [licenseButton setFocusRingType:NSFocusRingTypeDefault];

    NSButton * sourceButton = [self linkButtonWithTitle:NSLocalizedString(@"Source code", nil) action:@selector(onSourceCodeClick:)];
    NSButton * noticesButton = [self linkButtonWithTitle:NSLocalizedString(@"Third-party notices", nil) action:@selector(onThirdPartyNoticesClick:)];
    [self styleLinkButton:sourceButton];
    [self styleLinkButton:noticesButton];

    NSStackView * row = [NSStackView stackViewWithViews:@[licenseButton, [self separatorLabel],
                                                          sourceButton, [self separatorLabel],
                                                          noticesButton]];
    [row setOrientation:NSUserInterfaceLayoutOrientationHorizontal];
    [row setAlignment:NSLayoutAttributeCenterY];
    [row setSpacing:6];
    [row setTranslatesAutoresizingMaskIntoConstraints:NO];
    [container addSubview:row];

    [container addConstraints:@[
        [NSLayoutConstraint constraintWithItem:row attribute:NSLayoutAttributeCenterX relatedBy:NSLayoutRelationEqual
                                        toItem:container attribute:NSLayoutAttributeCenterX multiplier:1 constant:0],
        [NSLayoutConstraint constraintWithItem:row attribute:NSLayoutAttributeTop relatedBy:NSLayoutRelationEqual
                                        toItem:self.infoStackView attribute:NSLayoutAttributeBottom multiplier:1 constant:10],
        [NSLayoutConstraint constraintWithItem:container attribute:NSLayoutAttributeBottom relatedBy:NSLayoutRelationEqual
                                        toItem:row attribute:NSLayoutAttributeBottom multiplier:1 constant:20],
        [NSLayoutConstraint constraintWithItem:row attribute:NSLayoutAttributeLeading relatedBy:NSLayoutRelationGreaterThanOrEqual
                                        toItem:container attribute:NSLayoutAttributeLeading multiplier:1 constant:10],
    ]];
}

- (void)openLocalPage:(NSURL *)url {
    if (!url) {
        return;
    }

    NSWindowController * windowController = [self.storyboard instantiateControllerWithIdentifier:@"ASCLicenseWindowControllerId"];
    ASCLicenseController *licView = (ASCLicenseController *)windowController.contentViewController;
    [licView setUrl:url];
    NSWindow *licWindow = windowController.window;

    NSRect parentFrame = self.view.window.frame;
    NSRect childFrame = licWindow.frame;
    [licWindow setFrameOrigin:NSMakePoint(NSMidX(parentFrame) - childFrame.size.width/2,
                                          NSMidY(parentFrame) - childFrame.size.height/2)];
    [licWindow makeKeyAndOrderFront:nil]; // Show the window first to apply the coordinates

    [NSApp runModalForWindow:licWindow];
}

- (IBAction)onWebsiteClick:(id)sender {
    [[NSWorkspace sharedWorkspace] openURL:[NSURL URLWithString:kAboutWebsiteUrl]];
}

- (IBAction)onSourceCodeClick:(id)sender {
    [[NSWorkspace sharedWorkspace] openURL:[NSURL URLWithString:kAboutSourceCodeUrl]];
}

- (IBAction)onThirdPartyNoticesClick:(id)sender {
    NSURL * noticesUrl = [[NSBundle mainBundle] URLForResource:@"acknowledgments" withExtension:@"html" subdirectory:@"login"];
    [self openLocalPage:noticesUrl];
}

- (void)viewDidDisappear {
    [super viewDidDisappear];
    
    [NSApp stopModal];
}

- (void)onVersionClick:(NSTextField *)sender {
    [self.versionText setStringValue:[self versionString:YES]];
    
#if _V8_VERSION
    [self.versionText setStringValue:[NSString stringWithFormat:@"%@ x86", [self.versionText stringValue]]];
#elif _X86_64_ONLY
    [self.versionText setStringValue:[NSString stringWithFormat:@"%@ x86_64", [self.versionText stringValue]]];
#elif _ARM_ONLY
    [self.versionText setStringValue:[NSString stringWithFormat:@"%@ Apple Silicon", [self.versionText stringValue]]];
#endif
}

- (IBAction)onLicenseButtonClick:(id)sender {
    NSURL * eulaUrl = [[NSBundle mainBundle] URLForResource:@"EULA" withExtension:@"html" subdirectory:@"license"];
    if ( !eulaUrl )
        eulaUrl = [[NSBundle mainBundle] URLForResource:@"LICENSE" withExtension:@"html" subdirectory:@"license"];
    
    [self openLocalPage:eulaUrl];
}

@end
