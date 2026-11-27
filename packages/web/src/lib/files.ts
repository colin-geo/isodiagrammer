/**
 * Open/save. Uses the File System Access API where available (save in place), falling
 * back to <input type=file> and downloads elsewhere (PLAN.md §9.2).
 */

interface FileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}
interface PickerOptions {
  types?: { description: string; accept: Record<string, string[]> }[];
  suggestedName?: string;
}
interface FsAccessWindow {
  showOpenFilePicker?: (o?: PickerOptions) => Promise<FileHandle[]>;
  showSaveFilePicker?: (o?: PickerOptions) => Promise<FileHandle>;
}

import { download } from "./export.ts";

const fsWindow = window as unknown as FsAccessWindow;
const TYPES = [
  { description: "Isometric diagram (YAML)", accept: { "application/yaml": [".yaml", ".yml"] } },
];

export interface OpenedFile {
  name: string;
  text: string;
  handle?: FileHandle | undefined;
}

export type { FileHandle };

const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

export async function openFile(): Promise<OpenedFile | undefined> {
  if (fsWindow.showOpenFilePicker) {
    try {
      const [handle] = await fsWindow.showOpenFilePicker({ types: TYPES });
      if (!handle) return undefined;
      const file = await handle.getFile();
      return { name: file.name, text: await file.text(), handle };
    } catch (e) {
      if (isAbort(e)) return undefined;
      throw e;
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".yaml,.yml";
    input.onchange = async () => {
      const file = input.files?.[0];
      resolve(file ? { name: file.name, text: await file.text() } : undefined);
    };
    input.oncancel = () => resolve(undefined);
    input.click();
  });
}

/** Save; returns the new name/handle, or undefined if the user cancelled. */
export async function saveFile(
  text: string,
  name: string,
  handle: FileHandle | undefined,
  saveAs = false,
): Promise<{ name: string; handle?: FileHandle | undefined } | undefined> {
  try {
    let h = saveAs ? undefined : handle;
    if (!h && fsWindow.showSaveFilePicker)
      h = await fsWindow.showSaveFilePicker({ types: TYPES, suggestedName: name });
    if (h) {
      const w = await h.createWritable();
      await w.write(text);
      await w.close();
      return { name: h.name, handle: h };
    }
  } catch (e) {
    if (isAbort(e)) return undefined;
    throw e;
  }
  download(new Blob([text], { type: "application/yaml" }), name);
  return { name };
}
