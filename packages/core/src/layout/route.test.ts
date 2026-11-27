import { describe, expect, test } from "vitest";
import type { LinkModel, Rotation, Vec2 } from "../resolve/resolve.ts";
import { rotateRect } from "../scene/iso.ts";
import type { Placement } from "./place.ts";
import { routeLinks } from "./route.ts";

const link = (over: Partial<LinkModel> = {}): LinkModel => ({
  id: "a->b",
  from: "a",
  to: "b",
  label: undefined,
  style: "solid",
  arrow: "end",
  route: "orthogonal",
  color: undefined,
  path: [],
  ...over,
});

const placementOf = (
  a: [number, number, number, number],
  b: [number, number, number, number],
): Placement =>
  new Map(
    (
      [
        ["a", a],
        ["b", b],
      ] as const
    ).map(([id, [x, y, w, d]]) => [
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

describe("routeLinks (orthogonal)", () => {
  test.each([0, 90, 180, 270] as Rotation[])(
    "solid targets: segments are axis-aligned and the arrow lands on a visible (front) edge — rotation %i",
    (rot) => {
      const r = rng(rot + 1);
      const int = (n: number) => Math.floor(r() * n);
      let checked = 0;
      while (checked < 500) {
        const a: [number, number, number, number] = [int(20), int(20), 1 + int(3), 1 + int(3)];
        const b: [number, number, number, number] = [int(20), int(20), 1 + int(3), 1 + int(3)];
        const overlap =
          a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
        if (overlap) continue;
        const [route] = routeLinks([link()], placementOf(a, b), rot, () => true);
        const pts = route?.points as Vec2[];
        for (let i = 1; i < pts.length; i++) {
          const [p, q] = [pts[i - 1] as Vec2, pts[i] as Vec2];
          expect(p[0] === q[0] || p[1] === q[1], `segment ${i} axis-aligned`).toBe(true);
        }
        const vb = rotateRect({ x: b[0], y: b[1], w: b[2], d: b[3] }, rot);
        const [ex, ey] = pts.at(-1) as Vec2;
        const onFrontX = ex === vb.x + vb.w && ey >= vb.y && ey <= vb.y + vb.d;
        const onFrontY = ey === vb.y + vb.d && ex >= vb.x && ex <= vb.x + vb.w;
        expect(onFrontX || onFrontY, JSON.stringify({ a, b, pts })).toBe(true);
        checked++;
      }
    },
  );

  test("straight routes are clipped to both footprints", () => {
    const [route] = routeLinks(
      [link({ route: "straight" })],
      placementOf([0, 0, 2, 2], [6, 0, 2, 2]),
      0,
      () => true,
    );
    expect(route?.points).toEqual([
      [2, 1],
      [6, 1],
    ]);
  });
});
