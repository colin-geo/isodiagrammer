/**
 * Isometric projection and view rotation — the only place projection constants live.
 *
 * Grid space: x, y on the ground (cells), z up (cells). True isometric:
 *   sx = (x − y)·cos30°·S,   sy = (x + y)·sin30°·S − z·S
 * Larger x+y is nearer the viewer. Rotation is applied to grid coordinates first.
 */
import type { Rotation, Vec2 } from "../resolve/resolve.ts";

/** Screen px per grid cell edge. */
export const S = 32;
export const COS30 = Math.cos(Math.PI / 6);
export const SIN30 = 0.5;

export type Pt = [number, number];
/** SVG matrix(a b c d e f): (u, v) → (a·u + c·v + e, b·u + d·v + f) */
export type Matrix = [number, number, number, number, number, number];

export interface Rect {
  x: number;
  y: number;
  w: number;
  d: number;
}

export function project(x: number, y: number, z = 0): Pt {
  return [(x - y) * COS30 * S, (x + y) * SIN30 * S - z * S];
}

/** Screen-space vector for a grid-space vector. */
export function projectVec(dx: number, dy: number, dz = 0): Pt {
  return [(dx - dy) * COS30 * S, (dx + dy) * SIN30 * S - dz * S];
}

export function rotatePoint([x, y]: Vec2, r: Rotation): Vec2 {
  switch (r) {
    case 0:
      return [x, y];
    case 90:
      return [-y, x];
    case 180:
      return [-x, -y];
    case 270:
      return [y, -x];
  }
}

export function rotateRect(b: Rect, r: Rotation): Rect {
  switch (r) {
    case 0:
      return b;
    case 90:
      return { x: -(b.y + b.d), y: b.x, w: b.d, d: b.w };
    case 180:
      return { x: -(b.x + b.w), y: -(b.y + b.d), w: b.w, d: b.d };
    case 270:
      return { x: b.y, y: -(b.x + b.w), w: b.d, d: b.w };
  }
}

/**
 * Matrix that lays 1 px of local (u, v) onto the ground plane at height z, with u along
 * +x and v along +y, origin at grid point (x, y). Used for ground text.
 */
export function groundMatrix(x: number, y: number, z = 0): Matrix {
  const [e, f] = project(x, y, z);
  return [COS30, SIN30, -COS30, SIN30, e, f];
}

/** Matrix mapping the unit square onto a parallelogram spanned by grid vectors u and v from origin o. */
export function faceMatrix(
  o: [number, number, number],
  u: [number, number, number],
  v: [number, number, number],
): Matrix {
  const [e, f] = project(...o);
  const [a, b] = projectVec(...u);
  const [c, d] = projectVec(...v);
  return [a, b, c, d, e, f];
}
