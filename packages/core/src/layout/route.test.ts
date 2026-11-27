import { describe, expect, test } from "vitest";
import type { LinkModel, Rotation, Vec2 } from "../resolve/resolve.ts";
import { rotateRect } from "../scene/iso.ts";
import type { Placement } from "./place.ts";
import { routeLinks } from "./route.ts";

const link = (over: Partial<LinkModel> = {}): LinkModel => ({
  id: `${over.from ?? "a"}->${over.to ?? "b"}`,
  from: "a",
  to: "b",
  label: undefined,
  style: "solid",
  arrow: "end",
  route: "orthogonal",
  color: undefined,
  via: [],
  fromSide: undefined,
  toSide: undefined,
  path: [],
  ...over,
});

type R = [number, number, number, number];

/** Placement from `{ id: [x, y, w, d] }`, all top-level resources. */
const place = (rects: Record<string, R>): Placement =>
  new Map(
    Object.entries(rects).map(([id, [x, y, w, d]]) => [
      id,
      {
        id,
        kind: "resource",
        parent: undefined,
        at: [x, y],
        abs: [x, y],
        size: [w, d],
        pinned: true,
      },
    ]),
  );

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
}

const overlap = (a: R, b: R) =>
  a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

function axisAligned(pts: readonly Vec2[]) {
  for (let i = 1; i < pts.length; i++) {
    const [p, q] = [pts[i - 1] as Vec2, pts[i] as Vec2];
    if (p[0] !== q[0] && p[1] !== q[1]) return false;
  }
  return true;
}

/** Does any segment pass through the interior of box r (view frame)? */
function crosses(pts: readonly Vec2[], r: { x: number; y: number; w: number; d: number }) {
  for (let i = 1; i < pts.length; i++) {
    const [p, q] = [pts[i - 1] as Vec2, pts[i] as Vec2];
    const x0 = Math.min(p[0], q[0]);
    const x1 = Math.max(p[0], q[0]);
    const y0 = Math.min(p[1], q[1]);
    const y1 = Math.max(p[1], q[1]);
    if (x1 > r.x && x0 < r.x + r.w && y1 > r.y && y0 < r.y + r.d) return true;
  }
  return false;
}

const onFront = (pt: Vec2, b: { x: number; y: number; w: number; d: number }) =>
  (pt[0] === b.x + b.w && pt[1] >= b.y && pt[1] <= b.y + b.d) ||
  (pt[1] === b.y + b.d && pt[0] >= b.x && pt[0] <= b.x + b.w);

describe("routeLinks (orthogonal, A*)", () => {
  test.each([0, 90, 180, 270] as Rotation[])(
    "random layouts: axis-aligned, never through a solid, arrowhead on a visible front edge — rotation %i",
    (rot) => {
      const r = rng(rot + 1);
      const int = (n: number) => Math.floor(r() * n);
      let checked = 0;
      while (checked < 300) {
        const rects: Record<string, R> = {};
        const list: R[] = [];
        for (const id of ["a", "b", "c", "d"]) {
          const box: R = [int(16), int(16), 1 + int(3), 1 + int(3)];
          if (list.some((o) => overlap(o, box))) continue;
          list.push(box);
          rects[id] = box;
        }
        if (!rects.a || !rects.b) continue;
        const [route] = routeLinks([link()], place(rects), rot, () => 1);
        const pts = route?.points as Vec2[];
        const ctx = JSON.stringify({ rects, pts });
        expect(axisAligned(pts), ctx).toBe(true);
        for (const [id, [x, y, w, d]] of Object.entries(rects)) {
          expect(crosses(pts, rotateRect({ x, y, w, d }, rot)), `${id} ${ctx}`).toBe(false);
        }
        const [bx, by, bw, bd] = rects.b;
        expect(
          onFront(pts.at(-1) as Vec2, rotateRect({ x: bx, y: by, w: bw, d: bd }, rot)),
          ctx,
        ).toBe(true);
        checked++;
      }
    },
  );

  test("goes round an obstacle instead of through it", () => {
    const [route] = routeLinks(
      [link()],
      place({ a: [0, 4, 2, 2], wall: [5, 0, 2, 10], b: [10, 4, 2, 2] }),
      0,
      () => 1,
    );
    expect(crosses(route?.points ?? [], { x: 5, y: 0, w: 2, d: 10 })).toBe(false);
    expect(route?.points.at(-1)?.[0] === 12 || route?.points.at(-1)?.[1] === 6).toBe(true);
  });

  test("a straight shot is a single segment", () => {
    // b is behind a (smaller x), so the arrow arrives on b's visible right side.
    const [route] = routeLinks([link()], place({ a: [8, 0, 2, 2], b: [0, 0, 2, 2] }), 0, () => 1);
    const pts = route?.points as Vec2[];
    expect(pts).toHaveLength(2);
    expect(pts[0]?.[0]).toBe(8);
    expect(pts[1]?.[0]).toBe(2);
    expect(pts[0]?.[1]).toBe(pts[1]?.[1]);
  });

  test("parallel links take separate lanes", () => {
    const routes = routeLinks(
      [link({ from: "a", to: "b" }), link({ from: "c", to: "d" })],
      place({ b: [0, 0, 2, 4], a: [8, 0, 2, 4], d: [0, 6, 2, 4], c: [8, 6, 2, 4] }),
      0,
      () => 1,
    );
    // Same shape but no shared cells: compare the horizontal runs' y values.
    const ys = routes.map((r) => new Set(r.points.map((p) => p[1])));
    const shared = [...(ys[0] ?? [])].filter((y) => ys[1]?.has(y));
    expect(shared).toEqual([]);
    // Two links into the same side spread across its ports.
    const fan = routeLinks(
      [link({ from: "a", to: "b" }), link({ from: "c", to: "b" })],
      place({ b: [0, 2, 2, 4], a: [8, 0, 2, 2], c: [8, 6, 2, 2] }),
      0,
      () => 1,
    );
    const ends = fan.map((r) => JSON.stringify(r.points.at(-1)));
    expect(new Set(ends).size).toBe(2);
  });

  test("via waypoints are visited in order", () => {
    const [route] = routeLinks(
      [link({ via: [[4, 10]] })],
      place({ a: [0, 0, 2, 2], b: [8, 0, 2, 2] }),
      0,
      () => 1,
    );
    const pts = route?.points as Vec2[];
    const through = pts.slice(1).some((q, i) => {
      const p = pts[i] as Vec2;
      const inX = Math.min(p[0], q[0]) <= 4.5 && 4.5 <= Math.max(p[0], q[0]);
      const inY = Math.min(p[1], q[1]) <= 10.5 && 10.5 <= Math.max(p[1], q[1]);
      return inX && inY;
    });
    expect(through, JSON.stringify(pts)).toBe(true);
    expect(axisAligned(route?.points ?? [])).toBe(true);
  });

  test("fromSide and toSide choose the ports", () => {
    const [route] = routeLinks(
      [link({ fromSide: "back-right", toSide: "left" })],
      place({ a: [0, 0, 2, 2], b: [8, 0, 2, 2] }),
      0,
      () => 1,
    );
    const pts = route?.points as Vec2[];
    expect(pts[0]?.[1]).toBe(0); // a's y0 edge
    expect(pts.at(-1)?.[1]).toBe(2); // b's y1 edge
  });

  test("prefers lanes that aren't hidden behind tall boxes", () => {
    // A tall box between a and b: the route should pass in front of it (larger y), not behind.
    const [route] = routeLinks(
      [link()],
      place({ a: [0, 4, 2, 2], tall: [5, 3, 2, 4], b: [10, 4, 2, 2] }),
      0,
      (id) => (id === "tall" ? 4 : 1),
    );
    const lane = Math.max(...(route?.points ?? []).map((p) => p[1]));
    expect(lane).toBeGreaterThan(7);
  });

  test("is deterministic", () => {
    const p = place({ a: [0, 0, 2, 2], b: [9, 7, 2, 3], c: [4, 3, 2, 2] });
    const run = () => routeLinks([link(), link({ from: "c", to: "b" })], p, 0, () => 1);
    expect(run()).toEqual(run());
  });

  test("straight routes are clipped to both footprints", () => {
    const [route] = routeLinks(
      [link({ route: "straight" })],
      place({ a: [0, 0, 2, 2], b: [6, 0, 2, 2] }),
      0,
      () => 1,
    );
    expect(route?.points).toEqual([
      [2, 1],
      [6, 1],
    ]);
  });
});
