# WorkSuite Office: Local AI bridge (desktop shell ↔ worksuite-ai)

The local AI service, `worksuite-ai`, is one per-user process that owns every model. Apps never load
models; they call its `/v1` API on `127.0.0.1` (the "Local service API contracts" in the Local AI spec).
This page is the desktop shell's part: how the app starts the service, how pages and editor plugins get
its address and token, microphone access, and what happens on exit.

## Where things are

| What | Where |
| ---- | ----- |
| Service binary | Next to the app binary: `worksuite-ai.exe` (Windows, install folder), `worksuite-ai` (Linux, install folder), `WorkSuite Office.app/Contents/MacOS/worksuite-ai` (macOS, `pathForAuxiliaryExecutable:`). Packaging must put it there. |
| Discovery file | `~/.worksuite/ai/endpoint.json` (`%USERPROFILE%\.worksuite\ai\endpoint.json` on Windows): `{"port", "token", "pid", "apiVersion"}`, written by the service, `0600` / user-only ACL. |
| Start page code | `common/loginpage/src/settings/ai-models/endpoint.js` |
| Windows / Linux | `win-linux/src/cworksuiteai.{h,cpp}`, handled in `cascapplicationmanagerwrapper.cpp` |
| macOS | `ASCCommonViewController.mm` (`onWorkSuiteAiEndpoint:`, `workSuiteAiPolicy`, `onWorkSuiteAiTerminate:`), forwarded by `ASCEventsController.mm` |

## `ws-ai:endpoint`

A desktop command, sent with `AscDesktopEditor.execCommand`. The answer comes back as a native message
with the same name, to the view that asked.

```js
// request
window.AscDesktopEditor.execCommand("ws-ai:endpoint", JSON.stringify({ req: "my-unique-id", start: true }));

// answer: window.on_native_message("ws-ai:endpoint", json)
{ "req": "my-unique-id", "ok": true,
  "port": 47613, "token": "…", "pid": 12345, "apiVersion": "1",
  "base": "http://127.0.0.1:47613/v1",
  "launched": true,                       // this app process started the service
  "policy": { …AI managed configuration, GET /v1/policy shape… } }

{ "req": "my-unique-id", "ok": false,
  "reason": "disabled-by-policy" | "not-running" | "not-installed" | "start-failed" | "timeout",
  "policy": { … } }
```

| Field | Meaning |
| ----- | ------- |
| `req` | Echoed (first 64 characters). Use a unique id: several answers can be in flight and every listener sees every answer. |
| `start` | `false` (default): only report. `true`: when there is no live service (no `endpoint.json`, or its `pid` is gone), start the binary and answer once `endpoint.json` names a live pid, at most 20 s later. Concurrent `start:true` requests share one launch. |
| `reason` | `disabled-by-policy`: managed configuration `aiFunctions` is `off`. `not-running`: no live service and `start` was false. `not-installed`: no binary next to the app. `start-failed`: it could not be started, or exited before writing its endpoint. `timeout`: still no endpoint after 20 s. |
| `policy` | The AI keys of the managed configuration (below), so a page can lock controls even when the service is not running. The service's own `GET /v1/policy` is authoritative when it runs. |

**Who is answered:** the start page and editor tabs (`cvwtEditor`). Other views (portal pages, web
tabs) get no answer. In an editor tab the answer goes to the `frameEditor` frame (as for every
`sendCommandTo` to an editor), i.e. `window.on_native_message` of the editor's frame.

### From an editor plugin (`asc.ws-ai`)

A plugin iframe is inside `frameEditor` and the editor already owns `window.on_native_message` there,
so chain it instead of replacing it:

```js
function wsAiEndpoint(start) {
  const host = window.parent;                       // frameEditor (same origin in the desktop app)
  const req = "ws-ai-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  return new Promise((resolve) => {
    const previous = host.on_native_message;
    const timer = setTimeout(() => done({ ok: false, reason: "timeout" }), start ? 25000 : 4000);
    function done(answer) {
      clearTimeout(timer);
      if (host.on_native_message === listener) host.on_native_message = previous;
      resolve(answer);
    }
    function listener(cmd, param) {
      if (cmd === "ws-ai:endpoint") {
        try { const a = JSON.parse(param); if (a.req === req) return done(a); } catch (e) {}
      }
      return previous && previous.apply(this, arguments);
    }
    host.on_native_message = listener;
    (window.AscDesktopEditor || host.AscDesktopEditor).execCommand("ws-ai:endpoint", JSON.stringify({ req, start: !!start }));
  });
}
```

Then call the service with `Authorization: Bearer <token>` at `base`. Keep the token in memory only.
If a request fails with a connection error, ask again with `start:true` (the service exits after 30
minutes idle; the app restarts it).

Not verified yet on a real build: that `window.AscDesktopEditor` exists inside a plugin iframe (it
does in the editors' own frames) and that the editor's `on_native_message` handler tolerates
chaining. Fallback if not: send from the plugin through the editor's `window.parent`.

### From the start page

`requestEndpoint(start)` in `src/settings/ai-models/endpoint.js` does the same through the start page's
`sdk.on("on_native_message")` pub/sub.

## Lifetime

* **Start on demand:** only on `start:true`. Settings › AI Models asks without starting and offers
  **Start AI service**; an editor plugin may start it when the person uses a feature.
* **Detached:** the service is started detached (`QProcess::startDetached`, `NSTask`), working directory
  the home folder, no arguments. It outlives app windows; it exits by itself after 30 min idle.
* **Respawn:** a stale `endpoint.json` (pid gone) counts as not running; the next `start:true` starts a
  new service, which overwrites the file.
* **Stop on exit:** when the app quits (`aboutToQuit` on Windows/Linux, `NSApplicationWillTerminateNotification`
  on macOS) and *this app process* started the service, the app asks `GET /v1/health` (1.5 s limit,
  `Origin: worksuite://office`); with `queueDepth: 0` it stops the process (`SIGTERM`; `TerminateProcess`
  on Windows). A service someone else started, or one with queued work (a download), is left running.

## Microphone

Voice typing (W3) runs `getUserMedia` in the editor plugin, in CEF.

| Platform | What the app does | Status |
| -------- | ----------------- | ------ |
| macOS | `NSMicrophoneUsageDescription` in the three `Info.plist`s (the OS prompt's text); `com.apple.security.device.audio-input` in the three entitlements (required under the hardened runtime); `--enable-media-stream` added to CEF's argv in `main.mm` | in this repo |
| Linux | `--enable-media-stream` added to CEF's argv in `win-linux/src/main.cpp` | in this repo |
| Windows | CEF builds its command line from `GetCommandLineW()`, not `argv`, so the app cannot add the switch | **needs desktop-sdk** (below) |

The switch is left out when the managed configuration turns AI off (`aiFunctions: off`) or speech to
text off (`aiSpeechToText: false`).

`--enable-media-stream` allows media capture for every frame, not only the plugin. The narrower fix,
also for Windows, belongs in desktop-sdk (`ChromiumBasedEditors/lib/src/cefview.cpp`, the client's
permission handler): accept `CEF_PERMISSION_TYPE_MIC_STREAM` in `OnShowPermissionPrompt`, or implement
`OnRequestMediaAccessPermission` granting `CEF_MEDIA_PERMISSION_DEVICE_AUDIO_CAPTURE` only, and only when
`requesting_origin` is `file://` or `ascdesktop://` (the bundled `sdkjs-plugins`). Until desktop-sdk has
that, Windows also needs `command_line->AppendSwitch("--enable-media-stream")` in
`CAscClientAppBrowser::OnBeforeCommandLineProcessing` (`cefwrapper/client_app.h`).

## Managed configuration

The AI keys are listed in [managed-configuration.md](managed-configuration.md#local-ai). The app reads
them for `policy` in the answer above and for the microphone switch; the service reads the same keys
from the same places and serves them at `GET /v1/policy`.

## What the start page assumes about the service (to align with worksuite-ai)

These are not spelled out in the v1 contract; the page handles both the listed and the obvious
alternative shapes:

* `WS /v1/events` authentication: a browser WebSocket cannot set `Authorization`, so the page sends
  the token as `?token=`.
* Event types: `job` (or `job.*`) with `data: {modelId, state, phase, progress|bytesDone+bytesTotal, error}`,
  `model` (or `model.*`) with `data: {id, state}`, `policy` (or `policy.*`).
* Cancelling an install: `DELETE /v1/jobs/{jobId}`; on 404/405 the page falls back to
  `DELETE /v1/models/{id}`.
* There is no `GET /v1/defaults` or `GET /v1/storage`: defaults come from `isDefaultFor` in
  `GET /v1/models`, the storage folder from the models' `path`, used space from their `sizeMB`.
* **Offline only** is kept by the page (and moves every `cloud` default to `auto`); the service enforces
  cloud through `allowCloud` per request and `cloudAllowed` in policy.
