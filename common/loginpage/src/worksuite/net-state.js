/*
 * Whether WorkSuite's online services can be reached. navigator.onLine only says a network
 * adapter is up: on a LAN or Wi-Fi with no internet it stays true. So a request that fails
 * for lack of a network marks the app offline, and the next one that gets any answer marks
 * it online again. Requests made while offline fail at once instead of waiting for a timeout.
 */
const listeners = new Set();
let browserOnline = typeof navigator === "undefined" ? true : navigator.onLine !== false;
let reachable = true;

export function isOnline() {
  return browserOnline && reachable;
}

function notify() {
  const v = isOnline();
  listeners.forEach((fn) => fn(v));
}

export function onNetChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* a request got an answer (ok = true) or failed without one (ok = false) */
export function reportNetwork(ok) {
  const before = isOnline();
  reachable = !!ok;
  if (ok) browserOnline = true;
  if (before !== isOnline()) notify();
}

export function setBrowserOnline(v) {
  const before = isOnline();
  browserOnline = !!v;
  if (v) reachable = true;
  if (before !== isOnline()) notify();
}

/* how long to wait for a WorkSuite request before calling the network unreachable */
export const REQUEST_TIMEOUT_MS = 10000;

/* after this long offline, let one request through to see if the network is back */
export const RETRY_AFTER_MS = 15000;
let lastFail = 0;
export function shouldTry(now = Date.now()) {
  if (isOnline()) return true;
  if (!browserOnline) return false;
  return now - lastFail >= RETRY_AFTER_MS;
}
export function noteFailure(now = Date.now()) {
  lastFail = now;
  reportNetwork(false);
}

export const _test = {
  reset() {
    browserOnline = true;
    reachable = true;
    lastFail = 0;
    listeners.clear();
  },
};
