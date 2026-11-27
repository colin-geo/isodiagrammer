/**
 * Stage 6: scene → self-contained SVG string. Deterministic: fixed number formatting,
 * fixed attribute order, symbols emitted in first-use order.
 */
import type { Prim, Scene } from "../scene/build.ts";
import { FONT_FAMILY } from "../scene/theme.ts";

const MARGIN = 24;

/** Round to 2 dp, no trailing zeros, no "-0". */
export function n(v: number): string {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) || r === 0 ? "0" : String(r);
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Re-format the numbers inside path data so output is stable and compact. */
const fmtPath = (d: string) => d.replace(/-?\d+(\.\d+)?(e-?\d+)?/g, (m) => n(Number(m)));

const matrix = (m: readonly number[]) => `matrix(${m.map(n).join(" ")})`;

function prim(p: Prim): string {
  switch (p.kind) {
    case "path": {
      const a = [`d="${fmtPath(p.d)}"`, `fill="${esc(p.fill)}"`];
      if (p.fillOpacity !== undefined) a.push(`fill-opacity="${n(p.fillOpacity)}"`);
      if (p.stroke)
        a.push(
          `stroke="${esc(p.stroke)}"`,
          `stroke-width="${n(p.strokeWidth ?? 1)}"`,
          `stroke-linejoin="round"`,
        );
      if (p.dash) a.push(`stroke-dasharray="${p.dash}"`);
      if (p.opacity !== undefined) a.push(`opacity="${n(p.opacity)}"`);
      return `<path ${a.join(" ")}/>`;
    }
    case "text": {
      const a = [
        `x="${n(p.x)}"`,
        `y="${n(p.y)}"`,
        `font-size="${n(p.size)}"`,
        `fill="${esc(p.fill)}"`,
        `text-anchor="${p.anchor}"`,
      ];
      if (p.weight) a.push(`font-weight="${p.weight}"`);
      if (p.matrix) a.push(`transform="${matrix(p.matrix)}"`);
      if (p.halo)
        a.push(
          `stroke="${esc(p.halo)}"`,
          `stroke-width="3"`,
          `stroke-linejoin="round"`,
          `paint-order="stroke"`,
        );
      return `<text ${a.join(" ")}>${esc(p.text)}</text>`;
    }
    case "icon": {
      const a = [
        `href="#${p.symbol}"`,
        `width="1"`,
        `height="1"`,
        `transform="${matrix(p.matrix)}"`,
        `color="${esc(p.color)}"`,
      ];
      if (p.opacity !== 1) a.push(`opacity="${n(p.opacity)}"`);
      return `<use ${a.join(" ")}/>`;
    }
  }
}

export interface RenderOptions {
  /** include data-id attributes for hit-testing (default true) */
  ids?: boolean;
}

export function renderSvg(scene: Scene, opts: RenderOptions = {}): string {
  const ids = opts.ids ?? true;
  const b = Number.isFinite(scene.bounds.minX)
    ? scene.bounds
    : { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const x = b.minX - MARGIN;
  const y = b.minY - MARGIN;
  const w = b.maxX - b.minX + 2 * MARGIN;
  const h = b.maxY - b.minY + 2 * MARGIN;

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${n(x)} ${n(y)} ${n(w)} ${n(h)}" width="${n(Math.ceil(w))}" height="${n(Math.ceil(h))}" font-family="${esc(FONT_FAMILY)}">`,
  );
  if (scene.title) out.push(`<title>${esc(scene.title)}</title>`);

  const used = new Set<string>();
  for (const it of scene.items) for (const p of it.prims) if (p.kind === "icon") used.add(p.symbol);
  if (used.size > 0) {
    out.push("<defs>");
    for (const [id, icon] of scene.symbols) {
      if (used.has(id))
        out.push(
          `<symbol id="${id}" viewBox="${icon.viewBox}" overflow="visible">${icon.body}</symbol>`,
        );
    }
    out.push("</defs>");
  }
  out.push(
    `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${scene.theme.background}"/>`,
  );

  let layer: string | undefined;
  for (const it of scene.items) {
    if (it.layer !== layer) {
      if (layer) out.push("</g>");
      out.push(`<g class="layer-${it.layer}">`);
      layer = it.layer;
    }
    const attrs = [`class="${it.role}"`];
    if (ids && it.id) attrs.push(`data-id="${esc(it.id)}"`);
    out.push(`<g ${attrs.join(" ")}>${it.prims.map(prim).join("")}</g>`);
  }
  if (layer) out.push("</g>");
  out.push("</svg>");
  return `${out.join("\n")}\n`;
}
