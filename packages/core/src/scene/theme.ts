export interface Theme {
  background: string;
  paper: string;
  gridMinor: string;
  gridMajor: string;
  text: string;
  mutedText: string;
  link: string;
  halo: string;
  groupFillOpacity: number;
  edge: number;
}

export const THEMES: Record<"light" | "dark", Theme> = {
  light: {
    background: "#f8fafc",
    paper: "#ffffff",
    gridMinor: "#e2e8f0",
    gridMajor: "#cbd5e1",
    text: "#0f172a",
    mutedText: "#475569",
    link: "#475569",
    halo: "#ffffff",
    groupFillOpacity: 0.08,
    edge: -0.35,
  },
  dark: {
    background: "#020617",
    paper: "#0f172a",
    gridMinor: "#1e293b",
    gridMajor: "#334155",
    text: "#e2e8f0",
    mutedText: "#94a3b8",
    link: "#94a3b8",
    halo: "#0f172a",
    groupFillOpacity: 0.16,
    edge: -0.45,
  },
};

export const FONT_FAMILY = "Inter, 'Segoe UI', system-ui, -apple-system, sans-serif";

/**
 * Approximate label width. M1 placeholder: PLAN.md §5.2 calls for a bundled font's metrics
 * table so browser and Node measure identically — this is deterministic, just not exact.
 */
export function textWidth(text: string, size: number, weight = 400): number {
  return text.length * size * (weight >= 600 ? 0.6 : 0.56);
}
