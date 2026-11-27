/** Autosave of the working document (localStorage; documents are small text). */
const KEY = "isodiagrammer:document:v1";

export interface Saved {
  name: string;
  text: string;
  /** text as last saved to a file, for dirty tracking across reloads */
  savedText: string | undefined;
}

export function loadAutosave(): Saved | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return undefined;
    const v = JSON.parse(raw) as Partial<Saved>;
    return typeof v.text === "string"
      ? { name: v.name ?? "diagram.yaml", text: v.text, savedText: v.savedText }
      : undefined;
  } catch {
    return undefined;
  }
}

export function autosave(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Quota or private mode: autosave is best-effort.
  }
}

const UI_KEY = "isodiagrammer:ui:v1";
export interface UiPrefs {
  split: number;
  helpOpen: boolean;
}
export function loadUi(): UiPrefs {
  try {
    return { split: 0.4, helpOpen: false, ...JSON.parse(localStorage.getItem(UI_KEY) ?? "{}") };
  } catch {
    return { split: 0.4, helpOpen: false };
  }
}
export function saveUi(p: UiPrefs) {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(p));
  } catch {}
}
