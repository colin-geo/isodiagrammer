/** Pan/zoom maths for the preview: screen = content·k + (x, y). Pure, unit-tested. */
export interface View {
  x: number;
  y: number;
  k: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Zoom by `factor`, keeping the screen point (px, py) fixed. */
export function zoomAt(v: View, factor: number, px: number, py: number): View {
  const k = clamp(v.k * factor, MIN_ZOOM, MAX_ZOOM);
  const r = k / v.k;
  return { k, x: px - (px - v.x) * r, y: py - (py - v.y) * r };
}

export function panBy(v: View, dx: number, dy: number): View {
  return { ...v, x: v.x + dx, y: v.y + dy };
}

/** Fit content (w×h) centred in a viewport (vw×vh). Never zooms in beyond 1:1. */
export function fit(w: number, h: number, vw: number, vh: number, padding = 24): View {
  if (w <= 0 || h <= 0 || vw <= 0 || vh <= 0) return { x: 0, y: 0, k: 1 };
  const k = clamp(Math.min((vw - 2 * padding) / w, (vh - 2 * padding) / h, 1), MIN_ZOOM, MAX_ZOOM);
  return { k, x: (vw - w * k) / 2, y: (vh - h * k) / 2 };
}

/** Intrinsic size from the root <svg width/height> attributes. */
export function svgSize(svg: string): { w: number; h: number } {
  const tag = /<svg\b[^>]*>/.exec(svg)?.[0] ?? "";
  const w = Number(/\swidth="([\d.]+)"/.exec(tag)?.[1] ?? 0);
  const h = Number(/\sheight="([\d.]+)"/.exec(tag)?.[1] ?? 0);
  return { w, h };
}
