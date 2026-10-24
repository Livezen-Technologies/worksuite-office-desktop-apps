/*
 *  The WorkSuite Office loading screen on the start page.
 *  ---------------------------------------------------------------------------
 *
 *  WHAT THIS IS, AND WHY IT IS NOT THE FOUR-SQUARE MARK
 *
 *  `css/brandloader.less` draws the WorkSuite mark - four squares that dim in
 *  turn - by hand, with no player, because that animation needs nothing a
 *  player provides. This is a different animation. The Office loading screen
 *  the designers exported is 640 x 400 and has, in nine layers, two embedded
 *  raster images (the wordmark and the "Office" label) and a track matte
 *  sweeping over the progress bar. Neither of those can be rebuilt honestly in
 *  CSS or in a static SVG, so this one is played by a player: lottie-web,
 *  vendored at `vendor/lottie-web/lottie_light.min.js` and committed, never
 *  fetched from a CDN.
 *
 *  So the two coexist: the mark stays the small in-flight marker beside
 *  buttons and in dialogs (20px and 24px, see window.less and worksuite.less),
 *  and this takes over the one full-window surface, the start page's
 *  `#loading-mask`. If the player is missing or anything here throws, the
 *  64px mark that is already in the markup is simply left alone - that is the
 *  fallback, and nothing has to be drawn to get it.
 *
 *  THE BACKGROUND LAYER
 *
 *  The export's last layer is named "background (hide for transparent)": a
 *  solid #001842 rectangle the author left separable so the screen can be
 *  shown over something else. It is KEPT here. The two embedded images are
 *  light - the wordmark is a pale-cyan-to-blue gradient drawn for navy - so on
 *  the start page, whose mask paints `--background-normal` (white in the
 *  default theme), hiding the background would leave the wordmark all but
 *  invisible. The transparent option is for a surface that already paints the
 *  navy itself; this one does not.
 *
 *  TIMING
 *
 *  `nm` records the split: intro frames 0-96, then a loop over 96-168. So the
 *  intro is played once and the tail is looped, rather than restarting the
 *  intro every 2.8 seconds.
 *
 *  REDUCED MOTION
 *
 *  Under `prefers-reduced-motion: reduce` the screen is still shown, held at
 *  frame 96 - the end of the intro, where the pages have settled and the
 *  wordmark is up. The resting frame, not nothing.
 */
(function () {
    'use strict';

    var INTRO_END = 96;     // "intro 0-96" from the export's name
    var LOOP_END = 168;     // "loop 96-168"
    var BACKGROUND_LAYER = 'background (hide for transparent)';

    function prefersReducedMotion() {
        try {
            return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        } catch (e) {
            return false;
        }
    }

    // A shallow copy with the background layer kept or dropped. Shallow is
    // enough: only the `layers` array is replaced, and nothing is mutated in
    // the shared asset objects. No layer in this export is parented to the
    // background and no matte pairs with it, so dropping it cannot orphan one.
    function animationData(keepBackground) {
        var data = window.WS_OFFICE_LOADING_ANIMATION;
        if (!data || !data.layers) {
            return null;
        }
        if (keepBackground) {
            return data;
        }
        var copy = {}, key;
        for (key in data) {
            if (Object.prototype.hasOwnProperty.call(data, key)) {
                copy[key] = data[key];
            }
        }
        copy.layers = data.layers.filter(function (layer) {
            return layer.nm !== BACKGROUND_LAYER;
        });
        return copy;
    }

    function mount() {
        var mask = document.getElementById('loading-mask');
        var stage = document.getElementById('stage');
        if (!mask || !stage || !window.lottie) {
            return;     // the four-square mark in #stage stays as it is
        }

        var data = animationData(true);
        if (!data) {
            return;
        }

        var host = document.createElement('div');
        host.className = 'ws-office-splash';
        host.setAttribute('role', 'img');
        host.setAttribute('aria-label', stage.textContent ? stage.textContent : 'Loading');
        mask.appendChild(host);

        var anim;
        try {
            anim = window.lottie.loadAnimation({
                container: host,
                renderer: 'svg',
                loop: false,
                autoplay: false,
                animationData: data,
                rendererSettings: {
                    preserveAspectRatio: 'xMidYMid meet',
                    progressiveLoad: false
                }
            });
        } catch (e) {
            mask.removeChild(host);
            return;
        }

        // Only now hide the mark: if the player had failed above, the mark is
        // still the thing on screen and the user never sees a gap.
        stage.style.display = 'none';

        if (prefersReducedMotion()) {
            anim.goToAndStop(INTRO_END, true);
            return;
        }

        anim.addEventListener('complete', function () {
            anim.loop = true;
            anim.playSegments([INTRO_END, LOOP_END], true);
        });
        anim.playSegments([0, INTRO_END], true);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        mount();
    }
})();
