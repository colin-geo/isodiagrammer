import { describe, expect, test, vi } from "vitest";
import {
  type CompileRequest,
  type CompileResponse,
  Compiler,
  type WorkerLike,
} from "./compiler.ts";

class FakeWorker implements WorkerLike {
  sent: CompileRequest[] = [];
  onmessage: ((e: MessageEvent<CompileResponse>) => void) | null = null;
  postMessage(msg: CompileRequest) {
    this.sent.push(msg);
  }
  reply(id: number, text: string) {
    this.onmessage?.({
      data: { id, text, svg: `<svg>${text}</svg>`, diagnostics: [], ms: 1 },
    } as unknown as MessageEvent<CompileResponse>);
  }
}

describe("Compiler", () => {
  test("debounces rapid updates into one request", () => {
    vi.useFakeTimers();
    const w = new FakeWorker();
    const c = new Compiler(w, () => {}, 100);
    c.update("a");
    c.update("ab");
    c.update("abc");
    vi.advanceTimersByTime(150);
    expect(w.sent.map((m) => m.text)).toEqual(["abc"]);
    vi.useRealTimers();
  });

  test("drops results for anything but the newest request", () => {
    const w = new FakeWorker();
    const results: string[] = [];
    const c = new Compiler(w, (r) => results.push(r.text), 0);
    c.update("old", true);
    c.update("new", true);
    w.reply(1, "new");
    w.reply(0, "old"); // slow, stale
    expect(results).toEqual(["new"]);
  });
});

test("ignores messages that aren't compile responses (e.g. from elkjs)", () => {
  const w = new FakeWorker();
  const results: string[] = [];
  const c = new Compiler(w, (r) => results.push(r.text), 0);
  c.update("x", true);
  w.onmessage?.({
    data: { id: 0, error: "elk dispatcher noise" },
  } as unknown as MessageEvent<CompileResponse>);
  w.reply(0, "x");
  expect(results).toEqual(["x"]);
});
