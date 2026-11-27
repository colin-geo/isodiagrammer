/**
 * Stage 1+2 (PLAN.md §5.2): YAML → JS value + source map, then schema validation.
 * Every diagnostic gets an exact range via the source map.
 */
import { isMap, isPair, isScalar, isSeq, LineCounter, type Node, parseDocument } from "yaml";
import type { z } from "zod";
import type { Diagnostic, DocPath } from "../diagnostics.ts";
import { DiagramDsl } from "../dsl/schema.ts";

export interface SourceRange {
  from: number;
  to: number;
}

/** path key → ranges of the value node and (for map entries) the key node. */
export class SourceMap {
  private readonly values = new Map<string, SourceRange>();
  private readonly keys = new Map<string, SourceRange>();

  static key(path: DocPath): string {
    return path.map(String).join("\u0000");
  }

  setValue(path: DocPath, r: SourceRange) {
    this.values.set(SourceMap.key(path), r);
  }
  setKey(path: DocPath, r: SourceRange) {
    this.keys.set(SourceMap.key(path), r);
  }

  /** Range of the value at `path`, falling back to the nearest ancestor. */
  value(path: DocPath): SourceRange | undefined {
    for (let n = path.length; n >= 0; n--) {
      const r = this.values.get(SourceMap.key(path.slice(0, n)));
      if (r) return r;
    }
    return undefined;
  }

  /** Range of the key of the entry at `path` (falls back to the value range). */
  keyOf(path: DocPath): SourceRange | undefined {
    return this.keys.get(SourceMap.key(path)) ?? this.value(path);
  }
}

function buildSourceMap(root: Node | null, map: SourceMap, path: (string | number)[] = []) {
  if (!root?.range) return;
  map.setValue(path, { from: root.range[0], to: root.range[1] });
  if (isMap(root)) {
    for (const pair of root.items) {
      if (!isPair(pair) || !isScalar(pair.key)) continue;
      const k = String(pair.key.value);
      const childPath = [...path, k];
      const kr = pair.key.range;
      if (kr) map.setKey(childPath, { from: kr[0], to: kr[1] });
      if (pair.value) buildSourceMap(pair.value as Node, map, childPath);
      else if (kr) map.setValue(childPath, { from: kr[0], to: kr[1] });
    }
  } else if (isSeq(root)) {
    root.items.forEach((item, i) => {
      buildSourceMap(item as Node, map, [...path, i]);
    });
  }
}

export interface ParseResult {
  /** Present only if the document is syntactically valid AND matches the schema. */
  dsl: DiagramDsl | undefined;
  /** The raw JS value (even if invalid), for tooling. */
  raw: unknown;
  sourceMap: SourceMap;
  lineCounter: LineCounter;
  diagnostics: Diagnostic[];
}

export function parseDiagram(text: string): ParseResult {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, prettyErrors: false, uniqueKeys: true });
  const sourceMap = new SourceMap();
  buildSourceMap(doc.contents as Node | null, sourceMap);
  const diagnostics: Diagnostic[] = [];

  for (const e of doc.errors) {
    const isDup = e.code === "DUPLICATE_KEY";
    diagnostics.push({
      severity: "error",
      code: isDup ? "E_DUPLICATE_ID" : "E_YAML_SYNTAX",
      message: isDup
        ? "Duplicate key — ids must be unique"
        : (e.message.split("\n")[0] ?? e.message),
      path: [],
      range: { from: e.pos[0], to: Math.max(e.pos[1], e.pos[0] + 1) },
    });
  }
  for (const w of doc.warnings) {
    diagnostics.push({
      severity: "warning",
      code: "W_YAML",
      message: w.message.split("\n")[0] ?? w.message,
      path: [],
      range: { from: w.pos[0], to: w.pos[1] },
    });
  }
  if (doc.errors.length > 0)
    return { dsl: undefined, raw: undefined, sourceMap, lineCounter, diagnostics };

  const raw = doc.toJS({ maxAliasCount: 100 });
  const result = DiagramDsl.safeParse(raw ?? {});
  if (result.success) return { dsl: result.data, raw, sourceMap, lineCounter, diagnostics };

  diagnostics.push(...zodDiagnostics(result.error, sourceMap));
  return { dsl: undefined, raw, sourceMap, lineCounter, diagnostics };
}

function zodDiagnostics(error: z.ZodError, sm: SourceMap): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const issue of error.issues) {
    const path = issue.path.filter((p): p is string | number => typeof p !== "symbol");
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        const keyPath = [...path, key];
        out.push({
          severity: "error",
          code: "E_UNKNOWN_KEY",
          message: `Unknown key "${key}"${path.length ? ` in ${path.join(".")}` : ""}`,
          path: keyPath,
          ...withRange(sm.keyOf(keyPath)),
        });
      }
      continue;
    }
    // Unions report one sub-issue per branch; surface the most specific branch's messages.
    if (issue.code === "invalid_union" && issue.errors.length > 0) {
      const best = [...issue.errors].sort((a, b) => b.length - a.length).at(-1) ?? [];
      if (best.length > 0) {
        for (const sub of best) {
          const subPath = [
            ...path,
            ...sub.path.filter((p): p is string | number => typeof p !== "symbol"),
          ];
          out.push({
            severity: "error",
            code: sub.code === "unrecognized_keys" ? "E_UNKNOWN_KEY" : "E_SCHEMA",
            message: describe(subPath, sub.message),
            path: subPath,
            ...withRange(sm.value(subPath)),
          });
        }
        continue;
      }
    }
    out.push({
      severity: "error",
      code: "E_SCHEMA",
      message: describe(path, issue.message),
      path,
      ...withRange(sm.value(path)),
    });
  }
  return out;
}

const describe = (path: DocPath, msg: string) => (path.length ? `${path.join(".")}: ${msg}` : msg);

export function withRange(r: SourceRange | undefined): { range?: SourceRange } {
  return r ? { range: r } : {};
}
