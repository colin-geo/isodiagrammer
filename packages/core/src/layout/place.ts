/**
 * Stage 4a (PLAN.md §6.1): placement on the integer grid.
 *
 * 1. If any node lacks `at`, ELK `layered` lays out the compound graph (lazy-loaded).
 * 2. ELK coordinates are snapped to cells.
 * 3. Bottom-up per parent: pinned children go exactly at `at`; unpinned children keep their
 *    snapped ELK position unless it collides, then a deterministic spiral search finds the
 *    nearest free cell. Group sizes are then computed from their children, so each parent
 *    level resolves against final sizes.
 */
import type { ElkNode } from "elkjs/lib/elk-api.js";
import type { Diagnostic, DocPath } from "../diagnostics.ts";
import type { SourceMap } from "../parse/parse.ts";
import { withRange } from "../parse/parse.ts";
import type { Model, Vec2 } from "../resolve/resolve.ts";

export interface Placed {
  id: string;
  kind: "group" | "resource";
  parent: string | undefined;
  /** relative to parent */
  at: Vec2;
  /** absolute grid position */
  abs: Vec2;
  size: Vec2;
  pinned: boolean;
}

export type Placement = Map<string, Placed>;

/** ELK works in "pixels"; one grid cell = U px. */
const U = 20;

interface Rect {
  x: number;
  y: number;
  w: number;
  d: number;
}

const intersects = (a: Rect, b: Rect, gap: number) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.d + gap && b.y < a.y + a.d + gap;

/** Candidate offsets ordered by distance, then y, then x — deterministic. Built once. */
const SPIRAL: readonly Vec2[] = (() => {
  const r = 64;
  const offsets: Vec2[] = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) offsets.push([dx, dy]);
  return offsets.sort(
    (a, b) => a[0] ** 2 + a[1] ** 2 - (b[0] ** 2 + b[1] ** 2) || a[1] - b[1] || a[0] - b[0],
  );
})();

interface Node {
  id: string;
  kind: "group" | "resource";
  parent: string | undefined;
  at: Vec2 | undefined;
  size: Vec2 | undefined;
  path: DocPath;
}

export async function placeNodes(
  model: Model,
  sm: SourceMap,
): Promise<{ placement: Placement; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [];
  const { spacing, groupPadding: pad } = model.settings;
  const nodes: Node[] = [
    ...model.groups.map((g) => ({
      id: g.id,
      kind: "group" as const,
      parent: g.parent,
      at: g.at,
      size: g.size,
      path: g.path,
    })),
    ...model.resources.map((r) => ({
      id: r.id,
      kind: "resource" as const,
      parent: r.parent,
      at: r.at,
      size: r.size,
      path: r.path,
    })),
  ];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string | undefined, Node[]>();
  for (const n of nodes) {
    const list = children.get(n.parent) ?? [];
    list.push(n);
    children.set(n.parent, list);
  }

  // ---- 1. ELK (only when needed) -------------------------------------------------
  const elkPos = new Map<string, Vec2>();
  if (nodes.some((n) => !n.at)) {
    try {
      await runElk(nodes, children, model, spacing, pad, elkPos);
    } catch (e) {
      diagnostics.push({
        severity: "error",
        code: "E_LAYOUT",
        message: `Automatic layout failed: ${(e as Error).message}`,
        path: [],
      });
    }
  }

  // ---- 2+3. Pin, snap, resolve bottom-up --------------------------------------------
  const placement: Placement = new Map();
  const autoSize = new Map<string, Vec2>();
  const sizeOf = (n: Node): Vec2 => n.size ?? autoSize.get(n.id) ?? [2 * pad + 1, 2 * pad + 1];

  const resolve = (parentId: string | undefined): void => {
    const kids = children.get(parentId) ?? [];
    for (const k of kids) if (k.kind === "group") resolve(k.id);

    const min = parentId === undefined ? 0 : pad;
    // Compact ELK's arrangement onto the grid. This uses every child's ELK position (pinned
    // ones too, at the slot ELK gave them), so pinning or moving a node never shifts the others.
    const target = compact(
      kids.flatMap((k) => {
        const e = elkPos.get(k.id);
        const [w, d] = sizeOf(k);
        return e ? [{ id: k.id, x: e[0], y: e[1], w, d }] : [];
      }),
      min,
      spacing,
      model.settings.direction === "right" || model.settings.direction === "left",
    );
    const occupied: (Rect & { id: string })[] = [];
    const place = (k: Node, at: Vec2, pinned: boolean) => {
      const size = sizeOf(k);
      occupied.push({ id: k.id, x: at[0], y: at[1], w: size[0], d: size[1] });
      placement.set(k.id, { id: k.id, kind: k.kind, parent: parentId, at, abs: at, size, pinned });
    };

    for (const k of kids) {
      if (!k.at) continue;
      const [w, d] = sizeOf(k);
      const other = occupied.find((o) =>
        intersects(o, { x: k.at?.[0] ?? 0, y: k.at?.[1] ?? 0, w, d }, 0),
      );
      if (other) {
        diagnostics.push({
          severity: "error",
          code: "E_FOOTPRINT_OVERLAP",
          message: `"${k.id}" overlaps "${other.id}"`,
          path: [...k.path, "at"],
          ...withRange(sm.value([...k.path, "at"])),
          hint: "Move one of them, or remove `at` to let layout place it.",
        });
      }
      place(k, k.at, true);
    }
    for (const k of kids) {
      if (k.at) continue;
      const [w, d] = sizeOf(k);
      const want: Vec2 = target.get(k.id) ?? [min, min];
      const base: Vec2 = [Math.max(min, want[0]), Math.max(min, want[1])];
      let found: Vec2 | undefined;
      for (const [dx, dy] of SPIRAL) {
        const x = base[0] + dx;
        const y = base[1] + dy;
        if (x < min || y < min) continue;
        if (!occupied.some((o) => intersects(o, { x, y, w, d }, 1))) {
          found = [x, y];
          break;
        }
      }
      place(k, found ?? base, false);
    }

    if (parentId !== undefined) {
      const g = byId.get(parentId) as Node;
      const needW = Math.max(0, ...occupied.map((o) => o.x + o.w)) + (occupied.length ? pad : 0);
      const needD = Math.max(0, ...occupied.map((o) => o.y + o.d)) + (occupied.length ? pad : 0);
      if (g.size) {
        if (needW - pad > g.size[0] || needD - pad > g.size[1]) {
          diagnostics.push({
            severity: "error",
            code: "E_GROUP_TOO_SMALL",
            message: `Group "${g.id}" (size ${g.size[0]}×${g.size[1]}) is too small for its contents (needs ${needW - pad}×${needD - pad})`,
            path: [...g.path, "size"],
            ...withRange(sm.value([...g.path, "size"])),
            hint: "Increase size, or remove it to fit the contents automatically.",
          });
        }
      } else {
        autoSize.set(parentId, [Math.max(needW, 2 * pad + 1), Math.max(needD, 2 * pad + 1)]);
      }
    }
  };
  resolve(undefined);

  // Absolute positions, top-down in document order (parents precede children after a sort).
  const depth = (n: Placed): number =>
    n.parent ? 1 + depth(placement.get(n.parent) as Placed) : 0;
  for (const p of [...placement.values()].sort((a, b) => depth(a) - depth(b))) {
    const parent = p.parent ? placement.get(p.parent) : undefined;
    p.abs = parent ? [parent.abs[0] + p.at[0], parent.abs[1] + p.at[1]] : p.at;
  }
  return { placement, diagnostics };
}

/**
 * Scanline compaction: keeps ELK's ordering but closes the gaps layered layout leaves
 * (e.g. groups arranged diagonally). Along the flow axis first, then across it; each node
 * moves as close to the origin as `gap` from every node it shares a row/column with allows.
 * The result never overlaps.
 */
export function compact(
  items: readonly (Rect & { id: string })[],
  min: number,
  gap: number,
  xFirst: boolean,
): Map<string, Vec2> {
  const pos = new Map(items.map((it) => [it.id, { ...it }]));
  const pass = (axis: "x" | "y") => {
    const other = axis === "x" ? "y" : "x";
    const len = axis === "x" ? "w" : "d";
    const olen = axis === "x" ? "d" : "w";
    const order = [...pos.values()]
      .map((r, i) => ({ r, i }))
      .sort((a, b) => a.r[axis] - b.r[axis] || a.r[other] - b.r[other] || a.i - b.i)
      .map((o) => o.r);
    const done: (Rect & { id: string })[] = [];
    for (const r of order) {
      let v = min;
      for (const p of done) {
        if (r[other] < p[other] + p[olen] + gap && p[other] < r[other] + r[olen] + gap)
          v = Math.max(v, p[axis] + p[len] + gap);
      }
      r[axis] = v;
      done.push(r);
    }
  };
  pass(xFirst ? "x" : "y");
  pass(xFirst ? "y" : "x");
  return new Map([...pos].map(([id, r]) => [id, [r.x, r.y] as Vec2]));
}

async function runElk(
  nodes: Node[],
  children: Map<string | undefined, Node[]>,
  model: Model,
  spacing: number,
  pad: number,
  out: Map<string, Vec2>,
) {
  const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
  const elk = new ELK();
  const toElk = (n: Node): ElkNode => {
    const kids = children.get(n.id) ?? [];
    if (n.kind === "group" && kids.length > 0) {
      const p = pad * U;
      return {
        id: n.id,
        children: kids.map(toElk),
        layoutOptions: { "elk.padding": `[top=${p},left=${p},bottom=${p},right=${p}]` },
      };
    }
    const [w, d] = n.size ?? [2 * pad + 1, 2 * pad + 1];
    return { id: n.id, width: w * U, height: d * U };
  };
  const resourceIds = new Set(nodes.filter((n) => n.kind === "resource").map((n) => n.id));
  const large = resourceIds.size > 120;
  const graph: ElkNode = {
    id: "__root__",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": model.settings.direction.toUpperCase(),
      "elk.hierarchyHandling": large ? "SEPARATE_CHILDREN" : "INCLUDE_CHILDREN",
      "elk.spacing.nodeNode": String(spacing * U),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(spacing * U),
      "elk.spacing.componentComponent": String(spacing * U),
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    },
    children: (children.get(undefined) ?? []).map(toElk),
    // Edges between resources only: ELK rejects some edges that end on compound nodes.
    edges: model.links
      .filter((l) => resourceIds.has(l.from) && resourceIds.has(l.to) && l.from !== l.to)
      .map((l, i) => ({ id: `e${i}`, sources: [l.from], targets: [l.to] })),
  };
  const laid = await elk.layout(graph);
  const walk = (n: ElkNode) => {
    for (const c of n.children ?? []) {
      out.set(c.id, [Math.round((c.x ?? 0) / U), Math.round((c.y ?? 0) / U)]);
      walk(c);
    }
  };
  walk(laid);
}
