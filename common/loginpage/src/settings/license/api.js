/*
 * Client for the local AI service's license endpoints (worksuite-ai, ai-service/src/server.ts):
 *   GET  /v1/license            → status (see logic.js for the shape)
 *   POST /v1/license/activate   { key } → status
 *   POST /v1/license/refresh    → status (forces an online re-check)
 *   POST /v1/license/deactivate → status (clears the stored license)
 * The endpoint {port, token} comes from the desktop shell via ws-ai:endpoint (../ai-models/endpoint.js);
 * every request carries Authorization: Bearer <token>. Mirrors ../ai-models/api.js.
 */

export class LicenseError extends Error {
  constructor(code, message, status) {
    super(message || code);
    this.code = code;
    this.status = status;
  }
}

export function createLicenseClient(endpoint, deps) {
  const d = deps || {};
  const doFetch = d.fetch || ((...a) => fetch(...a));
  const base = endpoint.base || `http://127.0.0.1:${endpoint.port}/v1`;
  const auth = { Authorization: "Bearer " + endpoint.token };

  async function call(method, path, body) {
    let res;
    try {
      res = await doFetch(base + path, {
        method,
        headers: body === undefined ? auth : { ...auth, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new LicenseError("unreachable", String(e && e.message), 0);
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (!res.ok) {
      const e = json && json.error;
      throw new LicenseError((e && e.code) || "internal", e && e.message, res.status);
    }
    return json;
  }

  return {
    get: () => call("GET", "/license"),
    activate: (key) => call("POST", "/license/activate", { key }),
    refresh: () => call("POST", "/license/refresh"),
    deactivate: () => call("POST", "/license/deactivate"),
  };
}
