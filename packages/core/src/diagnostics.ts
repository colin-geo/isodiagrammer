/** Diagnostics shared by every pipeline stage (PLAN.md §4.3). */

export type Severity = "error" | "warning" | "info";

/** A path into the YAML document, e.g. ["resources", "web", "at", 0]. */
export type DocPath = readonly (string | number)[];

export interface Diagnostic {
  severity: Severity;
  code: DiagnosticCode;
  message: string;
  path: DocPath;
  /** Character offsets into the source text, when known. */
  range?: { from: number; to: number };
  hint?: string;
}

/** Stable codes; documented in docs/diagnostics.md. Never renumber or reuse. */
export type DiagnosticCode =
  | "E_YAML_SYNTAX"
  | "W_YAML"
  | "E_SCHEMA"
  | "E_UNKNOWN_KEY"
  | "E_DUPLICATE_ID"
  | "E_UNKNOWN_GROUP"
  | "E_GROUP_CYCLE"
  | "E_NEGATIVE_AT"
  | "E_GROUP_TOO_SMALL"
  | "E_FOOTPRINT_OVERLAP"
  | "E_UNKNOWN_LINK_ENDPOINT"
  | "E_DUPLICATE_LINK_ID"
  | "E_UNKNOWN_ICON_ALIAS"
  | "W_UNKNOWN_TYPE"
  | "W_ICON_NOT_FOUND"
  | "W_OUTSIDE_CANVAS"
  | "W_HIDDEN_ARROW"
  | "E_LAYOUT";

export const hasErrors = (ds: readonly Diagnostic[]) => ds.some((d) => d.severity === "error");
