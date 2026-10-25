# Clouds › WorkSuite Drive

Clouds is the full WorkSuite Drive browser once an account is connected. Before, it showed only a
"WorkSuite Drive — Connect" row. The code:

| Part | File |
| --- | --- |
| Page (WorkSuite Drive first, other clouds below it) | `common/loginpage/src/routes/clouds/index.jsx` |
| The browser | `common/loginpage/src/worksuite/CloudsDrive.jsx`, `clouds-drive.css` |
| Pure logic, with tests | `common/loginpage/src/worksuite/clouds-logic.js`, `clouds-logic.test.mjs` |
| Drive calls | `common/loginpage/src/worksuite/core.js` (`WorkSuite.*`) |
| Byte transfers through the app | `common/loginpage/src/worksuite/shell.js` (`worksuite:transfer`), `win-linux/src/cworksuite.cpp` (`CWorkSuite::transfer`), `macos/.../ASCCommonViewController.mm` (`workSuiteTransfer:`) |

The screen reuses Home's pieces: the connect card and the account panel with its Reconnect state machine
(`connect.jsx`, `home-logic.js` `reconnectStep`), the organisation picker, the sign-in dialog and account
wizard, the New, Move, Version history and Share dialogs, and the UI kit (`ui/components.jsx`).

## Design

The browser is laid out like WorkSuite Desktop's Drive module (`src/modules/files` in worksuite-desktop):

- a 240px rail with New and the places;
- a header with the breadcrumb, the title, New folder and Upload;
- a toolbar with search, Refresh, list/grid, density and Details;
- a table whose sticky header sits on the ground colour, with 36px rows (30px when compact);
- a details drawer;
- an upload tray.

The tokens in `ui/tokens.css` are Desktop's own values, from `src/styles.css`, for light, dark and high
contrast. The kit's Menu, Checkbox, InfoBanner, ConnectionWarning, SyncButton, OrgSwitcher and avatar follow
Desktop's components. The page is the one vertical scroll container; the rail and the table header stay in
place while it scrolls.

## Connecting

1. **Not connected.** A full-width card explains what connecting gives, beside the connect card. If WorkSuite
   Desktop on this computer is signed in, the card offers **Continue as <name>**, which reuses that session
   through WorkSuite Desktop's hand-off. **Use another account** opens the existing sign-in and account
   wizard, and the WorkSuite OS broker is used when it is present.
2. **Connecting.** A progress card shows the steps: signing in, checking the server
   (`/.well-known/worksuite-desktop`), getting the organisations (`GET /api/drive/sharing/companies`), and
   opening the Drive.
3. **Choosing an organisation.** An account in more than one organisation, with no organisation chosen yet,
   picks one, or All organisations. Its Drive then loads and the browser opens by itself.

The account strip shows the avatar, name, server and status, and the organisation selector. Its account
menu has Switch account, Add account, Manage accounts and Disconnect.

If the session expires, the account strip shows **Reconnect**. Reconnect tries a silent refresh first, then
a single sign-in for the same account. Meanwhile the cached list stays visible, read-only.

## Places, browsing and states

- **Places:** My Drive (`GET /api/files/browse`), Recent, Shared with me and Starred
  (`GET /api/drive/list?view=…`), and Trash (`GET /api/drive/list?view=trash`). Search
  (`GET /api/files/search`) is debounced. Shared drives are not shown, because the server has no API for
  them.
- **Columns:** name with icon or picture, type, location (left out inside My Drive's folders, as in
  Desktop), owner, size, modified, and sharing (Shared, Only you, Shared with you; in Trash, the days left).
  - Click a column heading to sort by it.
  - Drag a column's edge to resize it, or use the arrow keys on the edge. Double-click the edge to reset
    the width.
  - Widths are kept for the session (`sessionStorage` `ws:clouds:cols`).
- **Selection:** click, Ctrl/Cmd-click and Shift-click select, as do the checkboxes. Shortcuts:

  | Key | Action |
  | --- | --- |
  | Enter or double-click | Open |
  | F2 | Rename |
  | Delete | Move to Trash |
  | Shift+F10 or the context-menu key | The row menu |
  | Escape | Clear the selection |

  The right-click menu and the ⋯ button show the same actions.
- **Drag and drop:** drop files from the computer onto the list to upload them to the folder shown, or onto
  a folder row to upload them there. Drag rows onto a folder, onto a breadcrumb or onto My Drive in the rail
  to move them.
- **Performance:**
  - Lists are cached in `localStorage` and drawn straight away, then refreshed.
  - Rows are rendered 100 at a time as the page scrolls. Drive's paged views load the next page in the same
    way.
  - Pictures are asked only for the rows shown (`POST /api/files/office/thumbs`) and cached for four hours.
  - Skeleton rows show while a list loads.
- **States:**
  - not connected;
  - connecting;
  - choosing an organisation;
  - the list;
  - an empty folder, with Upload when the folder accepts files;
  - access denied (403, or a folder that cannot be seen), with a way back to My Drive;
  - offline, which shows the cached list under Desktop's connection warning and offers only Open and
    Details;
  - a server error, as a friendly sentence with Retry. If a cached list exists, it stays visible under a
    banner;
  - session expired.

  Messages never show exception text or addresses with tokens (`friendly()` in `CloudsDrive.jsx`).

## Organisations

The organisation selector is `WorkSuite.setCompany`. Switching organisation clears the selection, the
details drawer and the folder, and reloads.

Every list is cached under one key per account, server, organisation and place (`driveCacheKey` in
`clouds-logic.js`, under the account's own `ws:cache:<account id>:` prefix, which Sign out and Remove clear).
A list fetched for one organisation is therefore never shown for another. Late answers for a place that is
no longer shown are dropped. The chosen organisation is kept with the account, so it stays chosen as you
navigate and between sessions.

## Actions and permissions

Each action is offered only when three things allow it:

- the item's own capabilities, which the server sends with every row (`access.capabilities`, Drive's
  `DriveRules`). These already include the organisation's role permissions, such as `files.download`,
  `files.share` and `files.delete`;
- the server's announced features (`WorkSuite.has`);
- the place (Trash offers only Restore and Delete forever) and the connection (offline and expired allow
  only Open and Details).

The rules are `itemActions`, `commonActions`, `canAddTo` and `canDropOn` in `clouds-logic.js`.

After an action, only the affected rows change (`patchRows`). The list is not reloaded.

| Action | Endpoint | In Clouds |
| --- | --- | --- |
| Browse a folder | `GET /api/files/browse?folder_id=&org_id=` | wired |
| Recent, Shared with me, Starred, Trash | `GET /api/drive/list?view=recent\|shared\|starred\|trash&page=&org_id=` | wired |
| Search | `GET /api/files/search?q=&org_id=` | wired |
| Organisations | `GET /api/drive/sharing/companies` | wired |
| Open (edit in a tab) | `POST /api/auth/apps/handoff`, then `<server>/desktop/office/session#…&next=/editor/<id>` | wired (existing) |
| Rename file / folder | `PUT /api/files/{id}` `{name}` / `PUT /api/folders/{id}` `{name}` | wired |
| Move file / folder | `PUT /api/files/{id}` `{folder_id}` / `POST /api/folders/{id}/move` `{parent_id}` | wired |
| Copy file / folder | `POST /api/files/{id}/copy` / `POST /api/folders/{id}/copy` | wired |
| New folder | `POST /api/folders` `{name, parent_id}` | wired (new client call) |
| New document, spreadsheet, presentation | `POST /api/files/office/new` or `POST /api/files/create` | wired (existing) |
| Upload (with progress) | `POST /api/uploads/init`, `POST /api/uploads/{uuid}/chunk` (multipart, through the app), `POST /api/uploads/{uuid}/complete` (202 while assembling) | wired (new) |
| Download (with progress) | `GET /api/drive/preview/{id}` → `download_url` (signed `/media/<token>?download=1`), saved by the app into Downloads | wired (new) |
| PDF preview | `GET /api/drive/preview/{id}` → `url` (signed `/media/<token>`) | wired (new) |
| Move to Trash file / folder | `DELETE /api/files/{id}` / `DELETE /api/folders/{id}` | wired |
| Restore from Trash | `POST /api/files/{id}/restore` / `POST /api/folders/{id}/restore` | wired |
| Delete forever | `DELETE /api/files/{id}/purge` | wired (new) |
| Star / unstar | `POST /api/drive/star` `{type, id, on}` | wired |
| Share | `GET/POST/PUT/DELETE /api/drive/access/file/{id}…` | wired (existing dialog) |
| Request edit access | `POST /api/drive/access/file/{id}/request-edit` | wired (existing) |
| Details | the row's own fields (`browse` / `list` answers) | wired |
| Activity | `GET /api/drive/activity/{file\|folder}/{id}` | wired (new) |
| Version history | `GET /api/files/{id}/versions`, `POST …/versions/{v}/restore` | wired (existing dialog) |
| Shared drives | none in the Drive API | hidden |
| Trash for folders | `drive/list?view=trash` lists files only | folders that were moved to Trash are not listed (Restore works from the web) |

### Why uploads and downloads go through the app

The start page is a `file://` page. Ordinary requests already go through the app (`AscSimpleRequest`), which
carries JSON text only, and the server's CORS rules do not admit a `file://` origin. Bytes therefore travel
through a new native command, `worksuite:transfer`. It is answered only for the start page, and it checks
every address:

- `chunk` posts one upload part (base64, at most 16 MB) as multipart `chunk` and `chunk_index` to
  `https://<server>/api/uploads/<uuid>/chunk`, with the account's token.
- `download` saves `https://<server>/media/<token>` (optionally `?download=1`) into Downloads, under a free
  name, reporting the bytes received as it goes. `cancel` stops it.
- `reveal` shows a downloaded file. It accepts only a path inside the Downloads folder.

An app without the command makes Upload say that WorkSuite Office needs updating. Nothing is lost: an upload
is a resumable session, keyed by the upload's id (`client_key`).

## Opening and saving back

Double-clicking a DOCX, XLSX, PPTX or PDF (or pressing Enter, or choosing Open) calls `WorkSuite.open`, the
same path as Home:

1. `POST /api/auth/apps/handoff` returns a one-time code for the editor client (PKCE).
2. The app opens `<server>/desktop/office/session#code=…&verifier=…&next=/editor/<id>` in a WorkSuite Office
   editor tab (`open:recent` with `cloud: <server>`). A view-only file adds `mode=VIEW`.
3. The server's editor config points the Document Server at the Drive file. Saves come back to the server's
   callback (`POST /office/onlyoffice/callback` → `DocumentCallbackService` → `DocumentVersionService`,
   EuroOffice module), which writes each save as a new version of the same Drive file. The client never
   uploads a copy, so nothing is duplicated.

Version history and restoring a version are the server's (`/api/files/{id}/versions`). Clouds only shows
them, through the existing Version history dialog.
