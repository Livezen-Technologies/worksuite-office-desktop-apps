/*
 * Document Preferences: the document-related options of Settings › General, also shown in
 * Settings › WorkSuite › Document Preferences. One definition and one store for both pages: the values are
 * the `settings` store's (stores/settings.js, persisted as "settings"), changed with setSettings and sent to
 * the app by the same Apply (settings-sync.js → "settings:apply"), so a change made on either page shows on
 * the other at once and is applied once.
 *
 *   launchMode  "tab" | "window"            → settings:apply editorwindowmode (Open documents in)
 *   spellCheck  "auto" | "enabled" | "disabled" → settings:apply spellcheckdetect (spell-check language detection)
 *
 * Neither needs a restart. UI scaling, language (and with it right-to-left) and the theme are the whole
 * app's, not documents', and stay in General only. No pure helper here touches the DOM or Solid.
 */

export const DOC_PREFS = [
  {
    key: "launchMode",
    labelKey: "settOptLaunchMode",
    options: [
      { value: "tab", labelKey: "settOptLaunchInTab" },
      { value: "window", labelKey: "settOptLaunchInWindow" },
    ],
  },
  {
    key: "spellCheck",
    labelKey: "settSpellcheckDetection",
    options: [
      { value: "auto", labelKey: "settOptScalingAuto" },
      { value: "enabled", labelKey: "settOptEnabled" },
      { value: "disabled", labelKey: "settOptDisabled" },
    ],
  },
];

const byKey = (key) => DOC_PREFS.find((p) => p.key === key);

/* the options of one preference for a Select / Segmented: [{value, label}] */
export function docPrefOptions(key, t) {
  const p = byKey(key);
  return p ? p.options.map((o) => ({ value: o.value, label: t(o.labelKey) })) : [];
}

/* the values both pages show */
export function readDocPrefs(settings) {
  return Object.fromEntries(DOC_PREFS.map((p) => [p.key, settings[p.key]]));
}

/* the one way either page changes a preference; an unknown key or value changes nothing (false) */
export function setDocPref(setSettings, key, value) {
  const p = byKey(key);
  if (!p || !p.options.some((o) => o.value === value)) return false;
  setSettings(key, value);
  return true;
}

/* their part of "settings:apply" */
export function docPrefsPayload(settings) {
  return { editorwindowmode: settings.launchMode === "window", spellcheckdetect: settings.spellCheck };
}
