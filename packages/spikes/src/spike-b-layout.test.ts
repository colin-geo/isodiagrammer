import { describe, expect, test } from "vitest";
import {
  type LayoutInput,
  type LayoutNode,
  layout,
  type Placed,
  renderAscii,
} from "./spike-b-layout.ts";

/** The example diagram from PLAN.md §4.1. */
function planExample(pins: Record<string, [number, number]> = {}): LayoutInput {
  const nodes: LayoutNode[] = [
    { id: "cloud", group: true },
    { id: "vpc", group: true, in: "cloud" },
    { id: "public", group: true, in: "vpc" },
    { id: "private", group: true, in: "vpc" },
    { id: "lb", in: "public", size: [2, 2] },
    { id: "web", in: "public", size: [2, 2] },
    { id: "db", in: "private", size: [2, 2] },
    { id: "cache", in: "private", size: [2, 2] },
    { id: "users", size: [1, 1] },
  ];
  for (const n of nodes) {
    const pin = pins[n.id];
    if (pin) n.at = pin;
  }
  return {
    nodes,
    edges: [
      { from: "users", to: "lb" },
      { from: "lb", to: "web" },
      { from: "web", to: "db" },
      { from: "web", to: "cache" },
    ],
  };
}

/** Invariants every layout must satisfy. */
function checkInvariants(input: LayoutInput, placed: Map<string, Placed>) {
  const pad = input.groupPadding ?? 1;
  for (const n of input.nodes) {
    const p = placed.get(n.id);
    expect(p, n.id).toBeDefined();
    if (!p) continue;
    if (n.at) expect(p.at, `${n.id} pinned`).toEqual(n.at);
    if (p.parent) {
      const g = placed.get(p.parent) as Placed;
      if (!n.at) {
        expect(p.at[0], `${n.id} inside padding`).toBeGreaterThanOrEqual(pad);
        expect(p.at[1], `${n.id} inside padding`).toBeGreaterThanOrEqual(pad);
      }
      expect(p.at[0] + p.size[0], `${n.id} fits ${g.id}`).toBeLessThanOrEqual(g.size[0]);
      expect(p.at[1] + p.size[1], `${n.id} fits ${g.id}`).toBeLessThanOrEqual(g.size[1]);
    }
  }
  const all = [...placed.values()];
  for (const a of all)
    for (const b of all) {
      if (a.id >= b.id || a.parent !== b.parent) continue;
      if (a.pinned && b.pinned) continue; // user's responsibility (reported as a warning)
      const overlap =
        a.at[0] < b.at[0] + b.size[0] &&
        b.at[0] < a.at[0] + a.size[0] &&
        a.at[1] < b.at[1] + b.size[1] &&
        b.at[1] < a.at[1] + a.size[1];
      expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
    }
}

describe("ELK compound layout on the grid", () => {
  test("plan example, nothing pinned", async () => {
    const input = planExample();
    const r = await layout(input);
    checkInvariants(input, r.placed);
    expect(r.warnings).toEqual([]);
    expect(renderAscii(r)).toMatchSnapshot();
  });

  test("plan example with db pinned inside private", async () => {
    const input = planExample({ db: [6, 1] });
    const r = await layout(input);
    checkInvariants(input, r.placed);
    expect(r.placed.get("db")?.at).toEqual([6, 1]);
    expect(renderAscii(r)).toMatchSnapshot();
  });

  test("pinning a node onto ELK's spot for another nudges the unpinned one", async () => {
    const free = await layout(planExample());
    const cacheSpot = free.placed.get("cache")?.at as [number, number];
    const input = planExample({ db: cacheSpot });
    const r = await layout(input);
    checkInvariants(input, r.placed);
    expect(r.placed.get("db")?.at).toEqual(cacheSpot);
    expect(r.placed.get("cache")?.nudged).toBe(true);
  });

  test("pinning a whole group moves it without touching its children's relative positions", async () => {
    const free = await layout(planExample());
    const input = planExample({ cloud: [10, 4] });
    const r = await layout(input);
    checkInvariants(input, r.placed);
    for (const id of ["vpc", "public", "lb", "web"])
      expect(r.placed.get(id)?.at, id).toEqual(free.placed.get(id)?.at);
  });

  test("is deterministic", async () => {
    const a = await layout(planExample({ db: [6, 1] }));
    const b = await layout(planExample({ db: [6, 1] }));
    expect(renderAscii(a)).toBe(renderAscii(b));
  });

  test("fuzz: random trees with random pins satisfy invariants", async () => {
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let round = 0; round < 40; round++) {
      const nodes: LayoutNode[] = [];
      const groups: string[] = [];
      for (let i = 0; i < 4; i++) {
        const parent =
          groups.length && rand() < 0.5 ? groups[Math.floor(rand() * groups.length)] : undefined;
        nodes.push({ id: `g${i}`, group: true, ...(parent ? { in: parent } : {}) });
        groups.push(`g${i}`);
      }
      for (let i = 0; i < 14; i++) {
        const parent = rand() < 0.8 ? groups[Math.floor(rand() * groups.length)] : undefined;
        const n: LayoutNode = {
          id: `r${i}`,
          size: [1 + Math.floor(rand() * 3), 1 + Math.floor(rand() * 3)],
          ...(parent ? { in: parent } : {}),
        };
        if (rand() < 0.2) n.at = [1 + Math.floor(rand() * 6), 1 + Math.floor(rand() * 6)];
        nodes.push(n);
      }
      // Drop empty groups' ambiguity: give each group at least one resource.
      for (const g of groups)
        if (!nodes.some((n) => n.in === g)) nodes.push({ id: `${g}-r`, in: g, size: [1, 1] });
      const edges = Array.from({ length: 10 }, () => ({
        from: `r${Math.floor(rand() * 14)}`,
        to: `r${Math.floor(rand() * 14)}`,
      })).filter((e) => e.from !== e.to);
      const input = { nodes, edges };
      const r = await layout(input);
      checkInvariants(input, r.placed);
    }
  });
});
