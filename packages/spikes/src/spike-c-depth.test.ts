import { describe, expect, test } from "vitest";
import {
  type Box,
  depthSort,
  footprintsOverlap,
  painterVisible,
  type Rotation,
  rayCastVisible,
  screenBounds,
} from "./spike-c-depth.ts";

/** Deterministic PRNG (mulberry32) so fuzz failures are reproducible. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomScene(seed: number, count: number, gridSize: number): Box[] {
  const r = rng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const boxes: Box[] = [];
  for (let tries = 0; boxes.length < count && tries < count * 50; tries++) {
    const b: Box = {
      id: `b${boxes.length}`,
      x: int(0, gridSize),
      y: int(0, gridSize),
      w: int(1, 4),
      d: int(1, 4),
      h: r() * 4 + 0.25,
    };
    if (!boxes.some((o) => footprintsOverlap(o, b))) boxes.push(b);
  }
  return boxes;
}

const ROTATIONS: Rotation[] = [0, 90, 180, 270];

describe("depthSort", () => {
  test("simple pair: the box nearer the viewer is drawn last", () => {
    const back: Box = { id: "back", x: 0, y: 0, w: 2, d: 2, h: 3 };
    const front: Box = { id: "front", x: 2, y: 1, w: 2, d: 2, h: 1 };
    expect(depthSort([front, back]).map((b) => b.id)).toEqual(["back", "front"]);
    // Viewed from the opposite side the order flips.
    expect(depthSort([front, back], 180).map((b) => b.id)).toEqual(["front", "back"]);
  });

  test("a tall box behind a long flat box (the case naive x+y sorting gets wrong)", () => {
    // Long flat slab whose centre is further back than the small box in front of it.
    const slab: Box = { id: "slab", x: 0, y: 3, w: 10, d: 1, h: 0.5 };
    const tower: Box = { id: "tower", x: 8, y: 0, w: 1, d: 2, h: 5 };
    const order = depthSort([slab, tower]).map((b) => b.id);
    expect(order).toEqual(["tower", "slab"]);
  });

  test("rejects overlapping footprints", () => {
    const a: Box = { id: "a", x: 0, y: 0, w: 2, d: 2, h: 1 };
    expect(() => depthSort([a, { ...a, id: "b", x: 1 }])).toThrow(/overlap/);
  });

  test("is deterministic", () => {
    const scene = randomScene(7, 40, 20);
    expect(depthSort(scene).map((b) => b.id)).toEqual(depthSort(scene).map((b) => b.id));
  });

  test.each(ROTATIONS)(
    "fuzz: painter's order matches ray-cast ground truth (rotation %i)",
    (rot) => {
      let checked = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const scene = randomScene(seed * 31 + rot, 25, 14);
        const order = depthSort(scene, rot); // returns rotated boxes
        const r = rng(seed);
        const bounds = order.map(screenBounds);
        const minX = Math.min(...bounds.map((b) => b.minX));
        const maxX = Math.max(...bounds.map((b) => b.maxX));
        const minY = Math.min(...bounds.map((b) => b.minY));
        const maxY = Math.max(...bounds.map((b) => b.maxY));
        for (let k = 0; k < 400; k++) {
          const sx = minX + r() * (maxX - minX);
          const sy = minY + r() * (maxY - minY);
          const truth = rayCastVisible(order, sx, sy);
          if (truth.margin < 1e-6) continue; // grazing an edge: ambiguous
          expect(painterVisible(order, sx, sy), `seed ${seed} at (${sx}, ${sy})`).toBe(truth.id);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(10_000);
    },
  );
});
