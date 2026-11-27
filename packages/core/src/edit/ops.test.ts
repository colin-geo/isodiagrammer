import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { applyEdit, diffChange, type EditOp } from "./ops.ts";
import { applyChanges } from "./yaml-edit.ts";

const DOC = `version: 1
# Layout tweaks below were made by dragging.
groups:
  vpc: { label: VPC }          # flow group
  db-tier:
    in: vpc                    # nested
    label: Data
resources:
  web: { type: server, in: vpc }   # web tier
  db:
    type: database   # managed
    in: db-tier
    at: [1, 1]       # pinned on purpose
  users: { type: user }
`;

type Entry = Record<string, unknown>;
type Doc = { groups: Record<string, Entry>; resources: Record<string, Entry> };

const run = (op: EditOp) => applyChanges(DOC, applyEdit(DOC, op));
const comments = (t: string) =>
  t.split("\n").flatMap((l) => (l.includes("#") ? [l.slice(l.indexOf("#"))] : []));

describe("applyEdit", () => {
  test.each<[string, EditOp, (d: Doc) => void]>([
    [
      "move within parent (adds at)",
      { kind: "move", id: "web", at: [3, 4] },
      (d) => expect(d.resources.web).toMatchObject({ in: "vpc", at: [3, 4] }),
    ],
    [
      "move updates existing at in place",
      { kind: "move", id: "db", at: [5, 2] },
      (d) => expect(d.resources.db?.at).toEqual([5, 2]),
    ],
    [
      "reparent into a group",
      { kind: "move", id: "users", at: [2, 2], parent: "vpc" },
      (d) => expect(d.resources.users).toEqual({ type: "user", in: "vpc", at: [2, 2] }),
    ],
    [
      "reparent changes existing in",
      { kind: "move", id: "db", at: [0, 3], parent: "vpc" },
      (d) => expect(d.resources.db).toMatchObject({ in: "vpc", at: [0, 3] }),
    ],
    [
      "move to top level removes in",
      { kind: "move", id: "db", at: [-4, 0], parent: null },
      (d) => {
        expect(d.resources.db?.in).toBeUndefined();
        expect(d.resources.db?.at).toEqual([-4, 0]);
      },
    ],
    [
      "move a group",
      { kind: "move", id: "db-tier", at: [6, 1] },
      (d) => expect(d.groups["db-tier"]).toMatchObject({ in: "vpc", at: [6, 1] }),
    ],
    ["unpin", { kind: "unpin", id: "db" }, (d) => expect(d.resources.db?.at).toBeUndefined()],
    [
      "resize a flow group",
      { kind: "resize", id: "vpc", size: [12, 8] },
      (d) => expect(d.groups.vpc?.size).toEqual([12, 8]),
    ],
    [
      "resize a block group",
      { kind: "resize", id: "db-tier", size: [5, 5] },
      (d) => expect(d.groups["db-tier"]?.size).toEqual([5, 5]),
    ],
  ])("%s, as one change, keeping every comment", (_name, op, check) => {
    const changes = applyEdit(DOC, op);
    expect(changes).toHaveLength(1);
    const out = applyChanges(DOC, changes);
    check(parse(out) as Doc);
    const expected = comments(DOC).filter(
      (c) => !(op.kind === "unpin" && c.includes("pinned on purpose")),
    );
    expect(comments(out)).toEqual(expected);
  });

  test("a no-op edit produces no change", () => {
    expect(applyEdit(DOC, { kind: "move", id: "db", at: [1, 1] })).toEqual([]);
    expect(applyEdit(DOC, { kind: "unpin", id: "users" })).toEqual([]);
  });

  test("unknown ids throw", () => {
    expect(() => applyEdit(DOC, { kind: "unpin", id: "ghost" })).toThrow(/ghost/);
  });

  test("reparenting a flow entry writes in before at", () => {
    expect(run({ kind: "move", id: "users", at: [2, 2], parent: "vpc" })).toContain(
      "users: { type: user, in: vpc, at: [2, 2] }",
    );
  });
});

describe("diffChange", () => {
  test("minimal single change", () => {
    expect(diffChange("abcdef", "abXYef")).toEqual({ from: 2, to: 4, insert: "XY" });
    expect(diffChange("same", "same")).toBeUndefined();
    expect(diffChange("aa", "aaa")).toEqual({ from: 2, to: 2, insert: "a" });
  });
});
