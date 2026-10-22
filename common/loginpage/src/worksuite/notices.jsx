/*
 * Notices above the WorkSuite Drive list (G-01, G-04): the server is too old for WorkSuite Office,
 * or (Linux, no Secret Service) the sign-in is kept in a file.
 */
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { L } from "./lang.js";
import { hostOf } from "./cards.jsx";

const WS = () => window.WorkSuite;

export function PlatformNotices(props) {
  const [tick, setTick] = createSignal(0);
  onMount(() => {
    const bump = () => setTick(tick() + 1);
    WS().on("changed", bump);
    onCleanup(() => WS().off("changed", bump));
  });

  const tooOld = () => {
    tick();
    const c = props.account && WS().capability(props.account);
    return !!c && !c.ok;
  };
  const inFile = () => {
    tick();
    return !!props.account && !props.account.broker && WS().secretStoreKind() === "file";
  };

  return (
    <>
      <Show when={tooOld()}>
        <p class="ws-notice ws-notice-error" role="alert">{L.wsServerTooOld.replace("$1", hostOf(props.account.server))}</p>
      </Show>
      <Show when={inFile()}>
        <p class="ws-notice" role="status">{L.wsSecretInFile}</p>
      </Show>
    </>
  );
}
