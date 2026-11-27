/**
 * Built-in placeholder glyphs (`builtin:<name>`). Original, licence-free line icons on a
 * 24×24 grid, stroked with currentColor so they can be recoloured. Real icon sets arrive
 * as icon packs in M5.
 */
export const GLYPHS: Record<string, string> = {
  server: "M4 4h16v6H4z M4 14h16v6H4z M7.5 7h.01 M7.5 17h.01 M11 7h6 M11 17h6",
  database:
    "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  cloud: "M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 9.5 4.25 4.25 0 0 0 7 18z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21c0-4 3.6-6 8-6s8 2 8 6",
  queue: "M3 8h4v8H3z M10 8h4v8h-4z M17 8h4v8h-4z",
  cache: "M13 2 4 14h7l-1 8 9-12h-7z",
  loadbalancer: "M12 3v6 M12 9l-7 6 M12 9l7 6 M12 9v6 M3 15h4v6H3z M10 15h4v6h-4z M17 15h4v6h-4z",
  function: "M7 4c2.5 0 3.5 1 4.2 3.2L15.5 20 M7 20l5.2-9",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M3 12h18 M12 3c3 3 3 15 0 18 M12 3c-3 3-3 15 0 18",
  lock: "M6 11h12v10H6z M8 11V7a4 4 0 0 1 8 0v4",
  container: "M12 3l8 4.5v9L12 21l-8-4.5v-9z M12 12l8-4.5 M12 12v9 M12 12 4 7.5",
  storage: "M4 6h16l-2 14H6z M4 6c0 1 3.6 2 8 2s8-1 8-2",
};

export function glyphSvgBody(name: string): string | undefined {
  const d = GLYPHS[name];
  if (!d) return undefined;
  return `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
}
