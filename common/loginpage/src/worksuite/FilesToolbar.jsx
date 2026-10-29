/*
 * The Files explorer's one toolbar, the same on every tab: search, file type, source (where a tab has more
 * than one), sort, list or grid, refresh, and the tab's New / Open action. Every control is 32px high.
 */
import { For, Show } from "solid-js";
import { DropdownMenu } from "@/components";
import { L } from "./lang.js";
import { Icon, LayoutToggle, SearchBox, SyncButton } from "./ui/components.jsx";

export const TYPE_OPTIONS = () => [["all", L.wsfAllTypes], ["word", L.wsDocuments], ["cell", L.wsSpreadsheets], ["slide", L.wsPresentations], ["pdf", "PDF"]];

/* A labelled dropdown: "Type: All types ▾". props: label, value, options [[value, text]], onChange */
export function FilterMenu(props) {
  const text = () => (props.options.find(([v]) => v === props.value) || props.options[0] || [])[1];
  return (
    <DropdownMenu>
      <DropdownMenu.Trigger class="wsx-btn wsx-btn-secondary wsf-filter" classList={{ "is-set": !props.plain && props.value !== props.options[0][0] }}
                            aria-label={props.label + ": " + text()}>
        <Show when={props.icon}><Icon name={props.icon} /></Show>
        <span class="wsf-filter-label">{props.label}</span>
        <span class="wsf-filter-value">{text()}</span>
        <Icon name="chevron" class="wsf-filter-caret" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content class="wsx-dropdown iconless">
        <For each={props.options}>
          {([value, label]) => (
            <DropdownMenu.Item onSelect={() => props.onChange(value)} class={props.value === value ? "wsf-menu-on" : ""}>
              <span class="wsf-menu-text">{label}</span>
              <Show when={props.value === value}><Icon name="check" class="wsf-menu-check" /></Show>
            </DropdownMenu.Item>
          )}
        </For>
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}

/*
 * props: placeholder, query, onSearch, type, onType, sources ([[value, text]] or none), source, onSource,
 * sorts ([[key, text]]), sort ({key, dir}), onSort(key), layout, onLayout, onRefresh (→ Promise), children (the
 * tab's own action, at the end)
 */
export function FilesToolbar(props) {
  return (
    <div class="wsf-toolbar" role="toolbar" aria-label={L.wsfTitle}>
      <SearchBox class="wsf-search" placeholder={props.placeholder} value={props.query} delay={props.delay ?? 200} onSearch={props.onSearch} />
      <div class="wsf-tools">
        <FilterMenu label={L.wshType} value={props.type} options={TYPE_OPTIONS()} onChange={props.onType} />
        <Show when={props.sources && props.sources.length > 1}>
          <FilterMenu label={L.wsfSource} value={props.source} options={props.sources} onChange={props.onSource} />
        </Show>
        <FilterMenu plain label={L.wsfSort} icon="sort" value={props.sort.key} options={props.sorts} onChange={props.onSort} />
        <LayoutToggle value={props.layout} onChange={props.onLayout} />
        <SyncButton iconOnly label={L.wsfRefresh} busyLabel={L.wsfRefreshing} doneLabel={L.wsfRefreshed} failedLabel={L.wsfRefreshFailed}
                    onSync={props.onRefresh} />
        {props.children}
      </div>
    </div>
  );
}
