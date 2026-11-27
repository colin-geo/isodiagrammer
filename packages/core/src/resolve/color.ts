/** Minimal colour maths for face shading. Accepts #rgb/#rrggbb; other CSS colours pass through. */

function parseHex(c: string): [number, number, number] | undefined {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return undefined;
  let h = m[1] as string;
  if (h.length === 3) h = [...h].map((ch) => ch + ch).join("");
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

const toHex = (rgb: number[]) =>
  `#${rgb
    .map((v) =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

/** Mix towards white (amount > 0) or black (amount < 0). */
export function shade(color: string, amount: number): string {
  const rgb = parseHex(color);
  if (!rgb) return color;
  const target = amount > 0 ? 255 : 0;
  const t = Math.abs(amount);
  return toHex(rgb.map((v) => v + (target - v) * t));
}

/** Relative luminance (0–1), used to pick a contrasting icon colour. */
export function luminance(color: string): number {
  const rgb = parseHex(color);
  if (!rgb) return 0.5;
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const contrastInk = (bg: string) => (luminance(bg) > 0.4 ? "#1e293b" : "#ffffff");
