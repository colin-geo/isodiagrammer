/**
 * High-level edit operations used by drag-and-drop (PLAN.md §7). Each returns ONE minimal
 * text change, so it becomes one CodeMirror transaction and one undo step.
 */
import type { LayoutInfo } from "../layout/info.ts";
import { applyChanges, removeKey, setKey, type TextChange, type Vec2 } from "./yaml-edit.ts";

export type EditOp =
  /** Pin at `at` (relative to the parent). `parent`: undefined = unchanged, null = top level. */
  | { kind: "move"; id: string; at: Vec2; parent?: string | null }
  | { kind: "unpin"; id: string }
  | { kind: "resize"; id: string; size: Vec2 }
  /** Pin many nodes at once ("Pin all" / `isodiagram freeze`). */
  | { kind: "pinAll"; nodes: readonly { id: string; at: Vec2 }[] };

/**
 * "Pin all": write every auto-placed node's computed position into the document, so
 * later edits can't reshuffle the layout (PLAN.md §6.1). Undefined if nothing is unpinned.
 */
export function pinAllOp(layout: LayoutInfo): EditOp | undefined {
  const nodes = layout.nodes.filter((n) => !n.pinned).map((n) => ({ id: n.id, at: n.at }));
  return nodes.length ? { kind: "pinAll", nodes } : undefined;
}

/** The single change that turns `a` into `b` (common prefix/suffix trimmed). */
export function diffChange(a: string, b: string): TextChange | undefined {
  if (a === b) return undefined;
  let start = 0;
  const max = Math.min(a.length, b.length);
  while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a.charCodeAt(endA - 1) === b.charCodeAt(endB - 1)) {
    endA--;
    endB--;
  }
  return { from: start, to: endA, insert: b.slice(start, endB) };
}

/** Throws if the id doesn't exist or the YAML can't be parsed. */
export function applyEdit(text: string, op: EditOp): TextChange[] {
  let out = text;
  const step = (changes: TextChange[]) => {
    out = applyChanges(out, changes);
  };
  switch (op.kind) {
    case "move":
      if (op.parent === null) step(removeKey(out, op.id, "in"));
      else if (op.parent !== undefined) step(setKey(out, op.id, "in", op.parent));
      step(setKey(out, op.id, "at", op.at));
      break;
    case "unpin":
      step(removeKey(out, op.id, "at"));
      break;
    case "resize":
      step(setKey(out, op.id, "size", op.size));
      break;
    case "pinAll":
      for (const n of op.nodes) step(setKey(out, n.id, "at", n.at));
      break;
  }
  const change = diffChange(text, out);
  return change ? [change] : [];
}
