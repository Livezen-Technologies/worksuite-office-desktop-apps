/*
 * The desktop side of Settings › AI & MCP Connectors: "ws-mcp" (win-linux/src/cworksuitemcp.h).
 *   page → native  execCommand("ws-mcp", {"op","req",…})
 *   native → page  on_native_message("ws-mcp", {"req",…} | {"op":"stdout|stderr|exit","id",…})
 * Outside the desktop (dev server, tests) `window.__wsMcpNative` may stand in: {call(msg) → Promise, on(fn) → off}.
 */

let seq = 0;

export function createNative(win) {
  const w = win || (typeof window !== "undefined" ? window : {});
  if (w.__wsMcpNative) return w.__wsMcpNative;
  const sdk = w.AscDesktopEditor;
  if (!sdk || !sdk.execCommand || !sdk.on) return null;

  const pending = new Map();
  const listeners = new Set();
  sdk.on("on_native_message", (cmd, param) => {
    if (cmd !== "ws-mcp") return;
    let m;
    try { m = JSON.parse(param); } catch { return; }
    if (!m) return;
    if (m.op) {
      for (const fn of listeners) fn(m);
      return;
    }
    const p = pending.get(m.req);
    if (p) {
      pending.delete(m.req);
      clearTimeout(p.timer);
      p.resolve(m);
    }
  });

  return {
    available: true,
    call(msg, timeoutMs) {
      const req = "mcp-" + Date.now().toString(36) + "-" + ++seq;
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(req);
          resolve({ req, ok: false, error: "timeout" });
        }, timeoutMs ? timeoutMs + 2000 : 35000);
        pending.set(req, { resolve, timer });
        sdk.execCommand("ws-mcp", JSON.stringify({ ...msg, req }));
      });
    },
    /* fire and forget (kill) */
    post(msg) {
      sdk.execCommand("ws-mcp", JSON.stringify({ ...msg, req: "" }));
    },
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
