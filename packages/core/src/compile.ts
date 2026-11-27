/** The engine's front door (PLAN.md §5.1). */
import type { Diagnostic } from "./diagnostics.ts";
import { type Placement, placeNodes } from "./layout/place.ts";
import { type RoutedLink, routeLinks } from "./layout/route.ts";
import { type ParseResult, parseDiagram, type SourceMap } from "./parse/parse.ts";
import { renderSvg } from "./render/svg.ts";
import { type IconProvider, noIcons } from "./resolve/icons.ts";
import { type Model, resolveDiagram } from "./resolve/resolve.ts";
import { buildScene, type Scene } from "./scene/build.ts";

export interface CompileOptions {
  icons?: IconProvider;
  /** overrides settings.theme */
  theme?: "light" | "dark";
  /** include data-id attributes (default true; the CLI turns them off for clean exports) */
  ids?: boolean;
}

export interface CompileResult {
  /** undefined only when the document can't be parsed or fails the schema */
  svg: string | undefined;
  diagnostics: Diagnostic[];
  sourceMap: SourceMap;
  parse: ParseResult;
  model?: Model;
  placement?: Placement;
  routes?: RoutedLink[];
  scene?: Scene;
}

const severityRank = { error: 0, warning: 1, info: 2 } as const;

export async function compile(text: string, opts: CompileOptions = {}): Promise<CompileResult> {
  const parse = parseDiagram(text);
  const base = { sourceMap: parse.sourceMap, parse };
  if (!parse.dsl)
    return { svg: undefined, diagnostics: sortDiagnostics(parse.diagnostics), ...base };

  const { model, diagnostics: resolveDiags } = await resolveDiagram(
    parse.dsl,
    parse.sourceMap,
    opts.icons ?? noIcons,
  );
  if (opts.theme) model.settings.theme = opts.theme;
  const { placement, diagnostics: layoutDiags } = await placeNodes(model, parse.sourceMap);
  const solid = new Set(
    model.resources.filter((r) => r.shape !== "plane" && r.height > 0).map((r) => r.id),
  );
  const routes = routeLinks(model.links, placement, model.settings.rotation, (id) => solid.has(id));
  const scene = buildScene(model, placement, routes);
  const svg = renderSvg(scene, { ids: opts.ids ?? true });
  const diagnostics = sortDiagnostics([...parse.diagnostics, ...resolveDiags, ...layoutDiags]);
  return { svg, diagnostics, model, placement, routes, scene, ...base };
}

function sortDiagnostics(ds: Diagnostic[]): Diagnostic[] {
  return [...ds].sort(
    (a, b) =>
      (a.range?.from ?? -1) - (b.range?.from ?? -1) ||
      severityRank[a.severity] - severityRank[b.severity],
  );
}
