/**
 * Golden tests (PLAN.md §10): every example renders to a committed SVG snapshot, and every
 * invalid example to a committed diagnostics snapshot. Review changes to __golden__/ in
 * diffs like any other code; update with `pnpm test:run -u`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "./compile.ts";
import { imageIcon } from "./resolve/icons.ts";

const EXAMPLES = join(import.meta.dirname, "../../../examples");
const yamlIn = (dir: string) =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .sort();

/** Fixed fake icons so goldens don't depend on the filesystem. */
const testIcons = {
  load: async (src: string) => imageIcon(`data:text/plain,${encodeURIComponent(src)}`),
};

describe("examples render to golden SVGs", () => {
  test.each(yamlIn(EXAMPLES))("%s", async (file) => {
    const text = readFileSync(join(EXAMPLES, file), "utf8");
    const result = await compile(text, { icons: testIcons });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    await expect(result.svg).toMatchFileSnapshot(`__golden__/${basename(file, ".yaml")}.svg`);
    // Determinism: compiling again gives identical bytes.
    expect((await compile(text, { icons: testIcons })).svg).toBe(result.svg);
  });
});

describe("invalid examples produce golden diagnostics", () => {
  test.each(yamlIn(join(EXAMPLES, "invalid")))("%s", async (file) => {
    const text = readFileSync(join(EXAMPLES, "invalid", file), "utf8");
    const result = await compile(text, { icons: testIcons });
    const lines = result.diagnostics.map((d) => {
      const pos = d.range ? result.parse.lineCounter.linePos(d.range.from) : undefined;
      return `${pos ? `${pos.line}:${pos.col}` : "-"} ${d.severity} ${d.code} ${d.message}`;
    });
    expect(lines.length).toBeGreaterThan(0);
    await expect(`${lines.join("\n")}\n`).toMatchFileSnapshot(
      `__golden__/invalid/${basename(file, ".yaml")}.txt`,
    );
  });
});

describe("rendering options", () => {
  const doc = readFileSync(join(EXAMPLES, "showcase.yaml"), "utf8");

  test.each([0, 90, 180, 270])("rotation %i renders without errors", async (rotation) => {
    const text = doc.replace("settings:\n", `settings:\n  view: { rotation: ${rotation} }\n`);
    const result = await compile(text, { icons: testIcons });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.svg).toMatch(/^<svg /);
  });

  test("ids can be turned off for clean exports", async () => {
    const withIds = await compile(doc, { icons: testIcons });
    const without = await compile(doc, { icons: testIcons, ids: false });
    expect(withIds.svg).toContain('data-id="api"');
    expect(without.svg).not.toContain("data-id");
  });

  test("theme override", async () => {
    const result = await compile(doc, { icons: testIcons, theme: "dark" });
    expect(result.svg).toContain('fill="#020617"');
  });
});
