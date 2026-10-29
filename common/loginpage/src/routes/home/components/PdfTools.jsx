import { For } from "solid-js";
import { command } from "@/sdk/bridge.js";
import { showToast } from "@/components/toast/toastutil";
import { L } from "@/worksuite/lang.js";
import { Icon } from "@/worksuite/ui/components.jsx";
import { PDF_TOOLS, startPdfTool } from "@/worksuite/pdf-tools.js";

/* Merge, Split and Extract pages: each opens a PDF in the PDF editor, which then asks what to do (src/worksuite/pdf-tools.js) */
export function runPdfTool(action) {
  const ok = startPdfTool(action, { storage: window.localStorage, now: Date.now, command });
  showToast(ok ? L.wshPdfToolChoose : L.wshPdfToolFailed, 4000);
}

export function PdfTools() {
  return (
    <section class="wsh-create wsh-pdftools" aria-labelledby="wsh-pdftools-title">
      <h2 class="wsh-eyebrow" id="wsh-pdftools-title">{L.wshPdfTools}</h2>
      <div class="wsh-create-grid" role="list">
        <For each={PDF_TOOLS}>
          {(tool) => (
            <div role="listitem">
              <button type="button" class={"wsh-create-card wsh-pdftool-" + tool.action} title={L[tool.hint]} onClick={() => runPdfTool(tool.action)}>
                <span class="wsh-create-tile" aria-hidden="true"><Icon name={tool.icon} /></span>
                <span class="wsh-create-text">
                  <span class="wsh-create-name">{L[tool.label]}</span>
                  <span class="wsh-create-ext">{L[tool.hint]}</span>
                </span>
              </button>
            </div>
          )}
        </For>
      </div>
    </section>
  );
}
