/*
 * WorkSuite Project and WorkSuite Diagram: the two apps on their way (docs/project-diagram-roadmap.md in
 * worksuite-office). Their start-page tiles open a page that says what each can do today and what each
 * stage brings. Pure data and helpers, so node --test covers them.
 *   status: "now" (in this release) | "next" (the stage being built) | "later"
 */
export const NEW_APPS = [
  {
    id: "project",
    label: "wshProject",
    hint: "wshProjectHint",
    icon: "project",
    stages: [
      { id: 1, status: "now", title: "wsaStart", items: ["wsaProjectS1"] },
      { id: 2, status: "next", title: "wsaProjectS2T", items: ["wsaProjectS2a", "wsaProjectS2b", "wsaProjectS2c"] },
      { id: 3, status: "later", title: "wsaProjectS3T", items: ["wsaProjectS3a", "wsaProjectS3b"] },
      { id: 4, status: "later", title: "wsaProjectS4T", items: ["wsaProjectS4a", "wsaProjectS4b"] },
    ],
  },
  {
    id: "diagram",
    label: "wshDiagram",
    hint: "wshDiagramHint",
    icon: "diagram",
    // a Visio drawing (VSDX, VSD, VSDM) opens in the engine's diagram viewer through the native Open dialog
    opens: true,
    stages: [
      { id: 1, status: "now", title: "wsaStart", items: ["wsaDiagramS1"] },
      { id: 2, status: "next", title: "wsaDiagramS2T", items: ["wsaDiagramS2a", "wsaDiagramS2b", "wsaDiagramS2c"] },
      { id: 3, status: "later", title: "wsaDiagramS3T", items: ["wsaDiagramS3a", "wsaDiagramS3b"] },
      { id: 4, status: "later", title: "wsaDiagramS4T", items: ["wsaDiagramS4a", "wsaDiagramS4b"] },
    ],
  },
];

export const appById = (id) => NEW_APPS.find((a) => a.id === id) || null;

/* the start page route of an app's page */
export const appRoute = (id) => {
  if (!appById(id)) throw new Error("unknown app " + id);
  return "/apps/" + id;
};

/** Opens an app's editor in an app tab: the desktop shell's "worksuite:open-app" (#72). */
export function openApp(id, command) {
  if (!appById(id)) throw new Error("unknown app " + id);
  command("worksuite:open-app", JSON.stringify({ app: id }));
}

/* every text key the apps' pages use, for the English table check */
export const appTextKeys = () =>
  NEW_APPS.flatMap((a) => [a.label, a.hint, ...a.stages.flatMap((s) => [s.title, ...s.items])]);
