import { describe, expect, test } from "vitest";
import { parseDiagram } from "./parse.ts";

/** The source text a diagnostic points at. */
const at = (text: string, r: { from: number; to: number } | undefined) =>
  r ? text.slice(r.from, r.to) : undefined;

describe("parseDiagram", () => {
  test("minimal document", () => {
    const r = parseDiagram("version: 1\n");
    expect(r.diagnostics).toEqual([]);
    expect(r.dsl).toEqual({ version: 1 });
  });

  test("bare resource entries are allowed (all defaults)", () => {
    const r = parseDiagram("version: 1\nresources:\n  web:\n");
    expect(r.diagnostics).toEqual([]);
    expect(r.dsl?.resources).toEqual({ web: null });
  });

  test("missing version", () => {
    const r = parseDiagram("resources: {}\n");
    expect(r.dsl).toBeUndefined();
    expect(r.diagnostics[0]?.path).toEqual(["version"]);
  });

  test("schema errors point at the exact offending value", () => {
    const text = `version: 1
settings:
  grid: { style: fancy }
resources:
  web: { at: [1, "two"] }
`;
    const r = parseDiagram(text);
    const byPath = Object.fromEntries(
      r.diagnostics.map((d) => [d.path.join("."), at(text, d.range)]),
    );
    expect(byPath).toEqual({ "settings.grid.style": "fancy", "resources.web.at.1": '"two"' });
  });

  test("unknown keys point at the key, with a dedicated code", () => {
    const text = "version: 1\nresources:\n  web: { colour: red }\n";
    const [d] = parseDiagram(text).diagnostics;
    expect(d?.code).toBe("E_UNKNOWN_KEY");
    expect(at(text, d?.range)).toBe("colour");
  });

  test("bad link shorthand gets a friendly message", () => {
    const text = "version: 1\nlinks:\n  - a => b\n";
    const [d] = parseDiagram(text).diagnostics;
    expect(d?.message).toMatch(/a -> b/);
    expect(at(text, d?.range)).toBe("a => b");
  });

  test("YAML syntax errors stop before schema validation", () => {
    const r = parseDiagram("version: 1\nresources:\n  web: { type: server\n");
    expect(r.dsl).toBeUndefined();
    expect(r.diagnostics.map((d) => d.code)).toContain("E_YAML_SYNTAX");
  });

  test("duplicate keys are reported as duplicate ids", () => {
    const r = parseDiagram("version: 1\nresources:\n  web: {}\n  web: {}\n");
    expect(r.diagnostics.map((d) => d.code)).toContain("E_DUPLICATE_ID");
  });
});
