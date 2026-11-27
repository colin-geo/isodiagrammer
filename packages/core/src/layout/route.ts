/**
 * Stage 4b (PLAN.md §6.2): link routing on the ground plane, in view-frame grid coordinates.
 *
 * Orthogonal links are routed with A* over cell centres (lanes run through the middle of
 * grid cells, half a cell clear of any footprint):
 * - solid footprints are obstacles; groups and planes are not;
 * - floor hidden behind a solid (from the viewer's side) costs extra, so links prefer lanes
 *   you can see;
 * - each bend costs extra, and so does sharing a lane with an earlier link (crossing one
 *   costs a little), which spreads parallel links into separate lanes;
 * - arrowheads into a solid always land on a visible front side (`right` or `left`).
 * `via` waypoints are routed segment by segment; `fromSide`/`toSide` restrict the ports.
 * If A* can't find a way (e.g. a node walled in), the simple M1 router is the fallback.
 */
import type { LinkModel, Rotation, Side, Vec2 } from "../resolve/resolve.ts";
import { rotateRect } from "../scene/iso.ts";
import type { Placement } from "./place.ts";

export interface RoutedLink {
  link: LinkModel;
  points: Vec2[];
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Cost model (one unit = one cell of length). */
export const COST = {
  turn: 2,
  /** per cell hidden behind a solid */
  hidden: 2,
  /** per cell shared with an earlier link running the same way */
  overlap: 3,
  /** per cell where an earlier link crosses */
  cross: 1,
  /** leaving a solid from a back side */
  backPort: 2,
  /** per cell a port is away from the middle of its side */
  offCentre: 0.5,
  /** a port already used by an earlier link */
  sharedPort: 3,
  /** turning on the last half-cell into a port: the arrowhead would sit on the corner */
  lateTurn: 3,
  /** per cell under a group label */
  label: 3,
} as const;

/** Grid margin around the diagram, in cells, so routes can go round the outside. */
const MARGIN = 4;

const centre = (b: Box): Vec2 => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];

/** Point where the ray from the box centre towards `to` leaves the box. */
function exitPoint(b: Box, to: Vec2): Vec2 {
  const [cx, cy] = centre(b);
  const dx = to[0] - cx;
  const dy = to[1] - cy;
  const tx = dx === 0 ? Infinity : ((dx > 0 ? b.x1 : b.x0) - cx) / dx;
  const ty = dy === 0 ? Infinity : ((dy > 0 ? b.y1 : b.y0) - cy) / dy;
  const t = Math.min(tx, ty);
  return Number.isFinite(t) ? [cx + dx * t, cy + dy * t] : [cx, cy];
}

const contains = (o: Box, i: Box) => o.x0 <= i.x0 && o.y0 <= i.y0 && o.x1 >= i.x1 && o.y1 >= i.y1;

const pathLength = (pts: readonly Vec2[]) =>
  pts
    .slice(1)
    .reduce(
      (sum, p, i) => sum + Math.hypot(p[0] - (pts[i] as Vec2)[0], p[1] - (pts[i] as Vec2)[1]),
      0,
    );

// ---- directions and sides ------------------------------------------------------------

/** 0 = +x, 1 = +y, 2 = −x, 3 = −y */
type Dir = 0 | 1 | 2 | 3;
const DX = [1, 0, -1, 0] as const;
const DY = [0, 1, 0, -1] as const;
const horizontal = (d: Dir) => d % 2 === 0;

/**
 * Sides are named as they look on screen in the view frame: `right` is the x1 edge (the
 * visible right face), `left` the y1 edge (the visible left face), `back-left` x0, `back-right` y0.
 */
const SIDE_DIR: Record<Side, Dir> = { right: 0, left: 1, "back-left": 2, "back-right": 3 };
const ALL_SIDES: readonly Side[] = ["right", "left", "back-left", "back-right"];
const FRONT_SIDES: readonly Side[] = ["right", "left"];

interface Port {
  /** the cell just outside the side */
  cx: number;
  cy: number;
  /** outward direction */
  dir: Dir;
  /** where the line meets the footprint */
  point: Vec2;
  cost: number;
  key: string;
}

function portsOf(
  id: string,
  b: Box,
  sides: readonly Side[],
  solid: boolean,
  used: Map<string, number>,
): Port[] {
  const out: Port[] = [];
  for (const side of sides) {
    const dir = SIDE_DIR[side];
    const alongX = dir % 2 === 1; // left/back-right run along x
    const lo = alongX ? b.x0 : b.y0;
    const hi = alongX ? b.x1 : b.y1;
    const mid = (lo + hi) / 2;
    for (let k = lo; k < hi; k++) {
      let cx: number;
      let cy: number;
      let point: Vec2;
      switch (dir) {
        case 0:
          [cx, cy, point] = [b.x1, k, [b.x1, k + 0.5]];
          break;
        case 1:
          [cx, cy, point] = [k, b.y1, [k + 0.5, b.y1]];
          break;
        case 2:
          [cx, cy, point] = [b.x0 - 1, k, [b.x0, k + 0.5]];
          break;
        default:
          [cx, cy, point] = [k, b.y0 - 1, [k + 0.5, b.y0]];
      }
      const key = `${id}:${side}:${k}`;
      const cost =
        Math.abs(k + 0.5 - mid) * COST.offCentre +
        (solid && dir >= 2 ? COST.backPort : 0) +
        (used.get(key) ?? 0) * COST.sharedPort;
      out.push({ cx, cy, dir: dir as Dir, point, cost, key });
    }
  }
  return out;
}

// ---- the routing grid ------------------------------------------------------------------

class Grid {
  readonly x0: number;
  readonly y0: number;
  readonly w: number;
  readonly h: number;
  readonly blocked: Uint8Array;
  /** extra cost of entering a cell: hidden behind a solid, or under a label */
  readonly hidden: Float32Array;
  readonly usedH: Uint16Array;
  readonly usedV: Uint16Array;

  constructor(
    bounds: Box,
    solids: readonly (Box & { height: number })[],
    avoid: readonly Box[] = [],
  ) {
    this.x0 = bounds.x0 - MARGIN;
    this.y0 = bounds.y0 - MARGIN;
    this.w = bounds.x1 - bounds.x0 + 2 * MARGIN;
    this.h = bounds.y1 - bounds.y0 + 2 * MARGIN;
    const n = this.w * this.h;
    this.blocked = new Uint8Array(n);
    this.hidden = new Float32Array(n);
    this.usedH = new Uint16Array(n);
    this.usedV = new Uint16Array(n);
    for (const s of solids) {
      for (let y = s.y0; y < s.y1; y++)
        for (let x = s.x0; x < s.x1; x++) {
          const i = this.index(x, y);
          if (i >= 0) this.blocked[i] = 1;
        }
      // Floor point (px, py, 0) is hidden if the line of sight (px+t, py+t, t), t > 0, enters
      // the box. Only cells up to `height` behind the box can be affected.
      const reach = Math.ceil(s.height);
      for (let y = s.y0 - reach; y < s.y1; y++)
        for (let x = s.x0 - reach; x < s.x1; x++) {
          const i = this.index(x, y);
          if (i < 0 || this.blocked[i]) continue;
          const px = x + 0.5;
          const py = y + 0.5;
          const lo = Math.max(s.x0 - px, s.y0 - py, 0);
          const hi = Math.min(s.x1 - px, s.y1 - py, s.height);
          if (hi > lo) this.hidden[i] = COST.hidden;
        }
    }
    for (const a of avoid)
      for (let y = a.y0; y < a.y1; y++)
        for (let x = a.x0; x < a.x1; x++) {
          const i = this.index(x, y);
          if (i >= 0) this.hidden[i] = Math.max(this.hidden[i] ?? 0, COST.label);
        }
  }

  /** −1 if outside */
  index(x: number, y: number): number {
    const ix = x - this.x0;
    const iy = y - this.y0;
    if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h) return -1;
    return iy * this.w + ix;
  }

  cell(i: number): Vec2 {
    return [(i % this.w) + this.x0, Math.floor(i / this.w) + this.y0];
  }
}

/** Binary min-heap of [priority, tiebreak, value]. Ties break by insertion order: deterministic. */
class Heap {
  private items: [number, number, number][] = [];
  private seq = 0;
  get size() {
    return this.items.length;
  }
  push(p: number, v: number) {
    const a = this.items;
    a.push([p, this.seq++, v]);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!less(a[i], a[parent])) break;
      [a[i], a[parent]] = [a[parent] as [number, number, number], a[i] as [number, number, number]];
      i = parent;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0] as [number, number, number];
    const last = a.pop() as [number, number, number];
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && less(a[l], a[m])) m = l;
        if (r < a.length && less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m] as [number, number, number], a[i] as [number, number, number]];
        i = m;
      }
    }
    return top[2];
  }
}
const less = (a: [number, number, number] | undefined, b: [number, number, number] | undefined) =>
  (a as [number, number, number])[0] < (b as [number, number, number])[0] ||
  ((a as [number, number, number])[0] === (b as [number, number, number])[0] &&
    (a as [number, number, number])[1] < (b as [number, number, number])[1]);

interface Start {
  cell: number;
  dir: Dir;
  cost: number;
}
interface Goal {
  /** required arrival direction (a turn is charged otherwise); undefined = any */
  dir: Dir | undefined;
  cost: number;
}

/**
 * Multi-source, multi-goal A* over (cell, direction) states. Returns the visited cells
 * (start → goal) and the final direction, or undefined if no route exists.
 */
function astar(
  grid: Grid,
  starts: readonly Start[],
  goals: ReadonlyMap<number, Goal>,
  passable: ReadonlySet<number>,
): { cells: number[]; dir: Dir } | undefined {
  if (starts.length === 0 || goals.size === 0) return undefined;
  const n = grid.w * grid.h * 4;
  const DONE = n;
  const g = new Float64Array(n + 1).fill(Infinity);
  const from = new Int32Array(n + 1).fill(-1);
  const closed = new Uint8Array(n + 1);

  // Heuristic: Manhattan distance to the bounding box of the goal cells (admissible).
  let gx0 = Infinity;
  let gy0 = Infinity;
  let gx1 = -Infinity;
  let gy1 = -Infinity;
  for (const c of goals.keys()) {
    const [x, y] = grid.cell(c);
    gx0 = Math.min(gx0, x);
    gy0 = Math.min(gy0, y);
    gx1 = Math.max(gx1, x);
    gy1 = Math.max(gy1, y);
  }
  const hOf = (c: number) => {
    const [x, y] = grid.cell(c);
    return Math.max(gx0 - x, 0, x - gx1) + Math.max(gy0 - y, 0, y - gy1);
  };

  const heap = new Heap();
  for (const s of starts) {
    const st = s.cell * 4 + s.dir;
    const cost = s.cost + (grid.hidden[s.cell] ?? 0);
    if (cost < (g[st] as number)) {
      g[st] = cost;
      heap.push(cost + hOf(s.cell), st);
    }
  }
  const open = (c: number) => c >= 0 && (!grid.blocked[c] || passable.has(c));

  while (heap.size > 0) {
    const st = heap.pop();
    if (closed[st]) continue;
    closed[st] = 1;
    if (st === DONE) {
      const cells: number[] = [];
      let cur = from[DONE] as number;
      const dir = (cur % 4) as Dir;
      while (cur !== -1) {
        cells.push(Math.floor(cur / 4));
        cur = from[cur] as number;
      }
      return { cells: cells.reverse(), dir };
    }
    const c = Math.floor(st / 4);
    const d = (st % 4) as Dir;
    const gc = g[st] as number;

    const goal = goals.get(c);
    if (goal) {
      const done = gc + goal.cost + (goal.dir !== undefined && goal.dir !== d ? COST.lateTurn : 0);
      if (done < (g[DONE] as number)) {
        g[DONE] = done;
        from[DONE] = st;
        heap.push(done, DONE);
      }
    }

    const [x, y] = grid.cell(c);
    for (const nd of [0, 1, 2, 3] as Dir[]) {
      if (nd === (d + 2) % 4) continue; // no U-turns on the spot
      const nc = grid.index(x + DX[nd], y + DY[nd]);
      if (!open(nc)) continue;
      const usedSame = horizontal(nd) ? grid.usedH[nc] : grid.usedV[nc];
      const usedCross = horizontal(nd) ? grid.usedV[nc] : grid.usedH[nc];
      const cost =
        gc +
        1 +
        (nd !== d ? COST.turn : 0) +
        (grid.hidden[nc] ?? 0) +
        (usedSame ?? 0) * COST.overlap +
        (usedCross ?? 0) * COST.cross;
      const ns = nc * 4 + nd;
      if (cost < (g[ns] as number)) {
        g[ns] = cost;
        from[ns] = st;
        heap.push(cost + hOf(nc), ns);
      }
    }
  }
  return undefined;
}

/** Drop interior points that are collinear with their neighbours. */
function simplify(pts: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of pts) {
    const a = out.at(-2);
    const b = out.at(-1);
    if (b && b[0] === p[0] && b[1] === p[1]) continue;
    if (a && b && ((a[0] === b[0] && b[0] === p[0]) || (a[1] === b[1] && b[1] === p[1])))
      out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

// ---- M1 fallback router ------------------------------------------------------------------

/**
 * Simple I/L-shaped orthogonal route in the VIEW frame, where +x and +y faces (x1, y1 edges)
 * face the viewer. When the target is in front of the source the route wraps round the side
 * of the target instead of disappearing under it.
 */
function simpleOrthogonal(a: Box, b: Box, targetSolid: boolean): Vec2[] {
  const [ax, ay] = centre(a);
  const [bx, by] = centre(b);
  const G = 1;
  const wrapX = (): Vec2[] => {
    const X = Math.max(a.x1, b.x1) + G;
    return [
      [a.x1, ay],
      [X, ay],
      [X, by],
      [b.x1, by],
    ];
  };
  const wrapY = (): Vec2[] => {
    const Y = Math.max(a.y1, b.y1) + G;
    return [
      [ax, a.y1],
      [ax, Y],
      [bx, Y],
      [bx, b.y1],
    ];
  };
  const ox0 = Math.max(a.x0, b.x0);
  const ox1 = Math.min(a.x1, b.x1);
  if (ox1 > ox0) {
    const x = (ox0 + ox1) / 2;
    if (b.y1 <= a.y0)
      return [
        [x, a.y0],
        [x, b.y1],
      ];
    return targetSolid
      ? wrapX()
      : [
          [x, a.y1],
          [x, b.y0],
        ];
  }
  const oy0 = Math.max(a.y0, b.y0);
  const oy1 = Math.min(a.y1, b.y1);
  if (oy1 > oy0) {
    const y = (oy0 + oy1) / 2;
    if (b.x1 <= a.x0)
      return [
        [a.x0, y],
        [b.x1, y],
      ];
    return targetSolid
      ? wrapY()
      : [
          [a.x1, y],
          [b.x0, y],
        ];
  }
  const right = bx > ax;
  const down = by > ay;
  const xThenY: Vec2[] = [
    [right ? a.x1 : a.x0, ay],
    [bx, ay],
    [bx, down ? b.y0 : b.y1],
  ];
  const yThenX: Vec2[] = [
    [ax, down ? a.y1 : a.y0],
    [ax, by],
    [right ? b.x0 : b.x1, by],
  ];
  if (!down || !targetSolid) return xThenY;
  if (!right) return yThenX;
  const wx = wrapX();
  const wy = wrapY();
  return pathLength(wx) <= pathLength(wy) ? wx : wy;
}

// ---- entry point ---------------------------------------------------------------------------

/**
 * Route every link, in document order (earlier links get first pick of lanes). Returned
 * points are view-frame grid coordinates. `heightOf` gives a node's solid height (0 = not
 * an obstacle: groups and planes). `avoid` lists view-frame cell rectangles (e.g. group
 * labels) that routes should stay off where they can.
 */
export function routeLinks(
  links: readonly LinkModel[],
  placement: Placement,
  rotation: Rotation,
  heightOf: (id: string) => number,
  avoid: readonly { x: number; y: number; w: number; d: number }[] = [],
): RoutedLink[] {
  const boxOf = (p: { abs: Vec2; size: Vec2 }): Box => {
    const r = rotateRect({ x: p.abs[0], y: p.abs[1], w: p.size[0], d: p.size[1] }, rotation);
    return { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.d };
  };
  const boxes = new Map([...placement.values()].map((p) => [p.id, boxOf(p)]));
  const bounds: Box = { x0: 0, y0: 0, x1: 1, y1: 1 };
  let first = true;
  for (const b of boxes.values()) {
    if (first) Object.assign(bounds, b);
    first = false;
    bounds.x0 = Math.min(bounds.x0, b.x0);
    bounds.y0 = Math.min(bounds.y0, b.y0);
    bounds.x1 = Math.max(bounds.x1, b.x1);
    bounds.y1 = Math.max(bounds.y1, b.y1);
  }
  const viaCells = (l: LinkModel): Vec2[] =>
    l.via.map(([x, y]) => {
      const r = rotateRect({ x, y, w: 1, d: 1 }, rotation);
      return [r.x, r.y];
    });
  for (const l of links)
    for (const [x, y] of viaCells(l)) {
      bounds.x0 = Math.min(bounds.x0, x);
      bounds.y0 = Math.min(bounds.y0, y);
      bounds.x1 = Math.max(bounds.x1, x + 1);
      bounds.y1 = Math.max(bounds.y1, y + 1);
    }

  const solids = [...placement.values()]
    .filter((p) => heightOf(p.id) > 0)
    .map((p) => ({ ...(boxes.get(p.id) as Box), height: heightOf(p.id) }));
  const grid = new Grid(
    bounds,
    solids,
    avoid.map((r) => ({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.d })),
  );
  const usedPorts = new Map<string, number>();

  const out: RoutedLink[] = [];
  for (const link of links) {
    const a = boxes.get(link.from);
    const b = boxes.get(link.to);
    if (!a || !b || link.from === link.to) continue;
    const fromSolid = heightOf(link.from) > 0;
    const toSolid = heightOf(link.to) > 0;
    let points: Vec2[];
    if (contains(a, b) || contains(b, a)) {
      // Resource ↔ its own group: short stub from the inner box towards the outer edge.
      const inner = contains(a, b) ? b : a;
      const outer = inner === a ? b : a;
      const [cx] = centre(inner);
      const p0 = exitPoint(inner, [cx, outer.y1]);
      points = inner === a ? [p0, [cx, outer.y1]] : [[cx, outer.y1], p0];
    } else if (link.route === "straight") {
      points = [exitPoint(a, centre(b)), exitPoint(b, centre(a))];
    } else {
      const fromSides = link.fromSide ? [link.fromSide] : ALL_SIDES;
      // A start arrowhead on a solid source must be visible too.
      const startArrow = link.arrow === "start" || link.arrow === "both";
      const endArrow = link.arrow === "end" || link.arrow === "both";
      const srcSides = link.fromSide
        ? fromSides
        : startArrow && fromSolid
          ? FRONT_SIDES
          : ALL_SIDES;
      const dstSides = link.toSide ? [link.toSide] : endArrow && toSolid ? FRONT_SIDES : ALL_SIDES;
      const routed = routeAStar(
        grid,
        portsOf(link.from, a, srcSides, fromSolid, usedPorts),
        portsOf(link.to, b, dstSides, toSolid, usedPorts),
        viaCells(link),
      );
      if (routed) {
        points = routed.points;
        for (const k of routed.ports) usedPorts.set(k, (usedPorts.get(k) ?? 0) + 1);
        markUsed(grid, routed.cells);
      } else {
        points = simpleOrthogonal(a, b, toSolid);
      }
    }
    out.push({ link, points });
  }
  return out;
}

function routeAStar(
  grid: Grid,
  src: Port[],
  dst: Port[],
  via: Vec2[],
): { points: Vec2[]; cells: number[]; ports: string[] } | undefined {
  const srcOk = src.filter((p) => {
    const i = grid.index(p.cx, p.cy);
    return i >= 0 && !grid.blocked[i];
  });
  const dstOk = dst.filter((p) => {
    const i = grid.index(p.cx, p.cy);
    return i >= 0 && !grid.blocked[i];
  });
  const viaIdx = via.map(([x, y]) => grid.index(x, y)).filter((i) => i >= 0);
  const passable = new Set(viaIdx);

  let starts: Start[] = srcOk.map((p) => ({
    cell: grid.index(p.cx, p.cy),
    dir: p.dir,
    cost: p.cost,
  }));
  const cells: number[] = [];
  for (const v of viaIdx) {
    const leg = astar(grid, starts, new Map([[v, { dir: undefined, cost: 0 }]]), passable);
    if (!leg) return undefined;
    cells.push(...(cells.length ? leg.cells.slice(1) : leg.cells));
    starts = [{ cell: v, dir: leg.dir, cost: 0 }];
  }
  const goals = new Map<number, Goal>();
  for (const p of dstOk) {
    const i = grid.index(p.cx, p.cy);
    const inward = ((p.dir + 2) % 4) as Dir;
    const prev = goals.get(i);
    // A corner cell can serve two sides: keep the cheaper port.
    if (!prev || p.cost < prev.cost) goals.set(i, { dir: inward, cost: p.cost });
  }
  const last = astar(grid, starts, goals, passable);
  if (!last) return undefined;
  cells.push(...(cells.length ? last.cells.slice(1) : last.cells));

  const firstCell = cells[0] as number;
  const lastCell = cells.at(-1) as number;
  const firstDir = cells.length > 1 ? undefined : last.dir;
  const sp = pickPort(grid, srcOk, firstCell, (p) =>
    firstDir === undefined ? true : p.dir === firstDir,
  );
  const dp = pickPort(grid, dstOk, lastCell, (p) => (p.dir + 2) % 4 === last.dir);
  if (!sp || !dp) return undefined;
  const centres = cells.map((c) => {
    const [x, y] = grid.cell(c);
    return [x + 0.5, y + 0.5] as Vec2;
  });
  return {
    points: simplify([sp.point, ...centres, dp.point]),
    cells,
    ports: [sp.key, dp.key],
  };
}

/** The port for `cell`, preferring one that matches the travel direction, then the cheapest. */
function pickPort(
  grid: Grid,
  ports: readonly Port[],
  cell: number,
  prefer: (p: Port) => boolean,
): Port | undefined {
  const here = ports.filter((p) => grid.index(p.cx, p.cy) === cell);
  const best = (ps: Port[]) => [...ps].sort((a, b) => a.cost - b.cost)[0];
  return best(here.filter(prefer)) ?? best(here);
}

function markUsed(grid: Grid, cells: readonly number[]) {
  for (let i = 1; i < cells.length; i++) {
    const a = cells[i - 1] as number;
    const b = cells[i] as number;
    const h = Math.abs(a - b) === 1;
    const arr = h ? grid.usedH : grid.usedV;
    arr[a] = (arr[a] ?? 0) + 1;
    arr[b] = (arr[b] ?? 0) + 1;
  }
  if (cells.length === 1) {
    const c = cells[0] as number;
    grid.usedH[c] = (grid.usedH[c] ?? 0) + 1;
  }
}
