import type { LayoutInfo, NodeInfo } from "@isodiagrammer/core";
import { describe, expect, test } from "vitest";
import {
  applyOpToLayout,
  computeDrop,
  computeResize,
  nodeAtSource,
  nudgeDelta,
  withDescendants,
} from "./drag.ts";

const node = (n: Partial<NodeInfo> & Pick<NodeInfo, "id">): NodeInfo => ({
  kind: "resource",
  parent: undefined,
  at: [0, 0],
  abs: [0, 0],
  size: [2, 2],
  height: 1,
  pinned: true,
  fixedSize: false,
  key: undefined,
  entry: undefined,
  ...n,
});

// vpc (0,0 16×10) ⊃ sub (2,2 6×6, fixed size) ⊃ db (sub+[2,2]); web in vpc at (10,2); users top-level at (-6, 3)
const LAYOUT: LayoutInfo = {
  rotation: 0,
  groupPadding: 2,
  nodes: [
    node({ id: "vpc", kind: "group", at: [0, 0], abs: [0, 0], size: [16, 10], height: 0 }),
    node({
      id: "sub",
      kind: "group",
      parent: "vpc",
      at: [2, 2],
      abs: [2, 2],
      size: [6, 6],
      height: 0,
      fixedSize: true,
    }),
    node({ id: "db", parent: "sub", at: [2, 2], abs: [4, 4], entry: { from: 50, to: 70 } }),
    node({ id: "web", parent: "vpc", at: [10, 2], abs: [10, 2], pinned: false }),
    node({ id: "users", at: [-6, 3], abs: [-6, 3], entry: { from: 80, to: 100 } }),
  ],
};

describe("computeDrop", () => {
  test("move within the same group", () => {
    expect(computeDrop(LAYOUT, "web", [0, 4])).toMatchObject({
      parent: "vpc",
      at: [10, 6],
      valid: true,
      reparented: false,
      changed: true,
    });
  });

  test("dropping inside a nested group reparents to the innermost one", () => {
    expect(computeDrop(LAYOUT, "users", [9, -1])).toMatchObject({
      parent: "sub",
      at: [1, 0],
      abs: [3, 2],
      valid: true,
      reparented: true,
    });
  });

  test("dropping outside every group moves to the top level", () => {
    expect(computeDrop(LAYOUT, "db", [-10, 3])).toMatchObject({
      parent: undefined,
      at: [-6, 7],
      valid: true,
      reparented: true,
    });
  });

  test("keepParent (Alt-drag) never reparents, and can't leave the group's origin", () => {
    expect(computeDrop(LAYOUT, "db", [1, 0], { keepParent: true })).toMatchObject({
      parent: "sub",
      at: [3, 2],
      valid: true,
    });
    expect(computeDrop(LAYOUT, "web", [-12, 0], { keepParent: true })).toMatchObject({
      parent: "vpc",
      valid: false,
    });
  });

  test("overlapping a sibling is invalid", () => {
    // Alt-drag keeps web in vpc, where it lands on its sibling group "sub".
    const c = computeDrop(LAYOUT, "web", [-5, 2], { keepParent: true });
    expect(c?.valid).toBe(false);
    expect(c?.reason).toMatch(/Overlaps "sub"/);
  });

  test("auto-placed siblings don't block (layout moves them)", () => {
    expect(computeDrop(LAYOUT, "db", [7, -2], { keepParent: false })).toMatchObject({
      parent: "vpc",
      at: [11, 2],
      valid: true,
    });
  });

  test("a fixed-size group must still hold the dropped node", () => {
    const c = computeDrop(LAYOUT, "db", [3, 0], { keepParent: true }); // at [5,2] + 2 > 6
    expect(c).toMatchObject({ valid: false });
    expect(c?.reason).toMatch(/fit/);
  });

  test("landing inside a group reparents, then checks overlaps there", () => {
    const c = computeDrop(LAYOUT, "web", [-5, 2]);
    expect(c).toMatchObject({ parent: "sub", valid: false, reason: 'Overlaps "db"' });
  });

  test("a group can't be dropped into itself or its children", () => {
    const c = computeDrop(LAYOUT, "sub", [1, 1]);
    expect(c?.parent).toBe("vpc");
  });

  test("dropping a pinned node where it was is not a change; an unpinned one becomes pinned", () => {
    expect(computeDrop(LAYOUT, "db", [0, 0])?.changed).toBe(false);
    expect(computeDrop(LAYOUT, "web", [0, 0])?.changed).toBe(true);
  });
});

describe("computeResize", () => {
  test("must hold every child", () => {
    expect(computeResize(LAYOUT, "sub", [8, 8])).toMatchObject({ valid: true, changed: true });
    expect(computeResize(LAYOUT, "sub", [3, 6])).toMatchObject({
      valid: false,
      reason: '"db" wouldn\'t fit',
    });
    expect(computeResize(LAYOUT, "db", [3, 3])).toBeUndefined();
  });
});

test("withDescendants", () => {
  expect([...withDescendants(LAYOUT, "vpc")].sort()).toEqual(["db", "sub", "vpc", "web"]);
});

test("nodeAtSource picks the innermost entry", () => {
  expect(nodeAtSource(LAYOUT, 60)).toBe("db");
  expect(nodeAtSource(LAYOUT, 75)).toBeUndefined();
});

test("nudgeDelta follows the view rotation", () => {
  expect(nudgeDelta("ArrowRight", 0)).toEqual([1, 0]);
  expect(nudgeDelta("ArrowRight", 180)).toEqual([-1, -0]);
  expect(nudgeDelta("ArrowDown", 90)).toEqual([1, -0]);
  expect(nudgeDelta("a", 0)).toBeUndefined();
});

describe("applyOpToLayout", () => {
  test("move shifts the node and its descendants, and pins it", () => {
    const out = applyOpToLayout(LAYOUT, { kind: "move", id: "sub", at: [4, 3] });
    const by = Object.fromEntries(out.nodes.map((n) => [n.id, n]));
    expect(by.sub).toMatchObject({ at: [4, 3], abs: [4, 3], pinned: true });
    expect(by.db?.abs).toEqual([6, 5]);
    expect(LAYOUT.nodes.find((n) => n.id === "sub")?.abs).toEqual([2, 2]); // input untouched
  });

  test("reparent to top level and back", () => {
    const top = applyOpToLayout(LAYOUT, { kind: "move", id: "db", at: [-5, 0], parent: null });
    expect(top.nodes.find((n) => n.id === "db")).toMatchObject({ parent: undefined, abs: [-5, 0] });
    const into = applyOpToLayout(top, { kind: "move", id: "db", at: [1, 1], parent: "vpc" });
    expect(into.nodes.find((n) => n.id === "db")).toMatchObject({ parent: "vpc", abs: [1, 1] });
  });

  test("pinAll pins without moving anything", () => {
    const out = applyOpToLayout(LAYOUT, { kind: "pinAll", nodes: [{ id: "web", at: [10, 2] }] });
    expect(out.nodes.find((n) => n.id === "web")).toMatchObject({ pinned: true, at: [10, 2] });
  });

  test("consecutive nudges accumulate", () => {
    let l = LAYOUT;
    for (const key of ["ArrowRight", "ArrowDown"]) {
      const c = computeDrop(l, "db", nudgeDelta(key, 0) ?? [0, 0], { keepParent: true });
      if (c) l = applyOpToLayout(l, { kind: "move", id: "db", at: c.at });
    }
    expect(l.nodes.find((n) => n.id === "db")?.at).toEqual([3, 3]);
  });
});
