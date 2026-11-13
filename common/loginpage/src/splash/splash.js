// WorkSuite launch screen: the WorkSuite logo, "flash" (squares flash white, then a light sweep), on a
// full-window dark navy (#121b34, so the logo's own navy cell still reads). The SVG carries its own CSS
// animation and shows the still logo when reduced motion is asked for. The screen stays up for at least one
// flash (FLASH_MS) so it never just blinks, and fades out (opacity .45s) once loading is done.
import flashSvg from "../../res/splash/worksuite-loader-flash.svg?raw";

const FLASH_MS = 1600;

export function createSplash(el, container, { reducedMotion, minMs = FLASH_MS } = {}) {
  let ready = false;
  let introDone = false;
  let timer = null;

  const reduce = () =>
    reducedMotion ?? (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);

  function finish() {
    if (!ready || !introDone || !el) return;
    el.classList.add("ws-splash--hide");
    let removed = false;
    const remove = () => {
      if (removed || !el.classList.contains("ws-splash--hide")) return;
      removed = true;
      el.style.display = "none";
    };
    el.addEventListener("transitionend", remove, { once: true });
    setTimeout(remove, 600); // transitionend never fires when the page is hidden or transitions are off
  }

  function show() {
    ready = false;
    introDone = false;
    clearTimeout(timer);
    if (!el) return;
    el.style.display = "";
    el.classList.remove("ws-splash--hide");
    if (container && !container.firstElementChild) container.innerHTML = flashSvg;
    if (reduce() || !minMs) {
      introDone = true;
      return;
    }
    timer = setTimeout(() => {
      introDone = true;
      finish();
    }, minMs);
  }

  function done() {
    ready = true;
    finish();
  }

  show();
  return { show, done };
}

export const WorkSuiteSplash =
  typeof document !== "undefined"
    ? createSplash(document.getElementById("loading-mask"), document.getElementById("ws-splash-anim"))
    : null;

if (typeof window !== "undefined") window.WorkSuiteSplash = WorkSuiteSplash;
