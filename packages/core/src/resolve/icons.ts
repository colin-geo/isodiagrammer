/**
 * Icon loading is platform-specific, so it's injected (PLAN.md §5.1). The core turns each
 * distinct icon into one SVG <symbol>, which keeps exported files self-contained.
 */
import { glyphSvgBody } from "./glyphs.ts";

export interface LoadedIcon {
  /** viewBox of the symbol */
  viewBox: string;
  /** inner SVG markup of the symbol */
  body: string;
  /** monochrome icons can be recoloured via currentColor */
  monochrome: boolean;
}

export interface IconProvider {
  /** Resolve a non-builtin source (path / URL / data URI) to an icon, or undefined if missing. */
  load(src: string): Promise<LoadedIcon | undefined>;
}

export const noIcons: IconProvider = { load: async () => undefined };

export async function loadIcon(
  src: string,
  provider: IconProvider,
): Promise<LoadedIcon | undefined> {
  if (src.startsWith("builtin:")) {
    const body = glyphSvgBody(src.slice("builtin:".length));
    return body ? { viewBox: "0 0 24 24", body, monochrome: true } : undefined;
  }
  return provider.load(src);
}

/** Wrap arbitrary image bytes as an icon (rendered via <image>, not recolourable). */
export function imageIcon(dataUri: string): LoadedIcon {
  return {
    viewBox: "0 0 1 1",
    body: `<image href="${dataUri}" width="1" height="1" preserveAspectRatio="xMidYMid meet"/>`,
    monochrome: false,
  };
}

export function mimeForPath(path: string): string | undefined {
  const ext = path.toLowerCase().split(/[?#]/)[0]?.split(".").pop();
  return (
    {
      svg: "image/svg+xml",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      gif: "image/gif",
    } as Record<string, string>
  )[ext ?? ""];
}
