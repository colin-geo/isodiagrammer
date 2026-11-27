#!/usr/bin/env node
/** `isodiagram` — render, validate and inspect diagrams (PLAN.md §9.1). */
import { watch } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  applyChanges,
  applyEdit,
  type CompileResult,
  compile,
  type Diagnostic,
  dslJsonSchema,
  hasErrors,
  layoutInfo,
  pinAllOp,
  VERSION,
} from "@isodiagrammer/core";
import { nodeIconProvider } from "./icons.ts";

const HELP = `isodiagram ${VERSION} — isometric infrastructure diagrams from YAML

Usage:
  isodiagram render <file.yaml> -o <out.svg|out.png> [--scale 2] [--theme light|dark] [--watch]
  isodiagram validate <file.yaml>... [--format text|json]
  isodiagram freeze <file.yaml> [--stdout]
                                    Pin every auto-placed node: write its computed at: into
                                    the file (comments and formatting are kept)
  isodiagram schema                 Print the DSL JSON Schema (for VS Code yaml.schemas)

Options:
  -o, --output <path>   Output file; format from extension (.svg or .png)
      --scale <n>       PNG scale factor (default 2)
      --theme <name>    Override settings.theme
  -w, --watch           Re-render when the input file changes
      --format <fmt>    Diagnostics format for validate: text (default) or json
      --stdout          freeze: print the result instead of rewriting the file
  -h, --help            Show this help
  -v, --version         Show the version

Exit codes: 0 ok, 1 diagram has errors, 2 usage or I/O error.`;

class UsageError extends Error {}

export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      output: { type: "string", short: "o" },
      scale: { type: "string" },
      theme: { type: "string" },
      watch: { type: "boolean", short: "w" },
      format: { type: "string" },
      stdout: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  const [command, ...files] = positionals;
  if (values.version) {
    out(VERSION);
    return 0;
  }
  if (values.help || !command) {
    out(HELP);
    return command || values.help ? 0 : 2;
  }

  const theme = values.theme;
  if (theme !== undefined && theme !== "light" && theme !== "dark")
    throw new UsageError(`--theme must be light or dark`);

  switch (command) {
    case "schema":
      out(JSON.stringify(dslJsonSchema(), null, 2));
      return 0;

    case "validate": {
      if (files.length === 0) throw new UsageError("validate needs at least one file");
      const json = values.format === "json";
      const report: Record<string, ReturnType<typeof jsonDiag>[]> = {};
      let failed = false;
      for (const file of files) {
        const { result, text } = await compileFile(file, theme);
        failed ||= hasErrors(result.diagnostics);
        if (json) report[file] = result.diagnostics.map((d) => jsonDiag(d, result, text));
        else printDiagnostics(file, result, text);
      }
      if (json) out(JSON.stringify(report, null, 2));
      else if (!failed) err(`✓ ${files.length === 1 ? files[0] : `${files.length} files`} OK`);
      return failed ? 1 : 0;
    }

    case "freeze": {
      const [file] = files;
      if (!file || files.length > 1) throw new UsageError("freeze needs exactly one input file");
      const { result, text } = await compileFile(file, theme);
      printDiagnostics(file, result, text);
      if (hasErrors(result.diagnostics)) {
        err("not frozen: fix the errors first");
        return 1;
      }
      const layout = layoutInfo(result);
      const op = layout && pinAllOp(layout);
      const frozen = op ? applyChanges(text, applyEdit(text, op)) : text;
      if (values.stdout) process.stdout.write(frozen);
      else if (op) await writeFile(file, frozen);
      if (op?.kind === "pinAll")
        err(`pinned ${op.nodes.length} node(s)${values.stdout ? "" : ` in ${file}`}`);
      else err("nothing to freeze: every node is already pinned");
      return 0;
    }

    case "render": {
      const [file] = files;
      if (!file || files.length > 1) throw new UsageError("render needs exactly one input file");
      const output = values.output;
      if (!output) throw new UsageError("render needs -o <out.svg|out.png>");
      const ext = extname(output).toLowerCase();
      if (ext !== ".svg" && ext !== ".png") throw new UsageError("output must end in .svg or .png");
      const scale = values.scale === undefined ? 2 : Number(values.scale);
      if (!(scale > 0 && scale <= 16)) throw new UsageError("--scale must be between 0 and 16");

      const once = async () => {
        const { result, text } = await compileFile(file, theme);
        printDiagnostics(file, result, text);
        if (!result.svg) return 1;
        if (ext === ".svg") await writeFile(output, result.svg);
        else await writeFile(output, await toPng(result.svg, scale));
        err(`→ ${output}`);
        return hasErrors(result.diagnostics) ? 1 : 0;
      };
      const code = await once();
      if (!values.watch) return code;
      err(`watching ${file} (Ctrl+C to stop)`);
      let timer: ReturnType<typeof setTimeout> | undefined;
      watch(file, () => {
        clearTimeout(timer);
        timer = setTimeout(() => void once().catch((e: Error) => err(e.message)), 100);
      });
      return new Promise<number>(() => {});
    }

    default:
      throw new UsageError(`unknown command "${command}"`);
  }
}

async function compileFile(file: string, theme: string | undefined) {
  const text = await readFile(file, "utf8");
  const result = await compile(text, {
    icons: nodeIconProvider(dirname(resolve(file))),
    ids: false,
    ...(theme ? { theme: theme as "light" | "dark" } : {}),
  });
  return { result, text };
}

async function toPng(svg: string, scale: number): Promise<Buffer> {
  const { Resvg } = await import("@resvg/resvg-js");
  const r = new Resvg(svg, {
    fitTo: { mode: "zoom", value: scale },
    font: { loadSystemFonts: true, defaultFontFamily: "sans-serif" },
  });
  return r.render().asPng();
}

function position(result: CompileResult, offset: number | undefined) {
  if (offset === undefined) return undefined;
  const { line, col } = result.parse.lineCounter.linePos(offset);
  return { line, col };
}

function jsonDiag(d: Diagnostic, result: CompileResult, _text: string) {
  const pos = position(result, d.range?.from);
  return { ...d, ...(pos ? { line: pos.line, column: pos.col } : {}) };
}

function printDiagnostics(file: string, result: CompileResult, _text: string) {
  for (const d of result.diagnostics) {
    const pos = position(result, d.range?.from);
    const where = pos ? `${file}:${pos.line}:${pos.col}` : file;
    err(`${where}: ${d.severity} ${d.code}: ${d.message}${d.hint ? `\n    hint: ${d.hint}` : ""}`);
  }
}

const out = (s: string) => process.stdout.write(`${s}\n`);
const err = (s: string) => process.stderr.write(`${s}\n`);

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: Error) => {
      err(e instanceof UsageError ? `error: ${e.message}\n\n${HELP}` : `error: ${e.message}`);
      process.exit(2);
    },
  );
}
