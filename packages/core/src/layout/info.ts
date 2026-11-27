/**
 * A plain, serialisable summary of where everything ended up: what an interactive editor
 * needs for hit-testing, drag-and-drop and selection sync (sent across the worker boundary).
 */
import type { CompileResult } from "../compile.ts";
import type { Rotation, Vec2 } from "../resolve/resolve.ts";

export interface NodeInfo {
  id: string;
  kind: "group" | "resource";
  parent: string | undefined;
  /** relative to the parent */
  at: Vec2;
  /** absolute world grid position */
  abs: Vec2;
  /** world footprint */
  size: Vec2;
  /** height in cells (0 for groups and planes) */
  height: number;
  /** has `at` in the source */
  pinned: boolean;
  /** group with an explicit `size` in the source */
  fixedSize: boolean;
  /** source range of the entry's key (e.g. `web`) */
  key: { from: number; to: number } | undefined;
  /** source range from the key to the end of the value */
  entry: { from: number; to: number } | undefined;
}

export interface LayoutInfo {
  rotation: Rotation;
  groupPadding: number;
  nodes: NodeInfo[];
}

export function layoutInfo(result: CompileResult): LayoutInfo | undefined {
  const { model, placement, sourceMap } = result;
  if (!model || !placement) return undefined;
  const heights = new Map(model.resources.map((r) => [r.id, r.shape === "plane" ? 0 : r.height]));
  const fixed = new Set(model.groups.filter((g) => g.size).map((g) => g.id));
  const nodes: NodeInfo[] = [];
  for (const p of placement.values()) {
    const path = [p.kind === "group" ? "groups" : "resources", p.id];
    const key = sourceMap.keyOf(path);
    const value = sourceMap.value(path);
    nodes.push({
      id: p.id,
      kind: p.kind,
      parent: p.parent,
      at: p.at,
      abs: p.abs,
      size: p.size,
      height: heights.get(p.id) ?? 0,
      pinned: p.pinned,
      fixedSize: fixed.has(p.id),
      key,
      entry: key && value ? { from: key.from, to: Math.max(key.to, value.to) } : key,
    });
  }
  return { rotation: model.settings.rotation, groupPadding: model.settings.groupPadding, nodes };
}
