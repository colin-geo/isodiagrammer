import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const run = promisify(execFile);
const MAIN = join(import.meta.dirname, "main.ts");
const EXAMPLES = join(import.meta.dirname, "../../../examples");

async function cli(...args: string[]) {
  try {
    const { stdout, stderr } = await run(process.execPath, [MAIN, ...args]);
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code: number; stdout: string; stderr: string };
    return { code: err.code, stdout: err.stdout, stderr: err.stderr };
  }
}

const tmp = () => mkdtempSync(join(tmpdir(), "isodiagram-test-"));

describe("isodiagram CLI", () => {
  test("--version and --help", async () => {
    expect((await cli("--version")).stdout).toMatch(/^\d+\.\d+\.\d+/);
    const help = await cli("--help");
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("isodiagram render");
  });

  test("render to SVG", async () => {
    const out = join(tmp(), "d.svg");
    const r = await cli("render", join(EXAMPLES, "pinned.yaml"), "-o", out);
    expect(r.code).toBe(0);
    const svg = readFileSync(out, "utf8");
    expect(svg).toMatch(/^<svg /);
    expect(svg).not.toContain("data-id"); // clean export
  });

  test("render to PNG", async () => {
    const out = join(tmp(), "d.png");
    const r = await cli("render", join(EXAMPLES, "pinned.yaml"), "-o", out, "--scale", "1");
    expect(r.code).toBe(0);
    expect(readFileSync(out).subarray(1, 4).toString()).toBe("PNG");
  });

  test("local icon files are embedded", async () => {
    const dir = tmp();
    writeFileSync(
      join(dir, "logo.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>',
    );
    writeFileSync(join(dir, "d.yaml"), 'version: 1\nresources:\n  a: { icon: "./logo.svg" }\n');
    const r = await cli("render", join(dir, "d.yaml"), "-o", join(dir, "d.svg"));
    expect(r.code).toBe(0);
    expect(r.stderr).not.toContain("W_ICON_NOT_FOUND");
    expect(readFileSync(join(dir, "d.svg"), "utf8")).toContain("data:image/svg+xml;base64,");
  });

  test("validate: exit 0 for valid files, 1 with file:line:col diagnostics otherwise", async () => {
    const ok = await cli(
      "validate",
      join(EXAMPLES, "pinned.yaml"),
      join(EXAMPLES, "checkout-platform.yaml"),
    );
    expect(ok.code).toBe(0);
    const bad = await cli("validate", join(EXAMPLES, "invalid", "schema-errors.yaml"));
    expect(bad.code).toBe(1);
    expect(bad.stderr).toMatch(/schema-errors\.yaml:3:18: error E_SCHEMA/);
  });

  test("validate --format json", async () => {
    const file = join(EXAMPLES, "invalid", "semantic-errors.yaml");
    const r = await cli("validate", file, "--format", "json");
    expect(r.code).toBe(1);
    const report = JSON.parse(r.stdout);
    expect(report[file][0]).toMatchObject({ code: "E_GROUP_CYCLE", line: 4, column: 17 });
  });

  test("schema prints JSON Schema", async () => {
    const r = await cli("schema");
    const schema = JSON.parse(r.stdout);
    expect(schema.properties.resources).toBeDefined();
    expect(schema.required).toContain("version");
  });

  test("usage errors exit 2", async () => {
    expect((await cli("render", join(EXAMPLES, "pinned.yaml"))).code).toBe(2);
    expect((await cli("render", join(EXAMPLES, "pinned.yaml"), "-o", "x.gif")).code).toBe(2);
    expect((await cli("frobnicate")).code).toBe(2);
    expect((await cli("validate", "/no/such/file.yaml")).code).toBe(2);
  });
});
