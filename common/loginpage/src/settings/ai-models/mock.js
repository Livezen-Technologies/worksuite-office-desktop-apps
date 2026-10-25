/*
 * An in-memory worksuite-ai (/v1) for the dev server, screenshots and tests — never used in the app.
 * Open the start page with `#/settings/ai-models?aimock=1` (add `&aipolicy=managed`, `&aistate=down`
 * or `&aistate=installing` for the other states).
 */

export const MOCK_HARDWARE = {
  os: "windows", arch: "x64", cpu: { model: "Intel Core i7-1265U", cores: 10 },
  ramMB: 16384, freeRamMB: 9200, gpus: [{ name: "Intel Iris Xe", vramMB: 2048, backend: "vulkan" }],
  appleSilicon: false, recommendedProfile: "standard",
};

export const MOCK_CATALOG = [
  { id: "whisper-small-q5", name: "Whisper small", version: "1.0.0", tasks: ["stt"], languages: ["en", "si"], sizeMB: 182, ramMB: 600, backends: ["cpu", "cuda", "vulkan"], license: "MIT", fits: "yes", approved: true, evaluated: { si: { wer: 0.31 } } },
  { id: "whisper-base-en", name: "Whisper base (English)", version: "1.1.0", tasks: ["stt"], languages: ["en"], sizeMB: 75, ramMB: 300, backends: ["cpu"], license: "MIT", fits: "yes", approved: true },
  { id: "qwen2.5-3b-q4", name: "Qwen 2.5 3B", version: "2.0.0", tasks: ["correction", "suggestions", "assistant"], languages: ["en", "si", "ta"], sizeMB: 1930, ramMB: 3400, backends: ["cpu", "cuda", "metal", "vulkan"], license: "Qwen Research", fits: "yes", approved: true, evaluated: { si: { accuracy: 0.74 } } },
  { id: "qwen2.5-14b-q4", name: "Qwen 2.5 14B", version: "2.0.0", tasks: ["assistant", "correction"], languages: ["en", "si", "ta"], sizeMB: 8990, ramMB: 12800, backends: ["cuda", "metal"], license: "Apache-2.0", fits: "tight", approved: true },
  { id: "llama3.1-70b-q4", name: "Llama 3.1 70B", version: "1.0.0", tasks: ["assistant"], languages: ["en"], sizeMB: 40500, ramMB: 48000, backends: ["cuda", "metal"], license: "Llama 3.1 Community", fits: "no", approved: false },
  { id: "indictrans2-en-indic", name: "IndicTrans2 (en ↔ si, ta)", version: "1.0.0", tasks: ["translation"], languages: ["en", "si", "ta"], sizeMB: 1100, ramMB: 1800, backends: ["cpu"], license: "MIT", fits: "yes", approved: true },
  { id: "piper-en-amy", name: "Piper voice: Amy (English)", version: "1.0.0", tasks: ["tts"], languages: ["en"], sizeMB: 63, ramMB: 150, backends: ["cpu"], license: "MIT", fits: "yes", approved: true },
];

export function mockState(opts) {
  const o = opts || {};
  const installed = [
    { id: "whisper-base-en", version: "1.0.0", tasks: ["stt"], state: "active", sizeMB: 75, path: "C:/Users/nimali/AppData/Roaming/WorkSuite/ai/models/whisper-base-en/1.0.0", isDefaultFor: ["stt"], lastUsed: "2026-10-24T09:12:00Z" },
    { id: "piper-en-amy", version: "1.0.0", tasks: ["tts"], state: "installed", sizeMB: 63, path: "C:/Users/nimali/AppData/Roaming/WorkSuite/ai/models/piper-en-amy/1.0.0", isDefaultFor: ["tts"], lastUsed: null },
  ];
  const policy = o.policy === "managed"
    ? { managed: true, features: { stt: true, suggestions: false, correction: true, translate: true, tts: true, assistant: true }, cloudAllowed: false, approvedModels: ["whisper-small-q5", "whisper-base-en", "qwen2.5-3b-q4", "piper-en-amy", "indictrans2-en-indic"], maxMemMB: 8192, gpuAllowed: false, orgDictionaryUrl: "https://office.livezen.lk/api/dictionaries/org" }
    : { managed: false, features: {}, cloudAllowed: true, approvedModels: [], maxMemMB: 0, gpuAllowed: true, orgDictionaryUrl: "" };
  return { installed, policy, privacy: { learning: false, keepRecordings: false }, jobs: {}, listeners: new Set(), seq: 1, tick: o.tick ?? 400 };
}

/* fetch(url, init) and a WebSocket class bound to one mock state */
export function createMockService(opts) {
  const st = mockState(opts);
  const emit = (ev) => st.listeners.forEach((l) => l(ev));
  const json = (status, body) => ({ ok: status < 400, status, text: async () => (body === undefined ? "" : JSON.stringify(body)), blob: async () => new Blob([JSON.stringify(body || {})]) });
  const err = (status, code, message) => json(status, { error: { code, message, retryable: false } });

  function runJob(job) {
    const step = () => {
      if (job.state === "paused" || job.state === "cancelled") return;
      if (job.phase === "downloading") {
        job.bytesDone = Math.min(job.bytesTotal, job.bytesDone + job.bytesTotal * 0.07);
        if (job.bytesDone >= job.bytesTotal) job.phase = "verifying";
      } else if (job.phase === "verifying") job.phase = "unpacking";
      else if (job.phase === "unpacking") {
        job.phase = "ready";
        job.state = "done";
        const c = MOCK_CATALOG.find((m) => m.id === job.modelId);
        st.installed = st.installed.filter((m) => m.id !== c.id).concat([{ id: c.id, version: c.version, tasks: c.tasks, state: "installed", sizeMB: c.sizeMB, path: "C:/Users/nimali/AppData/Roaming/WorkSuite/ai/models/" + c.id + "/" + c.version, isDefaultFor: [], lastUsed: null }]);
      }
      emit({ type: "job", jobId: job.id, data: { modelId: job.modelId, state: job.state, phase: job.phase, bytesDone: job.bytesDone, bytesTotal: job.bytesTotal } });
      if (job.state === "running" && st.tick > 0) job.timer = setTimeout(step, st.tick);
    };
    job.timer = setTimeout(step, st.tick);
  }

  function startInstall(id, frozenAt) {
    const c = MOCK_CATALOG.find((m) => m.id === id);
    const job = { id: "job-" + st.seq++, modelId: id, state: "running", phase: "downloading", bytesTotal: c.sizeMB * 1048576, bytesDone: 0 };
    st.jobs[job.id] = job;
    if (frozenAt != null) job.bytesDone = job.bytesTotal * frozenAt;
    else runJob(job);
    return job;
  }

  if (opts && opts.state === "installing") startInstall("qwen2.5-3b-q4", 0.42);

  async function fetchMock(url, init) {
    if (opts && opts.state === "down") throw new TypeError("Failed to fetch");
    const u = new URL(url);
    const path = u.pathname.replace(/^\/v1/, "");
    const method = (init && init.method) || "GET";
    const body = init && typeof init.body === "string" ? JSON.parse(init.body) : {};
    let m;
    if (path === "/info") return json(200, { apiVersion: "1.3", serviceVersion: "0.1.0", capabilities: ["speech.stt", "text.complete", "text.check", "text.transform", "translate", "tts", "assistant"], profile: "standard" });
    if (path === "/hardware") return json(200, MOCK_HARDWARE);
    if (path === "/health") return json(200, { ok: true, loadedModels: [{ id: "whisper-base-en", task: "stt", memMB: 290 }], queueDepth: 0 });
    if (path === "/catalog") {
      const approved = st.policy.approvedModels;
      return json(200, MOCK_CATALOG.map((c) => ({ ...c, approved: c.approved && (!approved.length || approved.includes(c.id)) })));
    }
    if (path === "/models") return json(200, st.installed);
    if ((m = /^\/models\/([^/]+)\/install$/.exec(path))) {
      if (st.policy.approvedModels.length && !st.policy.approvedModels.includes(m[1])) return err(403, "forbidden_by_policy", "Not approved");
      return json(202, { jobId: startInstall(m[1]).id });
    }
    if ((m = /^\/models\/([^/]+)\/(pause|resume)$/.exec(path))) {
      const job = Object.values(st.jobs).find((j) => j.modelId === m[1] && j.state !== "done" && j.state !== "cancelled");
      if (!job) return err(404, "not_found");
      clearTimeout(job.timer);
      job.state = m[2] === "pause" ? "paused" : "running";
      emit({ type: "job", jobId: job.id, data: { modelId: job.modelId, state: job.state, phase: job.phase, bytesDone: job.bytesDone, bytesTotal: job.bytesTotal } });
      if (job.state === "running") runJob(job);
      return json(200, {});
    }
    if ((m = /^\/jobs\/([^/]+)$/.exec(path))) {
      const job = st.jobs[m[1]];
      if (!job) return err(404, "not_found");
      if (method === "DELETE") {
        clearTimeout(job.timer);
        job.state = "cancelled";
        emit({ type: "job", jobId: job.id, data: { modelId: job.modelId, state: "cancelled" } });
        return json(200, {});
      }
      return json(200, { state: job.state, progress: job.bytesTotal ? job.bytesDone / job.bytesTotal : 0, phase: job.phase, modelId: job.modelId });
    }
    if ((m = /^\/models\/([^/]+)\/(activate|deactivate)$/.exec(path))) {
      st.installed = st.installed.map((x) => (x.id === m[1] ? { ...x, state: m[2] === "activate" ? "active" : "installed" } : x));
      emit({ type: "model", data: { id: m[1], state: m[2] === "activate" ? "active" : "installed" } });
      return json(200, {});
    }
    if ((m = /^\/models\/([^/]+)\/export$/.exec(path))) return json(200, { id: m[1] });
    if ((m = /^\/models\/([^/]+)$/.exec(path)) && method === "DELETE") {
      st.installed = st.installed.filter((x) => x.id !== m[1]);
      return json(200, {});
    }
    if (path === "/models/import") return json(202, { jobId: "job-" + st.seq++ });
    if (path === "/defaults") {
      st.installed = st.installed.map((x) => ({ ...x, isDefaultFor: Object.keys(body).filter((k) => body[k] === x.id) }));
      return json(200, body);
    }
    if (path === "/storage/move") return json(202, { jobId: "job-" + st.seq++ });
    if (path === "/policy") return json(200, st.policy);
    if (path === "/privacy") {
      if (method === "PUT") st.privacy = { ...st.privacy, ...body };
      return json(200, st.privacy);
    }
    if (path === "/privacy/clear") return json(200, {});
    if (path === "/diagnostics") return json(200, { serviceVersion: "0.1.0", errors: [{ code: "busy", at: "2026-10-24T09:10:02Z", ms: 12 }], timings: { sttFirstPartialMs: 820 } });
    return err(404, "not_found");
  }

  class MockSocket {
    constructor() {
      this.listener = (ev) => this.onmessage && this.onmessage({ data: JSON.stringify(ev) });
      st.listeners.add(this.listener);
    }
    close() {
      st.listeners.delete(this.listener);
    }
  }

  return { fetch: fetchMock, WebSocket: MockSocket, state: st, endpoint: { ok: true, port: 47613, token: "mock", apiVersion: "1", base: "http://127.0.0.1:47613/v1", launched: false } };
}
