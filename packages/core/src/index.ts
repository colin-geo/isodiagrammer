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
export { applyEdit, diffChange, type EditOp } from "./edit/ops.ts";
export {
  applyChanges,
  removeAt,
  removeKey,
  setAt,
  setKey,
  type TextChange,
} from "./edit/yaml-edit.ts";
export { type LayoutInfo, layoutInfo, type NodeInfo } from "./layout/info.ts";
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
export type { Rotation, Vec2 } from "./resolve/resolve.ts";
export {
  footprintPolygon,
  type Pt,
  screenToWorld,
  worldToScreen,
  worldVecToScreen,
} from "./scene/iso.ts";

export const VERSION = "0.1.0";
