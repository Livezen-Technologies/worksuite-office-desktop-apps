/*
 * Client for the local AI service, worksuite-ai (API v1, "Local service API contracts" in the Local AI
 * spec). The endpoint {port, token} comes from the desktop shell (`ws-ai:endpoint`, see
 * docs/local-ai-bridge.md); every request carries `Authorization: Bearer <token>`.
 *
 * Two calls are not in the v1 contract yet and are tried defensively: cancelling an install
 * (DELETE /v1/jobs/{id}, falling back to DELETE /v1/models/{id}) and the event type names
 * ("job" / "model" / "policy", with "job.progress"-style names accepted too).
 */

export class AiError extends Error {
  constructor(code, message, status, retryable) {
    super(message || code);
    this.code = code;
    this.status = status;
    this.retryable = !!retryable;
  }
}

export function createAiClient(endpoint, deps) {
  const d = deps || {};
  const doFetch = d.fetch || ((...a) => fetch(...a));
  const WS = d.WebSocket || (typeof WebSocket !== "undefined" ? WebSocket : null);
  const base = endpoint.base || `http://127.0.0.1:${endpoint.port}/v1`;
  const auth = { Authorization: "Bearer " + endpoint.token };

  async function call(method, path, body, opts) {
    let res;
    try {
      res = await doFetch(base + path, {
        method,
        headers: body instanceof FormData || body === undefined ? auth : { ...auth, "Content-Type": "application/json" },
        body: body === undefined || body instanceof FormData ? body : JSON.stringify(body),
      });
    } catch (e) {
      throw new AiError("unreachable", String(e && e.message), 0, true);
    }
    if (opts && opts.raw) {
      if (!res.ok) throw await errorOf(res);
      return res;
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (!res.ok) {
      const e = json && json.error;
      throw new AiError((e && e.code) || "internal", e && e.message, res.status, e && e.retryable);
    }
    return json;
  }

  async function errorOf(res) {
    try {
      const e = JSON.parse(await res.text()).error;
      return new AiError(e.code, e.message, res.status, e.retryable);
    } catch {
      return new AiError("internal", "HTTP " + res.status, res.status);
    }
  }

  const q = (params) => {
    const s = Object.entries(params || {}).filter(([, v]) => v).map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&");
    return s ? "?" + s : "";
  };

  return {
    info: () => call("GET", "/info"),
    hardware: () => call("GET", "/hardware"),
    health: () => call("GET", "/health"),
    catalog: (task, lang) => call("GET", "/catalog" + q({ task, lang })),
    models: (task) => call("GET", "/models" + q({ task })),
    install: (id, version) => call("POST", `/models/${encodeURIComponent(id)}/install`, version ? { version } : {}),
    pause: (id) => call("POST", `/models/${encodeURIComponent(id)}/pause`, {}),
    resume: (id) => call("POST", `/models/${encodeURIComponent(id)}/resume`, {}),
    async cancel(id, jobId) {
      if (jobId) {
        try {
          return await call("DELETE", `/jobs/${encodeURIComponent(jobId)}`);
        } catch (e) {
          if (e.status !== 404 && e.status !== 405) throw e;
        }
      }
      return call("DELETE", `/models/${encodeURIComponent(id)}`);
    },
    uninstall: (id) => call("DELETE", `/models/${encodeURIComponent(id)}`),
    activate: (id) => call("POST", `/models/${encodeURIComponent(id)}/activate`, {}),
    deactivate: (id) => call("POST", `/models/${encodeURIComponent(id)}/deactivate`, {}),
    job: (jobId) => call("GET", `/jobs/${encodeURIComponent(jobId)}`),
    setDefaults: (defaults) => call("PUT", "/defaults", defaults),
    importModel(file) {
      const form = new FormData();
      form.append("file", file, file.name);
      return call("POST", "/models/import", form);
    },
    exportModel: (id) => call("GET", `/models/${encodeURIComponent(id)}/export`, undefined, { raw: true }).then((r) => r.blob()),
    moveStorage: (path) => call("POST", "/storage/move", { path }),
    policy: () => call("GET", "/policy"),
    privacy: () => call("GET", "/privacy"),
    setPrivacy: (p) => call("PUT", "/privacy", p),
    clear: (what) => call("POST", "/privacy/clear", { what }),
    diagnostics: () => call("GET", "/diagnostics"),

    /* WS /v1/events; the token goes in the query (a browser WebSocket cannot set headers) */
    events(onEvent, onClose) {
      if (!WS) return () => {};
      const url = base.replace(/^http/, "ws") + "/events?token=" + encodeURIComponent(endpoint.token);
      let ws;
      try {
        ws = new WS(url);
      } catch {
        onClose && onClose();
        return () => {};
      }
      ws.onmessage = (m) => {
        try { onEvent(JSON.parse(m.data)); } catch { /* not an event */ }
      };
      ws.onclose = () => onClose && onClose();
      return () => {
        ws.onclose = null;
        try { ws.close(); } catch { /* already closed */ }
      };
    },
  };
}
