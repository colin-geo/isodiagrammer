/**
 * Stage 4b: link routing on the ground plane, in view-frame grid coordinates.
 * M1: straight and simple orthogonal (I/L-shaped) routes. A* routing with obstacle
 * avoidance replaces `orthogonal` in M4 (PLAN.md §6.2).
 */
import type { LinkModel, Rotation, Vec2 } from "../resolve/resolve.ts";
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

/**
 * Orthogonal route in the VIEW frame, where +x and +y faces (x1, y1 edges) face the viewer.
 * Arrowheads must land on a visible edge: when the target is in front of the source the
 * route wraps round the side of the target instead of disappearing under it.
 */
function orthogonal(a: Box, b: Box, targetSolid: boolean): Vec2[] {
  const [ax, ay] = centre(a);
  const [bx, by] = centre(b);
  const G = 1; // clearance for wrap-around legs, in cells
  /** arrive on b's +x (right) face */
  const wrapX = (): Vec2[] => {
    const X = Math.max(a.x1, b.x1) + G;
    return [
      [a.x1, ay],
      [X, ay],
      [X, by],
      [b.x1, by],
    ];
  };
  /** arrive on b's +y (left) face */
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
  if (!down || !targetSolid) return xThenY; // arrives on b's front (y1) edge
  if (!right) return yThenX; // arrives on b's front (x1) edge
  const wx = wrapX();
  const wy = wrapY();
  return pathLength(wx) <= pathLength(wy) ? wx : wy;
}

/**
 * Routes are computed in the view frame (after rotation), because which faces are visible
 * depends on the view. The returned points are view-frame grid coordinates.
 */
export function routeLinks(
  links: readonly LinkModel[],
  placement: Placement,
  rotation: Rotation,
  isSolid: (id: string) => boolean,
): RoutedLink[] {
  const out: RoutedLink[] = [];
  const boxOf = (p: { abs: Vec2; size: Vec2 }): Box => {
    const r = rotateRect({ x: p.abs[0], y: p.abs[1], w: p.size[0], d: p.size[1] }, rotation);
    return { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.d };
  };
  for (const link of links) {
    const pa = placement.get(link.from);
    const pb = placement.get(link.to);
    if (!pa || !pb || link.from === link.to) continue;
    const a = boxOf(pa);
    const b = boxOf(pb);
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
      points = orthogonal(a, b, isSolid(link.to));
    }
    out.push({ link, points });
  }
  return out;
}
