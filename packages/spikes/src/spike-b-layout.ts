/**
 * Spike B — ELK compound layout snapped to the cell grid, with pinned nodes (PLAN.md §6.1).
 *
 * 1. ELK `layered` lays out the whole compound graph (groups = compound nodes).
 * 2. ELK coordinates are snapped to integer cells.
 * 3. Bottom-up, per parent: pinned children are placed exactly at `at`; unpinned children
 *    keep ELK's snapped position unless it collides, in which case a deterministic spiral
 *    search finds the nearest free cell. Group sizes are then recomputed from children,
 *    so the parent level resolves against *final* sizes.
 */
import ELK, { type ElkNode, type LayoutOptions } from "elkjs/lib/elk.bundled.js";

export type Vec2 = [number, number];
export type Direction = "east" | "south" | "west" | "north";

export interface LayoutNode {
  id: string;
  /** parent group id */
  in?: string;
  group?: boolean;
  /** footprint in cells — required for resources; optional for groups (auto-fit) */
  size?: Vec2;
  /** pinned position relative to parent */
  at?: Vec2;
}

export interface LayoutInput {
  /** in document order */
  nodes: LayoutNode[];
  edges: { from: string; to: string }[];
  direction?: Direction;
  /** cells between siblings / layers */
  spacing?: number;
  /** cells of padding inside groups */
  groupPadding?: number;
}

export interface Placed {
  id: string;
  parent: string | undefined;
  at: Vec2;
  abs: Vec2;
  size: Vec2;
  pinned: boolean;
  /** true if the ELK position collided and was nudged */
  nudged: boolean;
}

export interface LayoutResult {
  placed: Map<string, Placed>;
  warnings: string[];
}

/** ELK works in "pixels"; one grid cell = U px. */
const U = 20;

const ELK_DIRECTION: Record<Direction, string> = {
  east: "RIGHT",
  south: "DOWN",
  west: "LEFT",
  north: "UP",
};

const elk = new ELK();

interface Rect {
  x: number;
  y: number;
  w: number;
  d: number;
}

function intersects(a: Rect, b: Rect, gap: number): boolean {
  return (
    a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.d + gap && b.y < a.y + a.d + gap
  );
}

/** Candidate offsets ordered by distance, then y, then x — deterministic. Built once. */
const SPIRAL: readonly Vec2[] = (() => {
  const r = 64;
  const offsets: Vec2[] = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) offsets.push([dx, dy]);
  return offsets.sort(
    (a, b) => a[0] ** 2 + a[1] ** 2 - (b[0] ** 2 + b[1] ** 2) || a[1] - b[1] || a[0] - b[0],
  );
})();

export async function layout(input: LayoutInput): Promise<LayoutResult> {
  const spacing = input.spacing ?? 2;
  const pad = input.groupPadding ?? 1;
  const warnings: string[] = [];
  const byId = new Map(input.nodes.map((n) => [n.id, n]));
  const children = new Map<string | undefined, LayoutNode[]>();
  for (const n of input.nodes) {
    if (n.in !== undefined && !byId.get(n.in)?.group)
      throw new Error(`${n.id}: unknown group ${n.in}`);
    const list = children.get(n.in) ?? [];
    list.push(n);
    children.set(n.in, list);
  }

  // ---- 1. ELK ---------------------------------------------------------------
  const toElk = (n: LayoutNode): ElkNode => {
    const kids = children.get(n.id) ?? [];
    if (n.group && kids.length > 0) {
      return {
        id: n.id,
        children: kids.map(toElk),
        layoutOptions: {
          "elk.padding": `[top=${pad * U},left=${pad * U},bottom=${pad * U},right=${pad * U}]`,
        },
      };
    }
    const [w, d] = n.size ?? [2, 2];
    return { id: n.id, width: w * U, height: d * U };
  };

  const rootOptions: LayoutOptions = {
    "elk.algorithm": "layered",
    "elk.direction": ELK_DIRECTION[input.direction ?? "east"],
    "elk.hierarchyHandling": "INCLUDE_CHILDREN",
    "elk.spacing.nodeNode": String(spacing * U),
    "elk.layered.spacing.nodeNodeBetweenLayers": String(spacing * U),
    "elk.spacing.componentComponent": String(spacing * U),
    // Respect document order where ELK has a free choice: more stable, more predictable.
    "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  };
  const graph: ElkNode = {
    id: "__root__",
    layoutOptions: rootOptions,
    children: (children.get(undefined) ?? []).map(toElk),
    edges: input.edges.map((e, i) => ({ id: `e${i}`, sources: [e.from], targets: [e.to] })),
  };
  const laid = await elk.layout(graph);

  const elkPos = new Map<string, Vec2>();
  const walk = (n: ElkNode) => {
    for (const c of n.children ?? []) {
      elkPos.set(c.id, [Math.round((c.x ?? 0) / U), Math.round((c.y ?? 0) / U)]);
      walk(c);
    }
  };
  walk(laid);

  // ---- 2+3. Snap, pin, resolve collisions bottom-up --------------------------
  const placed = new Map<string, Placed>();

  const resolve = (parentId: string | undefined): void => {
    const kids = children.get(parentId) ?? [];
    for (const k of kids) if (k.group) resolve(k.id); // children first: final sizes known

    const min = parentId === undefined ? 0 : pad;
    const occupied: Rect[] = [];
    const place = (k: LayoutNode, at: Vec2, pinned: boolean, nudged: boolean) => {
      const size = sizeOf(k);
      occupied.push({ x: at[0], y: at[1], w: size[0], d: size[1] });
      placed.set(k.id, { id: k.id, parent: parentId, at, abs: at, size, pinned, nudged });
    };

    for (const k of kids.filter((k) => k.at)) {
      const at = k.at as Vec2;
      const r = { x: at[0], y: at[1], w: sizeOf(k)[0], d: sizeOf(k)[1] };
      if (occupied.some((o) => intersects(o, r, 0)))
        warnings.push(`${k.id}: pinned position overlaps a sibling`);
      place(k, at, true, false);
    }
    for (const k of kids.filter((k) => !k.at)) {
      const [w, d] = sizeOf(k);
      const want = elkPos.get(k.id) ?? [min, min];
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
      if (!found) throw new Error(`${k.id}: no free cell found`);
      place(k, found, false, found[0] !== want[0] || found[1] !== want[1]);
    }

    if (parentId !== undefined) {
      const g = byId.get(parentId) as LayoutNode;
      if (!g.size) {
        const w = Math.max(0, ...occupied.map((o) => o.x + o.w)) + pad;
        const d = Math.max(0, ...occupied.map((o) => o.y + o.d)) + pad;
        autoSize.set(parentId, [Math.max(w, 2 * pad + 1), Math.max(d, 2 * pad + 1)]);
      }
    }
  };

  const autoSize = new Map<string, Vec2>();
  const sizeOf = (n: LayoutNode): Vec2 => n.size ?? autoSize.get(n.id) ?? [2, 2];

  resolve(undefined);

  // Absolute positions, top-down (Map preserves insertion order; resolve() is post-order,
  // so iterate in document order instead).
  for (const n of input.nodes) {
    const p = placed.get(n.id) as Placed;
    const parent = p.parent ? (placed.get(p.parent) as Placed) : undefined;
    p.abs = parent ? [parent.abs[0] + p.at[0], parent.abs[1] + p.at[1]] : p.at;
  }
  return { placed, warnings };
}

/** Top-down ASCII view of a layout, for eyeballing results in tests and docs. */
export function renderAscii(result: LayoutResult): string {
  const all = [...result.placed.values()];
  const W = Math.max(...all.map((p) => p.abs[0] + p.size[0]));
  const H = Math.max(...all.map((p) => p.abs[1] + p.size[1]));
  const grid = Array.from({ length: H }, () => Array<string>(W).fill(" "));
  const depth = (p: Placed): number =>
    p.parent ? 1 + depth(result.placed.get(p.parent) as Placed) : 0;
  for (const p of [...all].sort((a, b) => depth(a) - depth(b))) {
    const [x0, y0] = p.abs;
    const [w, d] = p.size;
    const isLeaf = !all.some((c) => c.parent === p.id);
    for (let y = y0; y < y0 + d; y++)
      for (let x = x0; x < x0 + w; x++) {
        const row = grid[y] as string[];
        if (isLeaf) row[x] = p.pinned ? (p.id[0] as string).toUpperCase() : (p.id[0] as string);
        else row[x] = y === y0 || y === y0 + d - 1 || x === x0 || x === x0 + w - 1 ? "·" : " ";
      }
    if (!isLeaf) {
      const row = grid[y0] as string[];
      [...` ${p.id} `].forEach((ch, i) => {
        if (x0 + 1 + i < x0 + w - 1) row[x0 + 1 + i] = ch;
      });
    }
  }
  return grid.map((r) => r.join("").trimEnd()).join("\n");
}
