import { describe, expect, test } from "vitest";
import type { Rotation } from "../resolve/resolve.ts";
import { type DepthBox, depthOrder, footprintsOverlap, screenBounds } from "./depth.ts";
import { COS30, rotateRect, SIN30 } from "./iso.ts";

type Box = DepthBox & { id: string };

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

/** Ground truth: cast the view ray (1,1,1) through a screen point; nearest exit wins. */
function rayCastVisible(boxes: readonly Box[], sx: number, sy: number) {
  const a = sx / COS30;
  const s = sy / SIN30;
  const p = [(a + s) / 2, (s - a) / 2, 0];
  let best: { id: string; t: number } | undefined;
  let second = -Infinity;
  for (const b of boxes) {
    const lo = [b.x, b.y, 0];
    const hi = [b.x + b.w, b.y + b.d, b.h];
    let tmin = -Infinity;
    let tmax = Infinity;
    for (let k = 0; k < 3; k++) {
      const t1 = (lo[k] as number) - (p[k] as number);
      const t2 = (hi[k] as number) - (p[k] as number);
      tmin = Math.max(tmin, Math.min(t1, t2));
      tmax = Math.min(tmax, Math.max(t1, t2));
    }
    if (tmax <= tmin + 1e-9) continue;
    if (!best || tmax > best.t) {
      if (best) second = best.t;
      best = { id: b.id, t: tmax };
    } else second = Math.max(second, tmax);
  }
  return { id: best?.id, margin: best ? best.t - second : Infinity };
}

const painterVisible = (order: readonly Box[], sx: number, sy: number) => {
  let seen: string | undefined;
  for (const b of order) if (rayCastVisible([b], sx, sy).id) seen = b.id;
  return seen;
};

const sorted = (boxes: Box[], rot: Rotation = 0): Box[] => {
  const view = boxes.map((b) => ({ ...b, ...rotateRect(b, rot) }));
  return depthOrder(view).map((i) => view[i] as Box);
};

describe("depthOrder", () => {
  test("the box nearer the viewer is drawn last, and flips at 180°", () => {
    const back: Box = { id: "back", x: 0, y: 0, w: 2, d: 2, h: 3 };
    const front: Box = { id: "front", x: 2, y: 1, w: 2, d: 2, h: 1 };
    expect(sorted([front, back]).map((b) => b.id)).toEqual(["back", "front"]);
    expect(sorted([front, back], 180).map((b) => b.id)).toEqual(["front", "back"]);
  });

  test("a tall box behind a long flat slab (naive centre sorting gets this wrong)", () => {
    const slab: Box = { id: "slab", x: 0, y: 3, w: 10, d: 1, h: 0.5 };
    const tower: Box = { id: "tower", x: 8, y: 0, w: 1, d: 2, h: 5 };
    expect(sorted([slab, tower]).map((b) => b.id)).toEqual(["tower", "slab"]);
  });

  test("overlapping footprints don't throw and still return every box once", () => {
    const a: Box = { id: "a", x: 0, y: 0, w: 2, d: 2, h: 1 };
    const order = sorted([a, { ...a, id: "b", x: 1 }, { ...a, id: "c", x: 0.5, y: 1 }]);
    expect(order.map((b) => b.id).sort()).toEqual(["a", "b", "c"]);
  });

  test.each([0, 90, 180, 270] as Rotation[])(
    "fuzz vs ray-cast ground truth (rotation %i)",
    (rot) => {
      let checked = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const order = sorted(randomScene(seed * 31 + rot, 25, 14), rot);
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
          if (truth.margin < 1e-6) continue;
          expect(painterVisible(order, sx, sy), `seed ${seed} at (${sx}, ${sy})`).toBe(truth.id);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(10_000);
    },
  );
});
