/**
 * Drag-and-drop rules (PLAN.md §7), as pure functions over the engine's LayoutInfo so they
 * can be unit-tested without a browser.
 */
import type { EditOp, LayoutInfo, NodeInfo, Vec2 } from "@isodiagrammer/core";

export interface DropCandidate {
  id: string;
  /** new absolute world position */
  abs: Vec2;
  /** new parent (undefined = top level) */
  parent: string | undefined;
  /** new position relative to that parent */
  at: Vec2;
  valid: boolean;
  /** why it's invalid */
  reason?: string;
  /** would dropping change the document? */
  changed: boolean;
  reparented: boolean;
}

export interface ResizeCandidate {
  id: string;
  size: Vec2;
  valid: boolean;
  reason?: string;
  changed: boolean;
}

const byId = (layout: LayoutInfo) => new Map(layout.nodes.map((n) => [n.id, n]));

/** The node and everything nested inside it. */
export function withDescendants(layout: LayoutInfo, id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of layout.nodes) {
      if (n.parent && out.has(n.parent) && !out.has(n.id)) {
        out.add(n.id);
        grew = true;
      }
    }
  }
  return out;
}

const depth = (nodes: Map<string, NodeInfo>, n: NodeInfo): number =>
  n.parent ? 1 + depth(nodes, nodes.get(n.parent) as NodeInfo) : 0;

const overlaps = (aAt: Vec2, aSize: Vec2, bAt: Vec2, bSize: Vec2) =>
  aAt[0] < bAt[0] + bSize[0] &&
  bAt[0] < aAt[0] + aSize[0] &&
  aAt[1] < bAt[1] + bSize[1] &&
  bAt[1] < aAt[1] + aSize[1];

/**
 * Where would node `id` land if moved by `delta` whole cells? By default it joins the
 * innermost group containing its new centre; `keepParent` (Alt-drag, keyboard nudges) keeps
 * its current group.
 */
export function computeDrop(
  layout: LayoutInfo,
  id: string,
  delta: Vec2,
  opts: { keepParent?: boolean } = {},
): DropCandidate | undefined {
  const nodes = byId(layout);
  const n = nodes.get(id);
  if (!n) return undefined;
  const abs: Vec2 = [n.abs[0] + delta[0], n.abs[1] + delta[1]];

  let parent: NodeInfo | undefined;
  if (opts.keepParent) {
    parent = n.parent ? nodes.get(n.parent) : undefined;
  } else {
    const excluded = withDescendants(layout, id);
    const cx = abs[0] + n.size[0] / 2;
    const cy = abs[1] + n.size[1] / 2;
    const containing = layout.nodes.filter(
      (g) =>
        g.kind === "group" &&
        !excluded.has(g.id) &&
        cx > g.abs[0] &&
        cx < g.abs[0] + g.size[0] &&
        cy > g.abs[1] &&
        cy < g.abs[1] + g.size[1],
    );
    parent = containing.sort((a, b) => depth(nodes, b) - depth(nodes, a))[0];
  }

  const at: Vec2 = parent ? [abs[0] - parent.abs[0], abs[1] - parent.abs[1]] : abs;
  const reparented = (parent?.id ?? undefined) !== n.parent;
  const changed = reparented || !n.pinned || at[0] !== n.at[0] || at[1] !== n.at[1];
  const base = { id, abs, parent: parent?.id, at, changed, reparented };

  if (parent) {
    if (at[0] < 0 || at[1] < 0) return { ...base, valid: false, reason: `Outside "${parent.id}"` };
    if (
      parent.fixedSize &&
      (at[0] + n.size[0] > parent.size[0] || at[1] + n.size[1] > parent.size[1])
    )
      return { ...base, valid: false, reason: `Doesn't fit inside "${parent.id}"` };
  }
  // Only pinned siblings block: auto-placed ones are re-laid-out around the dropped node.
  const sibling = layout.nodes.find(
    (s) => s.id !== id && s.pinned && s.parent === parent?.id && overlaps(at, n.size, s.at, s.size),
  );
  if (sibling) return { ...base, valid: false, reason: `Overlaps "${sibling.id}"` };
  return { ...base, valid: true };
}

/** Resize group `id` (from its far corner) to `size`, which must still hold every child. */
export function computeResize(
  layout: LayoutInfo,
  id: string,
  size: Vec2,
): ResizeCandidate | undefined {
  const g = byId(layout).get(id);
  if (g?.kind !== "group") return undefined;
  const changed = !g.fixedSize || size[0] !== g.size[0] || size[1] !== g.size[1];
  if (size[0] < 1 || size[1] < 1) return { id, size, valid: false, reason: "Too small", changed };
  const child = layout.nodes.find(
    (c) => c.parent === id && (c.at[0] + c.size[0] > size[0] || c.at[1] + c.size[1] > size[1]),
  );
  if (child) return { id, size, valid: false, reason: `"${child.id}" wouldn't fit`, changed };
  return { id, size, valid: true, changed };
}

/** The innermost node whose source entry contains `pos` (for editor → preview selection). */
export function nodeAtSource(layout: LayoutInfo, pos: number): string | undefined {
  let best: NodeInfo | undefined;
  for (const n of layout.nodes) {
    if (!n.entry || pos < n.entry.from || pos > n.entry.to) continue;
    if (!best?.entry || n.entry.to - n.entry.from < best.entry.to - best.entry.from) best = n;
  }
  return best?.id;
}

/** Arrow keys → world delta for nudging, following the screen layout of the current view. */
export function nudgeDelta(key: string, rotation: 0 | 90 | 180 | 270): Vec2 | undefined {
  // In the view frame: → is +x (towards the lower right), ↓ is +y (towards the lower left).
  const view: Record<string, Vec2> = {
    ArrowRight: [1, 0],
    ArrowLeft: [-1, 0],
    ArrowDown: [0, 1],
    ArrowUp: [0, -1],
  };
  const v = view[key];
  if (!v) return undefined;
  // Undo the view rotation (inverse of rotatePoint).
  const [x, y] = v;
  switch (rotation) {
    case 0:
      return [x, y];
    case 90:
      return [y, -x];
    case 180:
      return [-x, -y];
    case 270:
      return [-y, x];
  }
}

/**
 * Optimistically apply an edit to the layout, so a second nudge or drag that happens before
 * the re-render starts from the right place. The next compile result replaces this anyway.
 */
export function applyOpToLayout(layout: LayoutInfo, op: EditOp): LayoutInfo {
  const nodes = layout.nodes.map((n) => ({ ...n }));
  const map = new Map(nodes.map((n) => [n.id, n]));
  const n = map.get(op.id);
  if (!n) return layout;
  if (op.kind === "unpin") {
    n.pinned = false;
  } else if (op.kind === "resize") {
    n.size = [op.size[0], op.size[1]];
    n.fixedSize = true;
  } else {
    if (op.parent !== undefined) n.parent = op.parent ?? undefined;
    const parent = n.parent ? map.get(n.parent) : undefined;
    const abs: Vec2 = parent
      ? [parent.abs[0] + op.at[0], parent.abs[1] + op.at[1]]
      : [op.at[0], op.at[1]];
    const dx = abs[0] - n.abs[0];
    const dy = abs[1] - n.abs[1];
    for (const id of withDescendants({ ...layout, nodes }, n.id)) {
      const d = map.get(id) as NodeInfo;
      d.abs = [d.abs[0] + dx, d.abs[1] + dy];
    }
    n.at = [op.at[0], op.at[1]];
    n.pinned = true;
  }
  return { ...layout, nodes };
}
