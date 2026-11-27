import { describe, expect, test } from "vitest";
import { resolveText } from "../test-helpers.ts";
import { type Placement, placeNodes } from "./place.ts";

async function place(text: string) {
  const { model, sourceMap } = await resolveText(text);
  return { model, ...(await placeNodes(model, sourceMap)) };
}

/** Invariants every placement must satisfy (siblings unpinned on both sides never overlap etc.). */
function checkInvariants(placement: Placement, pad: number, pins: Map<string, [number, number]>) {
  for (const p of placement.values()) {
    const pin = pins.get(p.id);
    if (pin) expect(p.at, `${p.id} pinned`).toEqual(pin);
    if (p.parent) {
      const g = placement.get(p.parent);
      expect(g, `${p.id} parent placed`).toBeDefined();
      if (!g) continue;
      if (!pin) {
        expect(p.at[0], `${p.id} inside padding`).toBeGreaterThanOrEqual(pad);
        expect(p.at[1], `${p.id} inside padding`).toBeGreaterThanOrEqual(pad);
      }
      expect(p.at[0] + p.size[0], `${p.id} fits ${g.id}`).toBeLessThanOrEqual(g.size[0]);
      expect(p.at[1] + p.size[1], `${p.id} fits ${g.id}`).toBeLessThanOrEqual(g.size[1]);
      expect(p.abs).toEqual([g.abs[0] + p.at[0], g.abs[1] + p.at[1]]);
    }
  }
  const all = [...placement.values()];
  for (const a of all)
    for (const b of all) {
      if (a.id >= b.id || a.parent !== b.parent || (a.pinned && b.pinned)) continue;
      const overlap =
        a.at[0] < b.at[0] + b.size[0] &&
        b.at[0] < a.at[0] + a.size[0] &&
        a.at[1] < b.at[1] + b.size[1] &&
        b.at[1] < a.at[1] + a.size[1];
      expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
    }
}

describe("placeNodes", () => {
  test("fully pinned diagrams don't need ELK and keep exact positions", async () => {
    const { placement, diagnostics } = await place(`version: 1
groups:
  g: { at: [10, 10] }
resources:
  a: { in: g, at: [2, 2] }
  b: { at: [0, 0] }
`);
    expect(diagnostics).toEqual([]);
    expect(placement.get("a")?.abs).toEqual([12, 12]);
    expect(placement.get("g")?.size).toEqual([6, 6]); // child extent 4 + padding 2
  });

  test("explicit group size that's too small is an error", async () => {
    const { diagnostics } = await place(
      "version: 1\ngroups:\n  g: { size: [3, 3] }\nresources:\n  a: { in: g, at: [2, 2] }\n",
    );
    expect(diagnostics.map((d) => d.code)).toEqual(["E_GROUP_TOO_SMALL"]);
  });

  test("pinned siblings that overlap are an error", async () => {
    const { diagnostics } = await place(
      "version: 1\nresources:\n  a: { at: [0, 0] }\n  b: { at: [1, 1] }\n",
    );
    expect(diagnostics.map((d) => d.code)).toEqual(["E_FOOTPRINT_OVERLAP"]);
  });

  test("pinning a group moves it without changing its children's relative positions", async () => {
    const doc = (pin: string) => `version: 1
groups:
  g: { ${pin} }
resources:
  a: { in: g }
  b: { in: g }
  c: {}
links: [a -> b, b -> c]
`;
    const free = await place(doc(""));
    const pinned = await place(doc("at: [20, 3]"));
    expect(pinned.placement.get("g")?.abs).toEqual([20, 3]);
    for (const id of ["a", "b"])
      expect(pinned.placement.get(id)?.at, id).toEqual(free.placement.get(id)?.at);
  });

  test("deterministic", async () => {
    const doc =
      "version: 1\ngroups: { g: {} }\nresources: { a: { in: g }, b: { in: g }, c: {} }\nlinks: [a -> b, b -> c]\n";
    const a = await place(doc);
    const b = await place(doc);
    expect([...a.placement.values()]).toEqual([...b.placement.values()]);
  });

  test("fuzz: random trees with random pins satisfy the invariants", async () => {
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)] as T;
    for (let round = 0; round < 30; round++) {
      const groups: string[] = [];
      const lines = ["version: 1", "groups:"];
      for (let i = 0; i < 4; i++) {
        const parent = groups.length && rand() < 0.5 ? `in: ${pick(groups)}` : "";
        lines.push(`  g${i}: { ${parent} }`);
        groups.push(`g${i}`);
      }
      lines.push("resources:");
      const pins = new Map<string, [number, number]>();
      const pinned = new Set<string>();
      for (let i = 0; i < 14; i++) {
        const fields = [`size: [${1 + Math.floor(rand() * 3)}, ${1 + Math.floor(rand() * 3)}]`];
        if (rand() < 0.8) fields.push(`in: ${pick(groups)}`);
        // Pins are spaced apart so pinned siblings never overlap each other.
        if (rand() < 0.2) {
          const at: [number, number] = [
            2 + 4 * Math.floor(rand() * 3),
            2 + 4 * Math.floor(rand() * 3),
          ];
          const key = `${fields[1]}|${at}`;
          if (!pinned.has(key)) {
            pinned.add(key);
            fields.push(`at: [${at.join(", ")}]`);
            pins.set(`r${i}`, at);
          }
        }
        lines.push(`  r${i}: { ${fields.join(", ")} }`);
      }
      lines.push("links:");
      for (let i = 0; i < 10; i++) {
        const a = Math.floor(rand() * 14);
        const b = Math.floor(rand() * 14);
        if (a !== b) lines.push(`  - { from: r${a}, to: r${b}, id: l${i} }`);
      }
      const { placement, diagnostics } = await place(`${lines.join("\n")}\n`);
      expect(
        diagnostics.filter((d) => d.code !== "E_FOOTPRINT_OVERLAP"),
        `round ${round}`,
      ).toEqual([]);
      checkInvariants(placement, 2, pins);
    }
  });
});
