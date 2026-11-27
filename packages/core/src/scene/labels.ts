/**
 * Label geometry shared by routing and the scene (PLAN.md §6.2, M4): where group labels sit
 * on the floor, and choosing link-label positions that don't collide with solids or other labels.
 */
import { type Pt, type Rect, S } from "./iso.ts";
import { textWidth } from "./theme.ts";

export const GROUP_LABEL = { size: 14, weight: 600, inset: 0.35, baseline: 0.3 } as const;

/**
 * The cells a group's label covers (view frame): it runs along the inside of the group's
 * front-left (y1) edge, starting at its x0 corner. The router avoids these cells.
 */
export function groupLabelCells(v: Rect, label: string): Rect {
  const len = GROUP_LABEL.inset + textWidth(label, GROUP_LABEL.size, GROUP_LABEL.weight) / S;
  return { x: v.x, y: v.y + v.d - 1, w: Math.min(v.w, Math.ceil(len + 0.25)), d: 1 };
}

/** Axis-aligned screen rectangle. */
export interface ScreenBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Convex polygon (screen) vs axis-aligned box, by the separating axis theorem. */
export function polygonHitsBox(poly: readonly Pt[], b: ScreenBox): boolean {
  const rect: Pt[] = [
    [b.x0, b.y0],
    [b.x1, b.y0],
    [b.x1, b.y1],
    [b.x0, b.y1],
  ];
  const axes: Pt[] = [
    [1, 0],
    [0, 1],
  ];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as Pt;
    const q = poly[(i + 1) % poly.length] as Pt;
    axes.push([q[1] - p[1], p[0] - q[0]]);
  }
  for (const [ax, ay] of axes) {
    const proj = (pts: readonly Pt[]) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const [x, y] of pts) {
        const d = x * ax + y * ay;
        lo = Math.min(lo, d);
        hi = Math.max(hi, d);
      }
      return [lo, hi] as const;
    };
    const [a0, a1] = proj(poly);
    const [b0, b1] = proj(rect);
    if (a1 <= b0 || b1 <= a0) return false;
  }
  return true;
}

export const boxesHit = (a: ScreenBox, b: ScreenBox) =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * Candidate anchor points along a screen polyline for a label: the midpoint of the whole
 * path first (the M1 behaviour), then the middle, quarter and three-quarter points of each
 * segment, longest segment first. Deterministic.
 */
export function labelCandidates(pts: readonly Pt[]): Pt[] {
  const segs = pts.slice(1).map((b, i) => {
    const a = pts[i] as Pt;
    return { a, b, len: Math.hypot(b[0] - a[0], b[1] - a[1]), i };
  });
  const at = (s: (typeof segs)[number], t: number): Pt => [
    s.a[0] + (s.b[0] - s.a[0]) * t,
    s.a[1] + (s.b[1] - s.a[1]) * t,
  ];
  const out: Pt[] = [];
  let half = segs.reduce((sum, s) => sum + s.len, 0) / 2;
  for (const s of segs) {
    if (half <= s.len) {
      out.push(at(s, s.len ? half / s.len : 0));
      break;
    }
    half -= s.len;
  }
  const bySize = [...segs].sort((a, b) => b.len - a.len || a.i - b.i);
  for (const t of [0.5, 0.25, 0.75]) for (const s of bySize) if (s.len > 0) out.push(at(s, t));
  if (out.length === 0) out.push(pts[0] ?? [0, 0]);
  return out;
}
