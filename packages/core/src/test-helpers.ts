/** Shared helpers for tests (not exported from the package). */
import { parseDiagram } from "./parse/parse.ts";
import { type IconProvider, noIcons } from "./resolve/icons.ts";
import { resolveDiagram } from "./resolve/resolve.ts";

export async function resolveText(text: string, icons: IconProvider = noIcons) {
  const parsed = parseDiagram(text);
  if (!parsed.dsl) throw new Error(`invalid test document: ${JSON.stringify(parsed.diagnostics)}`);
  const r = await resolveDiagram(parsed.dsl, parsed.sourceMap, icons);
  return { ...r, sourceMap: parsed.sourceMap };
}
