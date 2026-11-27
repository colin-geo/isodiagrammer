import { expect, test } from "vitest";
import { compile } from "../compile.ts";
import { layoutInfo } from "./info.ts";

test("layoutInfo summarises placement with source ranges", async () => {
  const text = `version: 1
groups:
  g: { at: [10, 10], size: [8, 8] }
resources:
  a: { in: g, at: [2, 2], type: database }
  b: {}
`;
  const info = layoutInfo(await compile(text));
  expect(info?.rotation).toBe(0);
  const byId = Object.fromEntries((info?.nodes ?? []).map((n) => [n.id, n]));
  expect(byId.a).toMatchObject({
    kind: "resource",
    parent: "g",
    at: [2, 2],
    abs: [12, 12],
    pinned: true,
    height: 1.4,
  });
  expect(byId.g).toMatchObject({ kind: "group", fixedSize: true, height: 0 });
  expect(byId.b?.pinned).toBe(false);
  const a = byId.a;
  expect(a?.key && text.slice(a.key.from, a.key.to)).toBe("a");
  expect(a?.entry && text.slice(a.entry.from, a.entry.to)).toBe(
    "a: { in: g, at: [2, 2], type: database }",
  );
});
