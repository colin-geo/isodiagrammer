import { describe, expect, test } from "vitest";
import { compile } from "../compile.ts";
import { boxesHit, labelCandidates, polygonHitsBox } from "./labels.ts";

describe("label geometry", () => {
  test("polygon vs box", () => {
    const diamond: [number, number][] = [
      [0, -10],
      [10, 0],
      [0, 10],
      [-10, 0],
    ];
    expect(polygonHitsBox(diamond, { x0: -2, y0: -2, x1: 2, y1: 2 })).toBe(true);
    // In the diamond's bounding box but outside the diamond itself.
    expect(polygonHitsBox(diamond, { x0: 7, y0: 7, x1: 10, y1: 10 })).toBe(false);
    expect(boxesHit({ x0: 0, y0: 0, x1: 2, y1: 2 }, { x0: 2, y0: 0, x1: 4, y1: 2 })).toBe(false);
  });

  test("candidates start at the path midpoint, then the longest segment", () => {
    const c = labelCandidates([
      [0, 0],
      [10, 0],
      [10, 40],
    ]);
    expect(c[0]).toEqual([10, 15]);
    expect(c[1]).toEqual([10, 20]);
  });
});

test("a link label whose midpoint is under a box moves to a clear spot", async () => {
  // A straight link runs right through the tall box "t", so its midpoint is inside it.
  const { scene } = await compile(`version: 1
resources:
  a: { at: [0, 0] }
  t: { at: [6, 0], size: [3, 1], height: 3 }
  b: { at: [14, 0] }
links:
  - { from: a, to: b, label: a long link label, route: straight }
`);
  const label = scene?.items.find((i) => i.role === "label" && i.id === "a->b");
  const text = label?.prims[0];
  if (text?.kind !== "text") throw new Error("no label");
  const box = scene?.items.find((i) => i.id === "t" && i.role === "resource");
  // Rough check: the label's anchor is outside the tall box's screen extent.
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of box?.prims ?? [])
    if (p.kind === "path")
      for (const m of p.d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)) {
        xs.push(Number(m[1]));
        ys.push(Number(m[2]));
      }
  const inside =
    text.x > Math.min(...xs) &&
    text.x < Math.max(...xs) &&
    text.y > Math.min(...ys) &&
    text.y < Math.max(...ys);
  expect(inside).toBe(false);
});
