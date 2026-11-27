/**
 * Spike C — isometric projection, view rotation and solid depth-sorting (PLAN.md §6.3).
 *
 * Grid space: x and y on the ground plane (cells), z up. Projection (true isometric):
 *   sx = (x − y)·cos30°,   sy = (x + y)·sin30° − z
 * so larger x+y is nearer the viewer (lower on screen). The view ray towards the viewer
 * is (1, 1, 1) in grid space.
 */

export interface Box {
  id: string;
  x: number;
  y: number;
  /** footprint size along x */
  w: number;
  /** footprint size along y */
  d: number;
  /** height */
  h: number;
}

export type Rotation = 0 | 90 | 180 | 270;

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;

export function project(x: number, y: number, z = 0): [number, number] {
  return [(x - y) * COS30, (x + y) * SIN30 - z];
}

/** Rotate a footprint about the origin (clockwise as seen from above). */
export function rotateBox(b: Box, r: Rotation): Box {
  switch (r) {
    case 0:
      return b;
    case 90:
      return { ...b, x: -(b.y + b.d), y: b.x, w: b.d, d: b.w };
    case 180:
      return { ...b, x: -(b.x + b.w), y: -(b.y + b.d) };
    case 270:
      return { ...b, x: b.y, y: -(b.x + b.w), w: b.d, d: b.w };
  }
}

/** Screen-space bounds of the projected box (hexagon's bounding rect). */
export function screenBounds(b: Box) {
  const xs = (b.x - (b.y + b.d)) * COS30;
  const xe = (b.x + b.w - b.y) * COS30;
  const ys = (b.x + b.y) * SIN30 - b.h;
  const ye = (b.x + b.w + b.y + b.d) * SIN30;
  return { minX: xs, maxX: xe, minY: ys, maxY: ye };
}

const EPS = 1e-9;

function screenOverlap(a: Box, b: Box): boolean {
  const A = screenBounds(a);
  const B = screenBounds(b);
  return (
    A.minX < B.maxX - EPS && B.minX < A.maxX - EPS && A.minY < B.maxY - EPS && B.minY < A.maxY - EPS
  );
}

/** True if `a` must be painted before `b`. Valid for disjoint footprints on the ground. */
export function isBehind(a: Box, b: Box): boolean {
  return a.x + a.w <= b.x + EPS || a.y + a.d <= b.y + EPS;
}

export function footprintsOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.d && b.y < a.y + a.d;
}

/**
 * Painter's order (back to front). Only pairs that overlap on screen are constrained;
 * a stable Kahn's algorithm keyed on (x+y, input order) keeps output deterministic.
 * Throws if footprints overlap or (should be impossible) a cycle is found.
 */
export function depthSort(input: readonly Box[], rotation: Rotation = 0): Box[] {
  const boxes = input.map((b) => rotateBox(b, rotation));
  const n = boxes.length;
  const after: number[][] = Array.from({ length: n }, () => []);
  const indeg = new Array<number>(n).fill(0);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = boxes[i] as Box;
      const b = boxes[j] as Box;
      if (footprintsOverlap(a, b)) throw new Error(`footprints overlap: ${a.id}, ${b.id}`);
      if (!screenOverlap(a, b)) continue;
      const [first, second] = isBehind(a, b) ? [i, j] : [j, i];
      after[first]?.push(second);
      indeg[second] = (indeg[second] ?? 0) + 1;
    }
  }

  const key = (i: number) => {
    const b = boxes[i] as Box;
    return b.x + b.y + (b.w + b.d) / 2;
  };
  const ready = boxes.map((_, i) => i).filter((i) => indeg[i] === 0);
  const out: Box[] = [];
  while (ready.length > 0) {
    ready.sort((p, q) => key(p) - key(q) || p - q);
    const i = ready.shift() as number;
    out.push(boxes[i] as Box);
    for (const j of after[i] ?? []) {
      indeg[j] = (indeg[j] ?? 0) - 1;
      if (indeg[j] === 0) ready.push(j);
    }
  }
  if (out.length !== n) throw new Error("depth cycle detected");
  return out;
}

/**
 * Ground truth for tests: cast the view ray through screen point (sx, sy) and return the
 * id of the visible box (largest exit t along (1,1,1)), or undefined. Also returns the
 * gap to the runner-up so tests can skip ambiguous edge hits.
 */
export function rayCastVisible(
  boxes: readonly Box[],
  sx: number,
  sy: number,
): { id: string | undefined; margin: number } {
  // Base point on z=0 with the given screen position.
  const a = sx / COS30; // x − y
  const s = sy / SIN30; // x + y
  const p: readonly number[] = [(a + s) / 2, (s - a) / 2, 0];
  let best: { id: string; t: number } | undefined;
  let second = -Infinity;
  for (const b of boxes) {
    const lo = [b.x, b.y, 0];
    const hi = [b.x + b.w, b.y + b.d, b.h];
    let tmin = -Infinity;
    let tmax = Infinity;
    for (let k = 0; k < 3; k++) {
      const t1 = (lo[k] as number) - (p[k] as number);
      const t2 = (hi[k] as number) - (p[k] as number);
      tmin = Math.max(tmin, Math.min(t1, t2));
      tmax = Math.min(tmax, Math.max(t1, t2));
    }
    if (tmax <= tmin + EPS) continue;
    if (!best || tmax > best.t) {
      if (best) second = best.t;
      best = { id: b.id, t: tmax };
    } else second = Math.max(second, tmax);
  }
  return { id: best?.id, margin: best ? best.t - second : Infinity };
}

/** Which box a painter sees at a screen point, given an order (last drawn covering wins). */
export function painterVisible(order: readonly Box[], sx: number, sy: number): string | undefined {
  let seen: string | undefined;
  for (const b of order) if (rayCastVisible([b], sx, sy).id) seen = b.id;
  return seen;
}
