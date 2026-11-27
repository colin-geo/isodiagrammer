/**
 * Client for the compile worker. Requests are debounced, and only the newest result is
 * delivered: a slow compile for old text never overwrites a newer one.
 */
import type { Diagnostic } from "@isodiagrammer/core";

export interface CompileRequest {
  id: number;
  text: string;
}

export interface CompileResponse {
  id: number;
  /** the text this result was compiled from */
  text: string;
  svg: string | undefined;
  diagnostics: Diagnostic[];
  ms: number;
}

export interface WorkerLike {
  postMessage(msg: CompileRequest): void;
  onmessage: ((e: MessageEvent<CompileResponse>) => void) | null;
}

export class Compiler {
  private nextId = 0;
  private latestSent = -1;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** true while a compile for the newest text is outstanding */
  busy = false;

  constructor(
    private readonly worker: WorkerLike,
    private readonly onResult: (r: CompileResponse) => void,
    private readonly delayMs = 150,
  ) {
    worker.onmessage = (e) => {
      const d = e.data as Partial<CompileResponse> | undefined;
      if (typeof d?.text !== "string" || !Array.isArray(d.diagnostics)) return; // not ours
      if (e.data.id !== this.latestSent) return; // stale
      this.busy = false;
      this.onResult(e.data);
    };
  }

  /** Schedule a compile; `immediate` skips the debounce (e.g. when loading a file). */
  update(text: string, immediate = false) {
    clearTimeout(this.timer);
    const send = () => {
      this.latestSent = this.nextId++;
      this.busy = true;
      this.worker.postMessage({ id: this.latestSent, text });
    };
    if (immediate) send();
    else this.timer = setTimeout(send, this.delayMs);
  }
}

export function createCompileWorker(): Worker {
  return new Worker(new URL("./compile.worker.ts", import.meta.url), { type: "module" });
}
