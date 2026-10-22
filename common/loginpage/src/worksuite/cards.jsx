import { Show } from "solid-js";
import { L } from "./lang.js";

export const hostOf = (server) => String(server || "").replace(/^https?:\/\//, "");

/* "19:40" today, "12 Oct 2026" otherwise */
export function when(value) {
  if (!value) return "";
  const d = new Date(String(value).replace(" ", "T"));
  if (isNaN(d.getTime())) return String(value);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}

export function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0] || "?")[0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/* "Continue as <name>": one account, as a card */
export function ContinueCard(props) {
  return (
    <button class="ws-account-card" classList={{ "is-primary": props.primary }} title={props.via || undefined}
            disabled={props.disabled} onClick={props.onClick}>
      <span class="ws-avatar" aria-hidden="true">{initials(props.name)}</span>
      <span class="ws-card-text">
        <span class="ws-continue-name">{L.wsContinueAs.replace("$1", props.name)}</span>
        <span class="ws-continue-org">{props.org}</span>
        <Show when={props.via}><span class="ws-continue-via">{props.via}</span></Show>
      </span>
      <svg class="ws-chevron" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
  );
}

