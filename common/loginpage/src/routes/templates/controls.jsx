/*
 * Controls of the Templates page that the shared kit lacks, modelled on WorkSuite Desktop:
 * FilterSelect ← Select.tsx (searchable listbox in a placed popover: 38px search row, 36px options,
 * check on the chosen one, "Nothing matches"), PreviewDialog ← FileViewer.tsx (toolbar row, sunken
 * stage with the image contained, 36px actions).
 */
import { For, Show, createEffect, createMemo, createSignal, createUniqueId } from "solid-js";
import { Dialog } from "@/components";
import { Icon, Popover, WsButton } from "@/worksuite/ui/components.jsx";
import { T } from "./strings.js";

/*
 * props: label, value, options [{value, label, hint?}], onChange(value), allLabel (the "" option; omit for none),
 * searchable (default when more than 7 options), icon
 */
export function FilterSelect(props) {
  const id = createUniqueId();
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [hi, setHi] = createSignal(0);
  let root = null, input = null, list = null;
  const all = () => (props.allLabel !== undefined ? [{ value: "", label: props.allLabel }] : []).concat(props.options || []);
  const searchable = () => props.searchable ?? (props.options || []).length > 7;
  const shown = createMemo(() => {
    const q = query().trim().toLowerCase();
    return q ? all().filter((o) => o.value !== "" && o.label.toLowerCase().includes(q)) : all();
  });
  const current = () => all().find((o) => o.value === (props.value || ""));
  const active = () => !!props.value && props.allLabel !== undefined;
  const close = () => { setOpen(false); setQuery(""); };
  const choose = (o) => { props.onChange(o.value); close(); };
  createEffect(() => {
    if (!open()) return;
    setHi(Math.max(0, shown().findIndex((o) => o.value === (props.value || ""))));
    queueMicrotask(() => (input || list) && (input || list).focus());
  });
  createEffect(() => {
    const el = open() && list && list.querySelector(`#${CSS.escape(id + "-" + hi())}`);
    el && el.scrollIntoView({ block: "nearest" });
  });
  function onKey(e) {
    const n = shown().length;
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      if (!n) return;
      const i = hi();
      setHi(e.key === "ArrowDown" ? (i + 1) % n : e.key === "ArrowUp" ? (i - 1 + n) % n : e.key === "Home" ? 0 : n - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = shown()[hi()];
      o && choose(o);
    } else if (e.key === "Tab") close();
  }
  return (
    <div class="tpl-select" ref={(el) => (root = el)}>
      <button type="button" class="tpl-select-trigger" classList={{ "is-active": active() }} aria-haspopup="listbox"
              aria-expanded={open() ? "true" : "false"} aria-label={props.label + ": " + (current() ? current().label : "")}
              onClick={() => setOpen(!open())}>
        <Show when={props.icon}><Icon name={props.icon} /></Show>
        <Show when={props.allLabel === undefined || active()}><span class="tpl-select-label">{props.label}</span></Show>
        <span class="wsx-ellipsis tpl-select-value">{current() ? current().label : ""}</span>
        <Icon name="chevron" class="tpl-select-caret" />
      </button>
      <Popover open={open()} anchor={root} onClose={close} matchWidth class="tpl-select-pop">
        <Show when={searchable()}>
          <div class="tpl-select-search">
            <Icon name="search" />
            <input ref={(el) => (input = el)} role="combobox" aria-expanded="true" aria-controls={id} aria-autocomplete="list"
                   aria-activedescendant={shown().length ? id + "-" + hi() : undefined} aria-label={props.label}
                   placeholder={T.tplFilterSearch} value={query()} spellcheck={false}
                   onInput={(e) => { setQuery(e.currentTarget.value); setHi(0); }} onKeyDown={onKey} />
            <Show when={query()}>
              <button type="button" class="wsx-searchbox-clear" aria-label={T.tplClear} onClick={() => { setQuery(""); input && input.focus(); }}>
                <Icon name="x" />
              </button>
            </Show>
          </div>
        </Show>
        <ul role="listbox" id={id} class="tpl-select-list" aria-label={props.label} tabIndex={searchable() ? -1 : 0}
            ref={(el) => (list = el)} onKeyDown={(e) => !searchable() && onKey(e)}
            aria-activedescendant={!searchable() && shown().length ? id + "-" + hi() : undefined}>
          <For each={shown()}>
            {(o, i) => {
              const selected = () => o.value === (props.value || "");
              return (
                <li role="option" id={id + "-" + i()} aria-selected={selected() ? "true" : "false"}
                    classList={{ "is-hi": hi() === i(), "is-selected": selected() }}
                    onMouseEnter={() => setHi(i())} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(o)}>
                  <span class="wsx-ellipsis tpl-select-opt">{o.label}</span>
                  <Show when={o.hint}><span class="tpl-select-hint">{o.hint}</span></Show>
                  <Show when={selected()}><Icon name="check" class="wsx-combo-check" /></Show>
                </li>
              );
            }}
          </For>
          <Show when={!shown().length}><li class="tpl-select-empty" role="presentation">{T.tplNoOption}</li></Show>
        </ul>
      </Popover>
    </div>
  );
}

/* props: template, thumb (resolved URL), meta (text), favorite, busy, onUse, onFavorite, onClose */
export function PreviewDialog(props) {
  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <Dialog.Content class="tpl-preview" aria-describedby={undefined}>
        <div class="tpl-preview-bar">
          <span class={"tpl-type-mark tpl-type-" + props.template.type}>{props.template.ext.toUpperCase()}</span>
          <Dialog.Title class="tpl-preview-title wsx-ellipsis">{props.template.name}</Dialog.Title>
          <span class="tpl-preview-meta wsx-ellipsis">{props.meta}</span>
          <Dialog.CloseButton class="wsx-btn wsx-btn-ghost wsx-btn-sm wsx-btn-icon tpl-preview-x" aria-label={T.tplClose}>
            <Icon name="x" />
          </Dialog.CloseButton>
        </div>
        <div class="tpl-preview-stage">
          <Show when={props.thumb} fallback={<div class="tpl-thumb-none"><Icon name="template" /><span>{T.tplNoPreview}</span></div>}>
            <img src={props.thumb} alt={props.template.name} />
          </Show>
        </div>
        <div class="tpl-preview-foot">
          <Show when={props.template.description}><p class="tpl-preview-descr">{props.template.description}</p></Show>
          <div class="tpl-preview-actions">
            <WsButton variant="secondary" icon={props.favorite ? "star-on" : "star"} onClick={props.onFavorite}>
              {props.favorite ? T.tplUnfav : T.tplFav}
            </WsButton>
            <WsButton variant="primary" busy={props.busy} onClick={props.onUse}>{T.tplUse}</WsButton>
          </div>
        </div>
      </Dialog.Content>
    </Dialog>
  );
}
