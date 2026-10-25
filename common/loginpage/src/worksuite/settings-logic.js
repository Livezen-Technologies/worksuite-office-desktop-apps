/*
 * Pure helpers of the WorkSuite settings screen and the WorkSuite Drive connect card (no DOM, no Solid):
 * server address checks, account status, the update phase from the native events, account filtering.
 */

/* "app.worksuite.lk", "https://app.worksuite.lk", "https://app.worksuite.lk:8443/" → ok; http:// and junk → an error key */
export function validateServer(input) {
  const s = String(input || "").trim();
  if (!s) return { ok: true, empty: true, value: "" };
  if (/^http:\/\//i.test(s)) return { ok: false, error: "https" };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && !/^https:\/\//i.test(s)) return { ok: false, error: "https" };
  const rest = s.replace(/^https:\/\//i, "").replace(/\/+$/, "");
  const m = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*|\[[0-9a-f:]+\])(?::(\d{1,5}))?$/i.exec(rest);
  if (!m) return { ok: false, error: "format" };
  if (m[2] && (Number(m[2]) < 1 || Number(m[2]) > 65535)) return { ok: false, error: "format" };
  const host = m[1].toLowerCase();
  if (!host.includes(".") && host !== "localhost" && !host.startsWith("[")) return { ok: false, error: "format" };
  return { ok: true, value: "https://" + host + (m[2] ? ":" + m[2] : "") };
}

/*
 * A known account's status. Signing out removes an account (WorkSuite.signOut), so a listed account
 * marked signedOut is one whose session ended by itself (refresh refused, 401): "expired".
 */
export function accountStatus(account, unreachable) {
  if (!account) return "none";
  if (account.desktopOnly) return "desktop";
  if (account.signedOut) return account.signedOutBy === "user" ? "signed-out" : "expired";
  return unreachable ? "unreachable" : "signed-in";
}

/* What a card offers, by status: the inline action and the menu (Switch to, Sign out, Remove) */
export function accountActions(account, opts) {
  opts = opts || {};
  const status = accountStatus(account, opts.unreachable);
  const primary = { desktop: "connect", "signed-out": "signin", expired: "reconnect", unreachable: "reconnect" }[status] || null;
  const menu = [];
  if (status === "signed-in" && !opts.isDefault && opts.multiple) menu.push("switch");
  if (status === "signed-in" || status === "unreachable") menu.push("signout");
  if (status !== "desktop") menu.push("remove");
  return { status, primary, menu };
}

/*
 * What the Updates card shows, from:
 *   u        "worksuite:updates" state {available, version, channel, auto, lastCheck, busy, text,
 *            found: {version, size}, download: the app downloads it itself on Download}
 *   ready    "worksuite:update-ready" {version, notes, dismissed}
 *   legacy   "updates:status" of the Windows/Linux update service {icon: load|success|error|lastcheck, text, button:{action,lock}}
 *   progress "worksuite:update-progress" {state: found|downloading|verifying|extracting|installing|ready|error|idle,
 *            received, total, version, cancellable, reason} (Sparkle on macOS, the app's own download on Windows)
 * → {phase: unavailable|ready|downloading|available|checking|error|uptodate, percent, received, total, stage,
 *    cancellable, text, reason, action, version, size}
 */
export function updatePhase(u, ready, legacy, progress) {
  u = u || {};
  const pr = progress && progress.state && progress.state !== "idle" ? progress : null;
  if (u.available === false && !(ready && ready.version) && !pr) return { phase: "unavailable" };
  if (ready && ready.version) return { phase: "ready", version: ready.version };
  if (pr && pr.state === "ready") return { phase: "ready", version: pr.version || "" };
  if (pr && ["downloading", "verifying", "extracting", "installing"].includes(pr.state)) {
    const received = Math.max(0, Number(pr.received) || 0);
    const total = Math.max(0, Number(pr.total) || 0);
    let percent = total ? Math.min(100, Math.floor((received * 100) / total)) : null;
    if (pr.state === "verifying") percent = 100;
    if (pr.state === "installing") percent = null;
    return {
      phase: "downloading", stage: pr.state, percent, version: pr.version || "",
      received: pr.state === "downloading" || pr.state === "verifying" ? received : 0,
      total: pr.state === "downloading" || pr.state === "verifying" ? total : 0,
      cancellable: pr.state === "downloading" && !!pr.cancellable,
    };
  }
  if (pr && pr.state === "error") return { phase: "error", reason: pr.reason || "failed" };
  const action = legacy && legacy.button && legacy.button.action;
  if (legacy && legacy.icon === "success" && action === "install") return { phase: "ready", version: "" };
  if (legacy && (action === "abort" || (legacy.icon === "load" && /%/.test(legacy.text || "")))) {
    const m = /(\d{1,3})\s*%/.exec(legacy.text || "");
    return { phase: "downloading", stage: "downloading", percent: m ? Math.min(100, Number(m[1])) : null, text: legacy.text || "", action, cancellable: action === "abort" };
  }
  if (legacy && legacy.icon === "error") return { phase: "error", text: legacy.text || "" };
  if (legacy && action === "download") return { phase: "available", text: legacy.text || "", action };
  if (u.busy || (legacy && legacy.icon === "load")) return { phase: "checking" };
  const found = (pr && pr.state === "found" && pr.version ? { version: pr.version, size: pr.total } : null) || u.found;
  if (found && found.version) {
    return { phase: "available", version: found.version, size: Number(found.size) || 0, action: u.download ? "ws-download" : undefined };
  }
  if (u.text) return { phase: "available", text: u.text };
  return { phase: "uptodate" };
}

/* the error text's kind: a file refused by the checks (deleted, never run) or a download that did not finish */
export function updateErrorKind(reason) {
  if (["unsigned", "signature", "length", "insecure"].includes(reason)) return "refused";
  return reason ? "failed" : "";
}

/* 1536 → "1.5 KB", 262144000 → "250 MB" (decimal-free above 100) */
export function formatBytes(n) {
  n = Math.max(0, Number(n) || 0);
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  const text = i === 0 || n >= 100 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, "");
  return text + " " + units[i];
}

/* The accounts known on this device: the start page's, then WorkSuite Desktop's that are not signed in here */
export function mergeAccounts(local, desktop) {
  const list = (local || []).map((a) => ({ ...a }));
  (desktop || []).forEach((d) => {
    const id = d.server + "|" + d.user.id;
    const here = list.find((a) => a.id === id);
    if (here) {
      if (here.signedOut) here.desktop = d;
    } else list.push({ id, server: d.server, user: d.user, desktopOnly: true, desktop: d });
  });
  return list;
}

export function filterAccounts(list, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return list;
  return list.filter((a) =>
    [a.user && a.user.name, a.user && a.user.email, a.user && a.user.organization, a.server].some((v) => String(v || "").toLowerCase().includes(q)),
  );
}

/* The settings sub-navigation's sections, in order; "general" links out to Settings › General */
export const SETTINGS_SECTIONS = ["general", "accounts", "drive", "updates", "advanced", "about"];

/* next index for arrow keys / Home / End in a radiogroup or listbox (wraps) */
export function nextIndex(key, i, n) {
  if (!n) return -1;
  if (key === "ArrowRight" || key === "ArrowDown") return (i + 1) % n;
  if (key === "ArrowLeft" || key === "ArrowUp") return (i - 1 + n) % n;
  if (key === "Home") return 0;
  if (key === "End") return n - 1;
  return i;
}
