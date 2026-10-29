/*
 * Start-page PDF tools: Merge, Split and Extract pages.
 *
 * The start page cannot change a PDF itself, so a tool is a hand-over to the PDF editor: the start page notes the
 * task in localStorage ("ws:pdf-task", shared by the start page and the editors of the desktop app) and shows the
 * native Open dialog. The PDF editor that opens next takes the task (once, and only while it is fresh) and opens
 * the dialog of its Pages tab for it (WorkSuite's build/editors/.../PagesTab.js in worksuite-office).
 */
export const PDF_TASK_KEY = "ws:pdf-task";
export const PDF_TASK_VERSION = 1;
/* long enough to find the file in the Open dialog, short enough not to surprise a later PDF */
export const PDF_TASK_TTL_MS = 3 * 60 * 1000;

export const PDF_TOOLS = [
  { action: "merge", card: "merge-pdf", icon: "pdf-merge", label: "wshPdfMerge", hint: "wshPdfMergeHint" },
  { action: "split", card: "split-pdf", icon: "pdf-split", label: "wshPdfSplit", hint: "wshPdfSplitHint" },
  { action: "extract", card: "extract-pdf-pages", icon: "pdf-extract", label: "wshPdfExtract", hint: "wshPdfExtractHint" },
];

const ACTIONS = new Set(PDF_TOOLS.map((t) => t.action));

export function isPdfAction(action) {
  return ACTIONS.has(action);
}

export function actionOfCard(cardId) {
  const tool = PDF_TOOLS.find((t) => t.card === cardId);
  return tool ? tool.action : "";
}

export function makePdfTask(action, now) {
  if (!isPdfAction(action)) throw new Error("unknown PDF tool: " + action);
  return { v: PDF_TASK_VERSION, action, at: now };
}

/* The task the editor would take now, or null: the same rules as PagesTab.js takePendingTask() */
export function readPdfTask(raw, now) {
  let task;
  try {
    task = JSON.parse(raw || "null");
  } catch {
    return null;
  }
  if (!task || task.v !== PDF_TASK_VERSION || !isPdfAction(task.action)) return null;
  if (typeof task.at !== "number" || now < task.at || now - task.at > PDF_TASK_TTL_MS) return null;
  return task;
}

/* Notes the task and opens the native Open dialog. Returns false when the task could not be noted. */
export function startPdfTool(action, env) {
  const task = makePdfTask(action, env.now());
  try {
    env.storage.setItem(PDF_TASK_KEY, JSON.stringify(task));
  } catch {
    return false;
  }
  env.command("open:folder", "");
  return true;
}
