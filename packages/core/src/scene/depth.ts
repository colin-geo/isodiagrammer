/**
 * Painter's order for solids on the ground plane (PLAN.md §6.3), proven in M0 Spike C.
 *
 * A is behind B if A.maxX ≤ B.minX or A.maxY ≤ B.minY (view frame). Only pairs that
 * overlap on screen are constrained; Kahn's algorithm keyed on centre depth then input
 * order keeps output deterministic. Never throws: overlapping footprints (already
 * reported as diagnostics) fall back to centre depth, and any cycle is broken.
 */
import { COS30, type Rect, SIN30 } from "./iso.ts";

export interface DepthBox extends Rect {
  h: number;
}

const EPS = 1e-9;

export function screenBounds(b: DepthBox) {
  return {
    minX: (b.x - (b.y + b.d)) * COS30,
    maxX: (b.x + b.w - b.y) * COS30,
    minY: (b.x + b.y) * SIN30 - b.h,
    maxY: (b.x + b.w + b.y + b.d) * SIN30,
  };
}

const screenOverlap = (a: DepthBox, b: DepthBox) => {
  const A = screenBounds(a);
  const B = screenBounds(b);
  return (
    A.minX < B.maxX - EPS && B.minX < A.maxX - EPS && A.minY < B.maxY - EPS && B.minY < A.maxY - EPS
  );
};

export const footprintsOverlap = (a: Rect, b: Rect) =>
  a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.d - EPS && b.y < a.y + a.d - EPS;

const centre = (b: Rect) => b.x + b.y + (b.w + b.d) / 2;

/** Returns indices into `boxes`, back to front. */
export function depthOrder(boxes: readonly DepthBox[]): number[] {
  const n = boxes.length;
  const after: number[][] = Array.from({ length: n }, () => []);
  const indeg = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = boxes[i] as DepthBox;
      const b = boxes[j] as DepthBox;
      if (!screenOverlap(a, b)) continue;
      let iFirst: boolean;
      if (footprintsOverlap(a, b)) iFirst = centre(a) <= centre(b);
      else iFirst = a.x + a.w <= b.x + EPS || a.y + a.d <= b.y + EPS;
      const [first, second] = iFirst ? [i, j] : [j, i];
      after[first]?.push(second);
      indeg[second] = (indeg[second] ?? 0) + 1;
    }
  }
  const key = (i: number) => centre(boxes[i] as DepthBox);
  const done = new Array<boolean>(n).fill(false);
  const out: number[] = [];
  const ready = boxes.map((_, i) => i).filter((i) => indeg[i] === 0);
  while (out.length < n) {
    if (ready.length === 0) {
      // Only reachable with overlapping footprints: break the cycle at the backmost node.
      const rest = boxes.map((_, i) => i).filter((i) => !done[i]);
      ready.push(rest.sort((p, q) => key(p) - key(q) || p - q)[0] as number);
    }
    ready.sort((p, q) => key(p) - key(q) || p - q);
    const i = ready.shift() as number;
    if (done[i]) continue;
    done[i] = true;
    out.push(i);
    for (const j of after[i] ?? []) {
      indeg[j] = (indeg[j] ?? 0) - 1;
      if (indeg[j] === 0 && !done[j]) ready.push(j);
    }
  }
  return out;
}
