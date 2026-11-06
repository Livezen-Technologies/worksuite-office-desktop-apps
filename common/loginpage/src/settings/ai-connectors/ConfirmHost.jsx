/*
 * The confirmation an AI agent's action waits for (service.js confirm()): an MCP tool call, a change to
 * a document or reading a file. Mounted once in the shell (app.jsx), so it shows wherever the person is.
 */
import { Show, createSignal } from "solid-js";
import { Frame } from "@/worksuite/dialogs.jsx";
import { answer, installAgentApi, state } from "./service.js";
import { previewArgs } from "./logic.js";
import { S } from "./strings.js";
import "@/worksuite/worksuite.css";
import "./connectors.css";

export default function ConfirmHost() {
  installAgentApi();
  const [always, setAlways] = createSignal(false);
  const p = () => state.pending;
  const done = (allowed) => {
    const a = always();
    setAlways(false);
    answer(allowed, a);
  };
  const agent = () => (p() && p().agent) || S.anAgent;
  return (
    <Show when={p()}>
      <Frame title={S.confirmTitle} onClose={() => done(false)}>
        <div class="aic-confirm aic-scope" role="alertdialog" aria-live="assertive">
          <Show when={p().kind === "tool"}>
            <p class="aic-confirm-text">
              {p().agent ? S.fmt("confirmTool", agent(), p().tool, p().server) : S.fmt("confirmToolNamed", p().tool, p().server)}
            </p>
            <Show when={p().destructive}>
              <p class="aic-warn">{S.confirmDestructive}</p>
            </Show>
            <p class="aic-muted">{S.confirmArgs}</p>
            <pre class="aic-pre">{previewArgs(p().args)}</pre>
            <label class="aic-check">
              <input type="checkbox" checked={always()} onChange={(e) => setAlways(e.currentTarget.checked)} />
              <span>{S.alwaysAllow}</span>
            </label>
          </Show>
          <Show when={p().kind === "modify-document"}>
            <p class="aic-confirm-text">{S.fmt("confirmDocument", agent(), p().target)}</p>
          </Show>
          <Show when={p().kind === "read-file"}>
            <p class="aic-confirm-text">{S.fmt("confirmFile", agent(), p().target)}</p>
          </Show>
          <div class="aim-actions aic-end">
            <button type="button" class="aim-btn" onClick={() => done(false)}>{S.deny}</button>
            <button type="button" class="aim-btn aim-btn-primary" onClick={() => done(true)}>{S.allow}</button>
          </div>
        </div>
      </Frame>
    </Show>
  );
}
