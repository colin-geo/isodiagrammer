/**
 * @isodiagrammer/core — framework-free engine (PLAN.md §5).
 * Pipeline: parse → schema → resolve → layout → scene → render.
 */
export { type CompileOptions, type CompileResult, compile } from "./compile.ts";
export {
  type Diagnostic,
  type DiagnosticCode,
  type DocPath,
  hasErrors,
  type Severity,
} from "./diagnostics.ts";
export { type DiagramDsl, dslJsonSchema } from "./dsl/schema.ts";
export { applyChanges, removeAt, setAt, type TextChange } from "./edit/at.ts";
export { parseDiagram, type SourceMap } from "./parse/parse.ts";
export { renderSvg } from "./render/svg.ts";
export { CATALOG } from "./resolve/catalog.ts";
export { GLYPHS } from "./resolve/glyphs.ts";
export {
  type IconProvider,
  imageIcon,
  type LoadedIcon,
  mimeForPath,
  noIcons,
} from "./resolve/icons.ts";

export const VERSION = "0.1.0";
