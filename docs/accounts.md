# WorkSuite accounts in WorkSuite Office

How WorkSuite Office keeps several WorkSuite accounts on one computer: adding one, signing it out,
removing it, and what is kept apart for each. The code is the start page
(`common/loginpage/src/worksuite/core.js`, Settings › WorkSuite › Accounts in
`common/loginpage/src/routes/settings/worksuite/`, the wizard in `account-wizard.jsx` and
`account-wizard-logic.js`) and the native secure store (`win-linux/src/cworksuite.cpp`,
`macos/.../ASCCommonViewController.mm`).

## Why "Add another account" did nothing

The button worked and the sign-in dialog was rendered, but nobody could see it. The shared `Dialog.Content`
(`src/components/dialog/Dialog.jsx`) gave Kobalte a `classList` with its own classes (`content`, which
positions the panel, and the caller's `class`) and then spread the caller's other props over it. The
WorkSuite dialogs (`Frame` in `dialogs.jsx`) pass a `classList` of their own, so it *replaced* the
panel's classes: the dialog was left with no class at all, unpositioned at the top of the page and
underneath its overlay (`z-index: 200`). The click dimmed the screen and nothing else happened. Every
WorkSuite dialog was affected (Sign in, New document, Move, Versions, Share, Open link). The native side
(`worksuite:open`, `worksuite:secret`, `worksuite:desktop` on Windows/Linux and macOS) and the
`worksuiteoffice://` callback were never reached, and nothing in them was wrong.

Fix: `Dialog.Content` merges the caller's `classList` into its own. Settings › WorkSuite now adds accounts
through the wizard below.

## The add-account wizard

1. **Server**: type a host or https address, or pick a server already used on this computer. Only `https://`
   is accepted, and the address is normalised to its origin. A server set by the organisation (managed
   configuration, `server` + `lockServer`) is filled in and cannot be changed.
2. **Connection**: `GET /.well-known/worksuite-desktop` (falling back to `/api/health`) through
   `WorkSuite.checkServer()`. The result is one of three: ready, *too old* (its sign-in endpoints or
   module versions are below `MIN_SERVER`), or unreachable / not a WorkSuite server. Retry and Back are
   offered.
3. **Account**: "Continue as" for each WorkSuite Desktop account on that server
   (`worksuite:desktop`: names and addresses only, never tokens), or "Sign in with another account"
   (the browser).
4. **Sign in**: the existing flows of `core.js`. The WorkSuite Desktop hand-off is
   `worksuite://office/signin` with PKCE. The browser flow is `<server>/desktop/office` with PKCE, with
   the `worksuiteoffice://auth/callback` link or `/api/auth/apps/poll`, and the sign-in code can be
   pasted as a fallback. Cancel, a timeout (2 min for Desktop, 5 min for the browser) and errors return
   to this step with Try again.
5. **Check and save**: the session from the exchange (user, organisation) is saved, then
   `GET /api/drive/sharing/companies` checks that it works and lists the organisations. A failure there is
   a warning, not a failure. The account's card is then focused.

Esc closes the wizard and cancels a pending sign-in. Back goes one step back. Every control is reachable
with Tab.

## Card actions

| Status | Inline action | Menu |
|---|---|---|
| Signed in | – | Switch to this account (when there are several), Sign out, Remove from this computer |
| Server unreachable (a signed-in account whose server did not answer the probe) | Reconnect | Sign out, Remove |
| Session expired (the server refused the kept refresh token) | Reconnect | Remove |
| Signed out (by the person) | Sign in | Remove |
| Available via WorkSuite Desktop (not added here yet) | Connect | – |

**Reconnect** first tries the kept refresh token silently (`WorkSuite.reconnect()`). It asks for
credentials (WorkSuite Desktop's "Continue as" when that account is there, otherwise the wizard for that
server) only when the refresh token is refused or there is none. A network failure shows *Server
unreachable* and does not discard anything.

## Account data isolation

**Key.** Each account is identified by `server origin + "|" + user id`
(`https://app.worksuite.lk|42`), its `id` (`accountId()`). Two users on one server, or one user on two
servers, are two accounts.

**What is stored per account, and where:**

| Data | Where | Name / key |
|---|---|---|
| Refresh token | Windows: Credential Manager, generic credential | target `WorkSuite Office/worksuite:<server>\|<user id>` |
| | macOS: login Keychain, generic password | service `WorkSuite Office`, account `worksuite:<server>\|<user id>` |
| | Linux: Secret Service (GNOME Keyring, KWallet, KeePassXC) via libsecret | schema `lk.worksuite.Office.SignIn`, attribute `key` = `worksuite:<server>\|<user id>` |
| | Linux without a Secret Service (last resort, with a warning on the start page) | `<app common path>/worksuite-secrets.json`, mode 0600, same key |
| Access token | memory only (`access[id]`), never written | account id |
| Profile (name, e-mail, avatar URL, organisation, how it signed in, companies, chosen company) | start page `localStorage` `ws:accounts` | entry with that `id` |
| Drive lists and picture addresses (cache) | start page `localStorage` | `ws:cache:<id>:…` |
| Server capability | start page `localStorage` | `ws:caps:<server>` (per server, holds no secret) |
| Default (active) account | start page `localStorage` | `ws:active` = id |

WorkSuite OS accounts (`broker`) keep no token here: the OS credentials broker holds it.

**What is shared:** UI preferences only: the default server (`ws:pref:server`), "Open WorkSuite Drive
documents in" (`ws:pref:openIn`), update settings and the theme. Local recent files and offline
working copies belong to the computer's user, not to a WorkSuite account. An offline copy records the
server and user id it came from and is saved back only through that account.

**Tokens never cross accounts.** An access token is sent only in requests to its own account's server
(`api()` builds every URL from `account.server`). A refresh token goes only to that server's
`/api/auth/refresh` and `/api/auth/logout`. Adding an account writes only its own secure-store entry. Adding
the same account again replaces only that account's entry.

**Sign out** (`WorkSuite.signOutOnly`) revokes the session on its server (`/api/auth/logout`), deletes the
account's secure-store entry and its access token, and marks it *signed out by the person*. Its profile and
Drive cache stay so it can be signed in again from its card. Editor tabs of that server are signed out
(`portal:logout`) only when no other signed-in account uses that server.

**Remove** (`WorkSuite.remove`, also the Drive section's Disconnect) does the same and also deletes the
account's profile entry and its `ws:cache:<id>:…` data. Other accounts are not touched.

**Limitation.** The app uses one CEF request context. Editor tabs opened for two accounts **on the same
server** share that server's web cookies. Documents are opened with a one-time hand-off of the chosen
account (`/api/auth/apps/handoff`), so each tab opens as its own account. A separate cookie partition per
account would need per-account CEF request contexts in the native shell, and that is not part of this
change.

## Acceptance criteria

Unless a platform is named, each criterion holds on Windows, macOS and Linux.

1. Settings › WorkSuite › Accounts › **Add account** opens the wizard on the first click, in the light and
   dark themes. The button reads clearly in both (contrast ≥ 4.5:1) and shows a hover, a pressed state and
   a visible focus ring.
2. An `http://` address, a single word or a host with spaces stays on step 1 with an inline error and no
   network request.
3. A reachable WorkSuite server goes on to step 3. A server below `MIN_SERVER` shows "too old" with no Next.
   An unreachable one shows the error with Retry and Back.
4. With WorkSuite Desktop signed in to that server, step 3 lists "Continue as <name>". Choosing it signs in
   without a browser and without a password. Without WorkSuite Desktop only "Sign in with another account"
   is shown.
5. The browser sign-in opens the system browser. Finishing there, or pasting the code, completes the
   wizard. Cancel and Esc cancel the pending sign-in. After 5 min (browser) or 2 min (Desktop) a timeout
   message with Try again appears.
6. After sign-in, the new account's card is shown and focused, with the status "Signed in". The other
   accounts' cards, statuses and Drive lists are unchanged.
7. Adding an account that is already signed in here neither duplicates it nor changes another account. The
   existing card is focused with "already on this computer".
8. Windows: Credential Manager has one `WorkSuite Office/worksuite:<server>|<id>` entry per account. macOS:
   Keychain has one `WorkSuite Office` item per account, named by that key. Linux: the Secret Service has
   one `lk.worksuite.Office.SignIn` item per account (or the 0600 file, with the warning shown).
9. **Sign out** on one account removes only its secure-store entry, keeps its card as "Signed out" with
   **Sign in**, and leaves the other accounts signed in.
10. **Remove** deletes the card, its secure-store entry and its `ws:cache:<id>` data. Other accounts keep
    theirs.
11. An account whose refresh token the server refuses shows "Session expired". **Reconnect** then asks for
    a sign-in. When the refresh still works, Reconnect restores "Signed in" without any sign-in.
12. A signed-in account whose server does not answer shows "Server unreachable". Reconnect reports it
    again and keeps the session.
13. **Switch to this account** makes it the default (`ws:active`). The home screen's WorkSuite Drive then
    shows its documents.
14. No request to one server carries another account's access or refresh token (`test/accounts.test.mjs`).
15. A server locked by managed configuration fills step 1 read-only, with "set by your organisation".
16. The wizard and the account menu work with the keyboard alone: Tab, Enter and Space, Esc, and the arrow
    keys in menus.

`npm test` covers 2, 3, 5, 7, 9–11 and 14 (`test/accounts.test.mjs`,
`src/worksuite/account-wizard-logic.test.mjs`, `src/worksuite/settings-logic.test.mjs`). The others are
checked by hand on each platform.
