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

## WorkSuite Cloud (a Personal account and its cloud)

"Sign in with WorkSuite Cloud" (the home screen's sign-in dialog, and the wizard's server step) signs in a
Personal account at account.worksuitecloud.com, the way WorkSuite Desktop does, and then opens that person's
cloud: the WorkSuite instance WorkSuite Cloud runs for their organization. The code is
`src/worksuite/cloud-logic.js` (the protocol, pure) and the WorkSuite Cloud section of `core.js`. It is not
offered when the organisation locked the server (managed configuration `lockServer`).

1. **Where.** `https://worksuitecloud.com/.well-known/worksuite` gives the issuer (`auth.issuer`) and the API
   (`endpoints.api`); only https addresses on worksuitecloud.com and its subdomains are taken from it, and
   without it the built-in ones are used (`https://account.worksuitecloud.com/oauth`,
   `https://worksuitecloud.com/api`). `<issuer>/.well-known/openid-configuration` must name the same issuer,
   S256 and endpoints on the issuer's own origin; it is kept for a day (`ws:cloud:meta`). WorkSuite Desktop
   pins the discovery document's Ed25519 signature instead; Office pins the hosts.
2. **Sign in.** The system browser opens `<issuer>/authorize` for the public client `worksuite-office`
   (registered in worksuite-cloud by migration 033): `response_type=code`, PKCE S256, a 32-byte `state` and
   `nonce`, scope `openid profile email offline_access wsc_orgs`, `redirect_uri=worksuiteoffice://auth/callback`
   (`prompt=create` for "Create a free account"). The password, two-step verification and passkeys stay in the
   browser. The link comes back through the app as `worksuite:link`; a pasted link works too. There is no poll
   for this step.
3. **Exchange.** `state` must match the pending sign-in and `iss` (RFC 9207) the issuer. The code, verifier and
   redirect go to the token endpoint as a form (no secret). The id_token's `iss`, `aud` (and `azp`), `nonce`,
   `exp` and `iat` are checked; it is not kept.
4. **The account.** `GET <api>/v1/me` (account state, organizations, the active one) and the userinfo's
   `wsc_orgs` (each organization's instance address, once it is ready) make the Cloud account (`ws:cloud`: who,
   which organizations; no token). Cloud's API is called with `X-WS-Org: <organization>`, as WorkSuite Desktop
   calls it.
5. **The personal cloud.** The active organization's instance (else the Personal one, else the first).
   **Through WorkSuite Cloud's gateway** when `/v1/me` offers one (`gateway: {version, base, ready, handoff}`,
   with `base` on Cloud's own hosts and `handoff: true`): `POST <gateway base>/auth/apps/handoff` with the
   Cloud token, `X-WS-Org` and a fresh PKCE challenge (`client: worksuite-office`, S256) hands a one-time code,
   which is exchanged at the instance's `/api/auth/apps/exchange` with the verifier — Office's own session on
   the instance, with no browser. The Cloud token goes to Cloud only; the instance never sees it (Cloud passes
   the request on with a short-lived assertion of its own). Any refusal — no gateway, `CLOUD_NOT_LINKED` (the
   workspace does not know this person yet), `WORKSPACE_REFUSED_GATEWAY`, not ready, an error — falls back to
   the browser: the instance is opened at `<instance>/login?wsc=switch&next=/desktop/office?challenge…&state…&device…`: the instance's own
   silent "Sign in with WorkSuite Cloud" (the browser has just signed in there), then Office's usual hand-off,
   back on `worksuiteoffice://auth/callback` or through `/api/auth/apps/poll`, and `/api/auth/apps/exchange`.
   That instance is then an ordinary account here, marked `cloud: {account, org, name}`: Drive lists, opening,
   editing and saving (each save a new version of the Drive file, through the instance's document service) are
   those of any WorkSuite server. When it is already signed in here, it is simply made the active account.
   A workspace that is still being set up, failed, or waits for the email address to be confirmed says so
   instead.

**Tokens.** Each refresh token is in the operating system's store (`worksuite:secret`): the Cloud one as
`worksuite-cloud:<issuer>|<sub>`, the instance's as `worksuite:<server>|<user id>`. Access tokens are in memory
only. Cloud refresh tokens rotate (`grant_type=refresh_token`, the new one kept before anything else); a
refused refresh (revoked on the portal's Devices or Connected apps page, expired, reused) marks the Cloud
account signed out. No token, code or verifier is written to localStorage or to a log.

**Settings › WorkSuite › Accounts** lists the WorkSuite Cloud accounts under the others, with the workspace's
state and storage (`GET <api>/v1/storage/usage`), **Open my cloud** and **Sign out of WorkSuite Cloud**: the
grant is revoked (`<issuer>/revoke`, RFC 7009), its token deleted, and its workspaces are signed out here too.
A workspace account whose session ended signs in again through WorkSuite Cloud.

**The gateway** (worksuite-cloud `api/src/routes/cloud/gateway.ts`, WorkSuite Auth 2.9.0 `CloudGateway`): Cloud
checks the token and the membership, and passes allow-listed paths (Drive, files, uploads, `/api/auth/me`,
`/api/auth/apps/handoff` …) to the organization's instance with a 60-second assertion signed with its OIDC key.
The instance lets in only the person linked to that Cloud identity; a person it does not know yet is linked by
their own browser sign-in, which is why the browser stays as the fallback. A Cloud without the gateway (older, or
`CLOUD_GATEWAY=0`) has no `gateway` in `/v1/me`, and step 5 is the browser, as before.

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

## The home screen's Files explorer and Drive account panel

Home has one file explorer (`routes/home/components/FilesExplorer.jsx`) with the tabs Recent, My Drive, Shared
with me, Starred and This computer; one list shows at a time. Recent is the native recent files plus Drive's
recently opened files (`view=recent`), merged without duplicates (`mergeRecents()`); My Drive, Shared with me and
Starred are Drive's `browse`/`search`, `view=shared` and `view=starred`; This computer is the native recent files
that are on this computer. Each tab keeps its own search, filters, sort, layout and scroll position
(`stores/home-session.js`) and loads only when shown; a Drive list shown again within a minute is not fetched
again (Refresh fetches). On the Drive tabs, `WorkSuiteSection.jsx` and `connect.jsx` show the default account (`ws:active`) in one of three states
(`accountPanelState()` in `home-logic.js`):

| State | When | Panel |
|---|---|---|
| Connected | the account is not `signedOut` | name, server, "Connected", the organisation picker, Refresh, the Drive browser |
| Session expired | `signedOut` and not `signedOutBy: "user"` (refresh refused, 401) | a compact warning, the "Session expired" badge and **Reconnect**; no Drive list |
| Not connected | no account, or signed out by the person | the "Connect your WorkSuite account" card |

An expired or signed-out account is never shown as connected, and its Drive list is not loaded. Local recent
files are not affected by the state of any WorkSuite account.

**Reconnect** (home screen) re-authenticates the *same saved account*; it never removes it:

1. `WorkSuite.reconnect(account)` tries the kept refresh token silently. On success the panel turns
   "Connected" and the Drive list and organisations load (`changed`).
2. When the token is refused, a sign-in opens for that account only: WorkSuite Desktop's "Continue as"
   when that account is signed in there, otherwise the browser sign-in straight on the account's server
   (`SignInDialog` with `server`). The finished sign-in updates the existing entry (same key
   `server|user id`), then `signedin` refreshes the panel and the Drive list.
3. A network failure shows "<server> did not answer" next to Reconnect and keeps everything.

Reconnect is a small state machine (`reconnectStep()`: idle → refreshing → signing-in → idle, or error).
While it is refreshing or a sign-in is open, further clicks do nothing, so only one login window can be
opened. Cancelling the sign-in returns to idle with the account still expired.

**The account menu** (the name in the panel) lists the other accounts on this computer (switching makes one
the default; one only on WorkSuite Desktop starts its "Continue as"), **Add another account**, **Manage
accounts…** (Settings › WorkSuite › Accounts) and **Disconnect…**. Disconnect asks first, then signs out
(`signOutOnly`): the account stays, as "Signed out", to sign in again in one click. Removing an account is
done in Manage accounts.

**The organisation picker** lists only the organisations the server returned for this account
(`/api/drive/sharing/companies`, kept in the account's profile), plus All companies, and can be searched.

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
documents in" (`ws:pref:openIn`), update settings and the theme. The web cookies of editor tabs are one
store for the app: see *Editor tabs and web cookies* for how a server's tabs are kept to one account
(`ws:tab-owner`). Local recent files and offline
working copies belong to the computer's user, not to a WorkSuite account. An offline copy records the
server and user id it came from and is saved back only through that account.

**Tokens never cross accounts.** An access token is sent only in requests to its own account's server
(`api()` builds every URL from `account.server`). A refresh token goes only to that server's
`/api/auth/refresh` and `/api/auth/logout`. Adding an account writes only its own secure-store entry. Adding
the same account again replaces only that account's entry.

**Sign out** (`WorkSuite.signOutOnly`, also the home screen's **Disconnect…**, after a confirmation) revokes the session on its server (`/api/auth/logout`), deletes the
account's secure-store entry and its access token, and marks it *signed out by the person*. Its profile and
Drive cache stay so it can be signed in again from its card. The server's editor tabs are signed out
(`portal:logout`: they close and the server's cookies are deleted) when they are this account's tabs (see
*Editor tabs and web cookies*), or when no other signed-in account uses that server.

**Remove** (`WorkSuite.remove`, Settings › WorkSuite › Accounts) does the same and also deletes the
account's profile entry and its `ws:cache:<id>:…` data. Other accounts are not touched.

## Editor tabs and web cookies

**What was asked.** A CEF request context per account (its own cache folder and cookie store under the
account's data folder, keyed by server + user id), used by the editor tabs opened from that account; Sign
out clears that context's cookies and Remove deletes its folder.

**Why that is not possible in this repository.** The app does not create browsers or see CEF: the ONLYOFFICE
desktop SDK (`desktop-sdk`, `ChromiumBasedEditors/lib`) does, and it gives every view the one global context:

| Where (desktop-sdk `ChromiumBasedEditors/lib`) | What blocks |
|---|---|
| `src/cefview.cpp`, `CCefView::load()` (`CefBrowserHost::CreateBrowser` / `CreateBrowserSync`) | the browser is created with `request_context` = `nullptr`, i.e. the global context, for every tab |
| `include/cefview.h` `CCefView::load(const std::wstring&)`, `include/applicationmanager.h` `CreateCefView()` / `CreateCefEditor()` | no way to pass a context (or a key for one); no CEF type is exposed, and the app is built without CEF headers |
| `src/cefapplication.cpp` (`settings.cache_path` from `m_oSettings.cache_path`), `include/applicationmanager.h` `cache_path` / `cookie_path` | one cache and cookie folder for the whole process |
| `src/cefview.cpp` (`is_cookie_present`, `on_check_auth`, `set_cookie`), `src/cookiesworker.h`, `src/applicationmanager_p.h` `Logout()`, `src/applicationmanager.cpp` `CAscApplicationManager::Logout()` | cookies are read, set and deleted through `CefCookieManager::GetGlobalManager()`, never a tab's own context |
| `src/cors_resource_hanler.h` | its requests use `CefRequestContext::GetGlobalContext()` |

An SDK change would be: `CCefView::load(url, contextKey)` creating `CefRequestContext::CreateContext()` with
`cache_path = <app data>/accounts/<hash of key>` (cached per key, reused), the cookie helpers and `Logout()`
taking the view's `GetRequestContext()->GetCookieManager()`, and `CAscApplicationManager::ClearContext(key,
deleteFolder)` for Sign out and Remove. With that, the start page would pass the account id in
`open:recent` (it already passes `cloud`).

**What is done instead: one account per server in the editor tabs.** All tabs share one cookie store, so
the tabs of a server belong to one account at a time, and the server's cookies are always that account's
(`core.js`, `claimServerTabs()`, `ws:tab-owner` in the start page's `localStorage`: server → account id,
no secret):

- Opening a WorkSuite document records its account as the owner of that server's tabs.
- Opening a document of that server as **another** account asks first ("Open as <name>?", the start page's
  `AccountSwitchDialog`). On Close them and open, the server's web session ends (`portal:logout`, the same
  native path as before on Windows, Linux and macOS): its tabs close, asking to save unsaved changes, and
  its cookies are deleted (`CAscApplicationManager::Logout`). Only then does the new account's hand-off open
  the tab. Cancel, or keeping a tab with unsaved changes (`portal:logout:cancel`; macOS now sends it too),
  opens nothing and leaves the other account's tabs as they were.
- **Sign out** and **Remove** of the owner end the server's web session even when another account of that
  server is still signed in. For any other account the rule is as before (only when no other signed-in
  account uses the server). Nothing per account is kept on disk by CEF, so there is no folder to delete.

**Limits.** Two accounts of one server cannot have documents open side by side; switching closes the
other account's tabs. Other servers are not affected: two accounts on two servers keep their tabs open
together. A server's tabs that were open before this version have no recorded owner: the first document
opened afterwards takes them without asking. Documents opened in the browser ("Open WorkSuite Drive
documents in" the browser) use the browser's own cookies and are not affected. While a `portal:logout` runs,
another open on that server waits for it (at most 2 minutes, then it is cancelled).

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
17. Two accounts X and Y on one server: opening a document as X, then one as Y, asks "Open as Y?". Close them
    and open closes X's tabs of that server (asking to save changes first), and Y's document opens signed in as
    Y: the editor shows Y's name, and reloading it does not bring X back.
18. Cancel in that dialog, or Cancel in the unsaved-changes question, opens nothing; X's tabs stay open and
    signed in as X.
19. Opening another document as the same account on that server asks nothing and closes nothing. Tabs of
    other servers are never closed by a switch.
20. Sign out or Remove of the account whose tabs are open closes that server's tabs and deletes its cookies,
    even when another account of the server stays signed in. Sign out of an account whose tabs are not open
    closes nothing.

21. Home screen: with the default account's session expired, the Drive panel shows "Session expired" and
    **Reconnect**, never "Connected" and never the Drive list. Local recent files are still listed.
22. Reconnect with a working refresh token turns the panel "Connected" and loads the Drive files without a
    sign-in window. With a refused token it opens exactly one sign-in, for that account's server (or
    WorkSuite Desktop's "Continue as" for it), however often Reconnect is clicked. The saved account is
    not removed; after the sign-in the same entry is "Signed in" and the Drive files load.
23. **Disconnect…** in the account menu asks first, then signs the account out and keeps it as "Signed out".
24. The organisation picker lists only the account's organisations and filters them as you type.

`npm test` covers 2, 3, 5, 7, 9–11, 14 and the start page's side of 17–20, the state rules of 21–22
(`test/accounts.test.mjs`, `src/worksuite/account-wizard-logic.test.mjs`, `src/worksuite/settings-logic.test.mjs`,
`src/worksuite/home-logic.test.mjs`). The others are
checked by hand on each platform.
