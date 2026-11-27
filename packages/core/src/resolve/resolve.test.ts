import { describe, expect, test } from "vitest";
import { resolveText } from "../test-helpers.ts";

const codes = (ds: { code: string }[]) => ds.map((d) => d.code);

describe("resolveDiagram", () => {
  test("visual resolution order: resource → types → catalog", async () => {
    const { model } = await resolveText(`version: 1
types:
  database: { color: "#000000", height: 3 }
  api: { shape: cylinder, size: [3, 3] }
resources:
  a: { type: database }
  b: { type: database, height: 5 }
  c: { type: api }
  d: { type: cache }
`);
    const r = Object.fromEntries(model.resources.map((x) => [x.id, x]));
    expect([r.a?.shape, r.a?.color, r.a?.height]).toEqual(["cylinder", "#000000", 3]);
    expect(r.b?.height).toBe(5);
    expect([r.c?.shape, r.c?.size]).toEqual(["cylinder", [3, 3]]);
    expect(r.d?.shape).toBe("cylinder"); // catalog
  });

  test("defaults: untyped resources are servers, labels default to ids", async () => {
    const { model, diagnostics } = await resolveText("version: 1\nresources:\n  web:\n");
    expect(diagnostics).toEqual([]);
    expect(model.resources[0]).toMatchObject({
      id: "web",
      shape: "box",
      label: "web",
      at: undefined,
    });
  });

  test("unknown type warns and falls back to a box", async () => {
    const { model, diagnostics } = await resolveText(
      "version: 1\nresources:\n  x: { type: thing }\n",
    );
    expect(codes(diagnostics)).toEqual(["W_UNKNOWN_TYPE"]);
    expect(diagnostics[0]?.severity).toBe("warning");
    expect(model.resources[0]?.shape).toBe("box");
  });

  test("icon aliases resolve, with per-use overrides; missing aliases error", async () => {
    const { model, diagnostics } = await resolveText(`version: 1
icons:
  aliases:
    db: { src: builtin:database, size: 0.5 }
resources:
  a: { icon: "@db" }
  b: { icon: { src: "@db", faces: left } }
  c: { icon: "@nope" }
`);
    const [a, b, c] = model.resources;
    expect(a?.icons[0]).toMatchObject({ faces: ["top"], size: 0.5 });
    expect(b?.icons[0]).toMatchObject({ faces: ["left"], size: 0.5, symbol: a?.icons[0]?.symbol });
    expect(c?.icons).toEqual([]);
    expect(codes(diagnostics)).toEqual(["E_UNKNOWN_ICON_ALIAS"]);
    expect(model.icons.size).toBe(1); // one symbol shared by a and b
  });

  test("missing icon files warn", async () => {
    const { diagnostics } = await resolveText(
      'version: 1\nresources:\n  a: { icon: "./nope.svg" }\n',
    );
    expect(codes(diagnostics)).toEqual(["W_ICON_NOT_FOUND"]);
  });

  test("single id namespace: a resource may not reuse a group id", async () => {
    const { model, diagnostics } = await resolveText(
      "version: 1\ngroups:\n  x: {}\nresources:\n  x: {}\n",
    );
    expect(codes(diagnostics)).toEqual(["E_DUPLICATE_ID"]);
    expect(model.resources).toEqual([]);
  });

  test("unknown parent groups and cycles are reported and repaired", async () => {
    const { model, diagnostics } = await resolveText(`version: 1
groups:
  a: { in: b }
  b: { in: a }
resources:
  r: { in: nowhere }
`);
    expect(codes(diagnostics).sort()).toEqual(["E_GROUP_CYCLE", "E_UNKNOWN_GROUP"]);
    expect(model.groups.map((g) => g.parent)).toEqual([undefined, "a"]);
    expect(model.resources[0]?.parent).toBeUndefined();
  });

  test("negative at inside a group is an error", async () => {
    const { diagnostics } = await resolveText(
      "version: 1\ngroups:\n  g: {}\nresources:\n  r: { in: g, at: [-1, 0] }\n",
    );
    expect(codes(diagnostics)).toEqual(["E_NEGATIVE_AT"]);
  });

  test("link shorthand and object forms", async () => {
    const { model } = await resolveText(`version: 1
resources: { a: {}, b: {} }
links:
  - a -> b
  - b <-> a
  - { from: a, to: b, id: second, style: dashed, arrow: none, route: straight, label: hi }
  - a -- b
`);
    expect(model.links.map((l) => [l.id, l.arrow])).toEqual([
      ["a->b", "end"],
      ["b->a", "both"],
      ["second", "none"],
    ]);
  });

  test("link errors: unknown endpoint, duplicate id", async () => {
    const { model, diagnostics } = await resolveText(`version: 1
resources: { a: {}, b: {} }
links:
  - a -> ghost
  - a -> b
  - a -- b
`);
    expect(codes(diagnostics)).toEqual(["E_UNKNOWN_LINK_ENDPOINT", "E_DUPLICATE_LINK_ID"]);
    expect(model.links).toHaveLength(1);
  });
});

test("BUILTIN_TYPES (used for autocomplete) matches the catalog", async () => {
  const { BUILTIN_TYPES } = await import("../dsl/schema.ts");
  const { CATALOG } = await import("./catalog.ts");
  expect([...BUILTIN_TYPES].sort()).toEqual(Object.keys(CATALOG).sort());
});
