import { describe, expect, test } from "vitest";
import { fit, MAX_ZOOM, svgSize, zoomAt } from "./panzoom.ts";

describe("panzoom", () => {
  test("zoomAt keeps the point under the cursor fixed", () => {
    const v = { x: 10, y: 20, k: 1 };
    const z = zoomAt(v, 2, 110, 70);
    // content point under (110,70) before: ((110-10)/1, (70-20)/1) = (100, 50)
    expect([(110 - z.x) / z.k, (70 - z.y) / z.k]).toEqual([100, 50]);
    expect(z.k).toBe(2);
  });

  test("zoom is clamped", () => {
    expect(zoomAt({ x: 0, y: 0, k: 4 }, 100, 0, 0).k).toBe(MAX_ZOOM);
  });

  test("fit centres and never zooms past 1:1", () => {
    expect(fit(100, 50, 1000, 800)).toEqual({ k: 1, x: 450, y: 375 });
    const big = fit(2000, 1000, 1048, 548, 24);
    expect(big.k).toBe(0.5);
    expect(big.x).toBe(24);
  });

  test("svgSize reads the root element only", () => {
    expect(
      svgSize(
        '<svg viewBox="0 0 1 1" width="640" height="480.5"><rect width="9" height="9"/></svg>',
      ),
    ).toEqual({ w: 640, h: 480.5 });
  });
});
