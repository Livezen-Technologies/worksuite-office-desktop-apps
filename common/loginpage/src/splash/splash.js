// WorkSuite loading screen: navy (#001842) full-window splash with the WorkSuite Office Lottie animation.
// The intro (frames 0-96) plays once, then 96-168 loops until done() is called; the splash fades out
// (opacity .45s) once loading is done and the intro has finished. With prefers-reduced-motion it shows
// the final frame statically and hides as soon as loading is done.
//
// lottie-web 5.12.2 (lottie_light.min.js, MIT, res/vendor/lottie-web) is inlined into the page as a classic
// script, so window.lottie is there before this module runs; nothing is loaded from the network.
import animationData from "../../res/splash/worksuite-splash.json";

const INTRO = [0, 96];
const LOOP = [96, 168];

export function createSplash(el, container, { lottie = globalThis.lottie, reducedMotion } = {}) {
  let anim = null;
  let ready = false;
  let introDone = false;

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
      anim?.destroy();
      anim = null;
    };
    el.addEventListener("transitionend", remove, { once: true });
    setTimeout(remove, 600); // transitionend never fires when the page is hidden or transitions are off
  }

  function show() {
    ready = false;
    introDone = false;
    if (!el) return;
    el.style.display = "";
    el.classList.remove("ws-splash--hide");
    anim?.destroy();
    anim = null;
    if (!lottie || !container) {
      introDone = true;
      return;
    }
    anim = lottie.loadAnimation({ container, renderer: "svg", loop: false, autoplay: false, animationData });
    if (reduce()) {
      anim.goToAndStop(LOOP[1] - 1, true);
      introDone = true;
      return;
    }
    anim.playSegments(INTRO, true);
    anim.addEventListener("complete", () => {
      if (introDone) return;
      introDone = true;
      finish();
      if (!ready && anim) {
        anim.loop = true;
        anim.playSegments(LOOP, true);
      }
    });
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
