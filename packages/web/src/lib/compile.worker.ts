/// <reference lib="webworker" />
/** Runs the whole pipeline off the UI thread (PLAN.md §5.3). */
import { compile, layoutInfo } from "@isodiagrammer/core";
import { browserIconProvider } from "./browser-icons.ts";
import type { CompileRequest, CompileResponse } from "./compiler.ts";

const icons = browserIconProvider(self.location.origin);

/*
 * elkjs, when first loaded inside a Web Worker, assumes it *is* the ELK worker and assigns
 * `self.onmessage` to its own dispatcher (elk.bundled.js: `if (typeof document === 'undefined'
 * && typeof self !== 'undefined') self.onmessage = ...`). Its in-process API doesn't need that,
 * so we listen with addEventListener (unaffected by the assignment) and clear the hijacked
 * handler after every compile. The client also ignores any message that isn't ours.
 */
self.addEventListener("message", async (e: MessageEvent<CompileRequest>) => {
  if (typeof e.data?.id !== "number" || typeof e.data.text !== "string") return;
  const { id, text } = e.data;
  const t0 = performance.now();
  let response: CompileResponse;
  try {
    const r = await compile(text, { icons });
    response = {
      id,
      text,
      svg: r.svg,
      diagnostics: r.diagnostics,
      layout: layoutInfo(r),
      ms: performance.now() - t0,
    };
  } catch (err) {
    response = {
      id,
      text,
      svg: undefined,
      diagnostics: [
        {
          severity: "error",
          code: "E_LAYOUT",
          message: `Internal error: ${(err as Error).message}`,
          path: [],
        },
      ],
      ms: performance.now() - t0,
    };
  }
  self.onmessage = null;
  self.postMessage(response);
});
