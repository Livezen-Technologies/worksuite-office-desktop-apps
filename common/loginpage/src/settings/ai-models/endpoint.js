/*
 * Where the local AI service listens, from the desktop shell: `ws-ai:endpoint` (docs/local-ai-bridge.md).
 *   page → native  execCommand("ws-ai:endpoint", {"req":"…","start":true|false})
 *   native → page  on_native_message("ws-ai:endpoint", {"req","ok",port,token,apiVersion,base,pid,launched,policy}
 *                                                    | {"req","ok":false,"reason","policy"})
 * start:false only reports (no launch); start:true launches worksuite-ai when it is not running.
 *
 * Outside the desktop (dev server, screenshots) `window.__wsAiEndpoint` may provide the same answer.
 */

let seq = 0;

export function requestEndpoint(start, timeoutMs) {
  const override = typeof window !== "undefined" && window.__wsAiEndpoint;
  if (override) return Promise.resolve(typeof override === "function" ? override(start) : override);

  const sdk = typeof window !== "undefined" && window.AscDesktopEditor;
  if (!sdk || !sdk.execCommand || !sdk.on) return Promise.resolve({ ok: false, reason: "no-desktop" });

  const req = "ai-" + Date.now().toString(36) + "-" + ++seq;
  return new Promise((resolve) => {
    const done = (answer) => {
      clearTimeout(timer);
      sdk.remove && sdk.remove("on_native_message", listener);
      resolve(answer);
    };
    const listener = (cmd, param) => {
      if (cmd !== "ws-ai:endpoint") return;
      let r = null;
      try { r = JSON.parse(param); } catch { return; }
      if (r && r.req === req) done(r);
    };
    const timer = setTimeout(() => done({ ok: false, reason: "timeout" }), timeoutMs || (start ? 20000 : 4000));
    sdk.on("on_native_message", listener);
    sdk.execCommand("ws-ai:endpoint", JSON.stringify({ req, start: !!start }));
  });
}
