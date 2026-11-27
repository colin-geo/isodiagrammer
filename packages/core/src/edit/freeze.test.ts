/** "Pin all" / freeze (PLAN.md §6.1): writing computed positions must not change the picture. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "../compile.ts";
import { layoutInfo } from "../layout/info.ts";
import { applyEdit, pinAllOp } from "./ops.ts";
import { applyChanges } from "./yaml-edit.ts";

const EXAMPLES = join(import.meta.dirname, "../../../../examples");

describe("pinAll", () => {
  test.each(["checkout-platform.yaml", "showcase.yaml"])(
    "%s: freezing pins every node, keeps comments, and renders identically",
    async (file) => {
      const text = readFileSync(join(EXAMPLES, file), "utf8");
      const before = await compile(text);
      const layout = layoutInfo(before);
      const op = layout && pinAllOp(layout);
      if (!op) throw new Error("expected unpinned nodes");
      const frozen = applyChanges(text, applyEdit(text, op));
      const after = await compile(frozen);
      expect(after.svg).toBe(before.svg);
      expect(layoutInfo(after)?.nodes.every((n) => n.pinned)).toBe(true);
      const comments = (t: string) => t.split("\n").filter((l) => l.trimStart().startsWith("#"));
      expect(comments(frozen)).toEqual(comments(text));
      expect(pinAllOp(layoutInfo(after) ?? { rotation: 0, groupPadding: 2, nodes: [] })).toBe(
        undefined,
      );
    },
  );
});
