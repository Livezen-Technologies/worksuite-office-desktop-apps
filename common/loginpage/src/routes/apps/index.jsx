import { For, Show } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { openLocal } from "@/sdk";
import { L } from "@/worksuite/lang.js";
import { Icon } from "@/worksuite/ui/components.jsx";
import { appById } from "@/worksuite/new-apps.js";
import "./apps.css";

/* WorkSuite Project and WorkSuite Diagram (src/worksuite/new-apps.js): what each does today, and its stages */
export default function AppPage() {
  const params = useParams();
  const navigate = useNavigate();
  const app = () => appById(params.id);
  const status = { now: () => L.wsaNow, next: () => L.wsaNext, later: () => L.wsaLater };

  return (
    <Show when={app()} fallback={<div class="wsa-page"><button type="button" class="wsx-btn wsx-btn-secondary" onClick={() => navigate("/")}>{L.wsaBack}</button></div>}>
      {(a) => (
        <div class="wsa-page">
          <header class="wsa-head">
            <span class="wsh-create-tile" aria-hidden="true"><Icon name={a().icon} /></span>
            <div>
              <h1 class="wsa-title">WorkSuite {L[a().label]}</h1>
              <span class="wsa-badge">{L.wsaComingSoon}</span>
            </div>
          </header>
          <p class="wsa-intro">{L[a().id === "project" ? "wsaProjectIntro" : "wsaDiagramIntro"]}</p>
          <div class="wsa-actions">
            <Show when={a().opens}>
              <button type="button" class="wsx-btn wsx-btn-accent" onClick={() => openLocal()}>{L.wsaOpenVisio}</button>
            </Show>
            <button type="button" class="wsx-btn wsx-btn-secondary" onClick={() => navigate("/")}>{L.wsaBack}</button>
          </div>
          <h2 class="wsh-eyebrow">{L.wsaRoadmap}</h2>
          <ol class="wsa-stages">
            <For each={a().stages}>
              {(s) => (
                <li class={"wsa-stage is-" + s.status}>
                  <div class="wsa-stage-head">
                    <span class="wsa-stage-num">{L.wsaStage.replace("$1", s.id)}</span>
                    <span class="wsa-stage-title">{L[s.title]}</span>
                    <span class="wsa-stage-status">{status[s.status]()}</span>
                  </div>
                  <ul>
                    <For each={s.items}>{(k) => <li>{L[k]}</li>}</For>
                  </ul>
                </li>
              )}
            </For>
          </ol>
        </div>
      )}
    </Show>
  );
}
