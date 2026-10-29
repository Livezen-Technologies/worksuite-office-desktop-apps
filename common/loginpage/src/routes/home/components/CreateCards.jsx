import { For } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { createDocument } from "@/sdk";
import { L } from "@/worksuite/lang.js";
import { Icon } from "@/worksuite/ui/components.jsx";
import "./CreateCards.styles.css";

/* The create commands are the native ones ("create:new" word | cell | slide | form) */
const KINDS = () => [
  { id: "word", label: L.wshDocument, ext: "DOCX", icon: "file-text" },
  { id: "cell", label: L.wshSpreadsheet, ext: "XLSX", icon: "file-sheet" },
  { id: "slide", label: L.wshPresentation, ext: "PPTX", icon: "presentation" },
  { id: "form", label: L.wshPdfForm, ext: "PDF", icon: "file-type" },
];

export function CreateCards(props) {
  const navigate = useNavigate();
  const create = props.onCreate || ((id) => createDocument(id));

  /* arrow keys move between the cards (one tab stop for the group) */
  function onKey(e) {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(e.key in keys) && e.key !== "Home" && e.key !== "End") return;
    const cards = [...e.currentTarget.querySelectorAll(".wsh-create-card")];
    const i = cards.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const rtl = document.body.classList.contains("rtl") && (e.key === "ArrowLeft" || e.key === "ArrowRight") ? -1 : 1;
    const j = e.key === "Home" ? 0 : e.key === "End" ? cards.length - 1 : (i + keys[e.key] * rtl + cards.length) % cards.length;
    cards.forEach((c, k) => (c.tabIndex = k === j ? 0 : -1));
    cards[j].focus();
  }

  return (
    <section class="wsh-create" aria-labelledby="wsh-create-title">
      <h2 class="wsh-eyebrow" id="wsh-create-title">{L.wshCreateNew}</h2>
      <div class="wsh-create-grid" role="list" onKeyDown={onKey}>
        <For each={KINDS()}>
          {(k, i) => (
            <div role="listitem">
              <button type="button" class={"wsh-create-card wsh-type-" + k.id} tabindex={i() === 0 ? 0 : -1} title={k.label + " (" + k.ext + ")"} onClick={() => create(k.id)}>
                <span class="wsh-create-tile" aria-hidden="true"><Icon name={k.icon} /></span>
                <span class="wsh-create-text">
                  <span class="wsh-create-name">{k.label}</span>
                  <span class="wsh-create-ext">{k.ext}</span>
                </span>
              </button>
            </div>
          )}
        </For>
        <div role="listitem">
          <button type="button" class="wsh-create-card wsh-type-template" tabindex="-1" title={L.wshBrowseTemplates} onClick={() => navigate("/templates")}>
            <span class="wsh-create-tile" aria-hidden="true"><Icon name="layout-template" /></span>
            <span class="wsh-create-text">
              <span class="wsh-create-name">{L.wshFromTemplate}</span>
              <span class="wsh-create-ext">{L.wshBrowseTemplates}</span>
            </span>
          </button>
        </div>
      </div>
    </section>
  );
}
