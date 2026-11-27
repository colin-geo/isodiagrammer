import { describe, expect, test } from "vitest";
import type { Rotation } from "../resolve/resolve.ts";
import { footprintPolygon, screenToWorld, worldToScreen, worldVecToScreen } from "./iso.ts";

const R: Rotation[] = [0, 90, 180, 270];

describe("screen ↔ world", () => {
  test.each(R)("round trip at rotation %i", (rot) => {
    for (const p of [
      [0, 0],
      [3, -2],
      [-7.5, 4.25],
    ] as [number, number][]) {
      const [sx, sy] = worldToScreen(p, rot);
      const back = screenToWorld(sx, sy, rot);
      expect(back[0]).toBeCloseTo(p[0], 9);
      expect(back[1]).toBeCloseTo(p[1], 9);
    }
  });

  test.each(R)("vector translation matches point difference (rotation %i)", (rot) => {
    const a = worldToScreen([2, 3], rot);
    const b = worldToScreen([5, 1], rot);
    const v = worldVecToScreen([3, -2], rot);
    expect(v[0]).toBeCloseTo(b[0] - a[0], 9);
    expect(v[1]).toBeCloseTo(b[1] - a[1], 9);
  });

  test.each(R)("footprint polygon contains its centre (rotation %i)", (rot) => {
    const poly = footprintPolygon([1, 2], [3, 2], rot);
    const [cx, cy] = worldToScreen([2.5, 3], rot);
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    expect(cx).toBeGreaterThan(Math.min(...xs));
    expect(cx).toBeLessThan(Math.max(...xs));
    expect(cy).toBeGreaterThan(Math.min(...ys));
    expect(cy).toBeLessThan(Math.max(...ys));
  });
});
