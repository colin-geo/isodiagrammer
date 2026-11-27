/**
 * Stage 5 (PLAN.md §5.2, §6.3): laid-out model → layered drawing primitives.
 *   floor   grid → groups (outer→inner) → planes → links → ground labels
 *   solids  boxes / cylinders / upright decals, depth-sorted
 *   overlay screen labels, link labels
 */
import type { Placed, Placement } from "../layout/place.ts";
import type { RoutedLink } from "../layout/route.ts";
import { shade } from "../resolve/color.ts";
import type { LoadedIcon } from "../resolve/icons.ts";
import type { GroupModel, IconUse, Model, ResourceModel, Vec2 } from "../resolve/resolve.ts";
import { depthOrder } from "./depth.ts";
import {
  faceMatrix,
  groundMatrix,
  type Matrix,
  type Pt,
  project,
  type Rect,
  rotatePoint,
  rotateRect,
  S,
} from "./iso.ts";
import { THEMES, type Theme, textWidth } from "./theme.ts";

export type Prim =
  | {
      kind: "path";
      d: string;
      fill: string;
      stroke?: string;
      strokeWidth?: number;
      dash?: string;
      opacity?: number;
      fillOpacity?: number;
    }
  | {
      kind: "text";
      x: number;
      y: number;
      text: string;
      size: number;
      fill: string;
      anchor: "start" | "middle" | "end";
      weight?: number;
      matrix?: Matrix;
      halo?: string;
    }
  | { kind: "icon"; symbol: string; matrix: Matrix; color: string; opacity: number };

export type Layer = "floor" | "solids" | "overlay";

export interface SceneItem {
  /** node or link id, for hit-testing (`data-id`) */
  id?: string;
  role: "grid" | "group" | "resource" | "link" | "label";
  layer: Layer;
  prims: Prim[];
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Scene {
  title: string | undefined;
  theme: Theme;
  items: SceneItem[];
  symbols: Map<string, LoadedIcon>;
  bounds: Bounds;
}

const pathOf = (pts: readonly Pt[], close = true) =>
  `M${pts.map(([x, y]) => `${x} ${y}`).join(" L")}${close ? " Z" : ""}`;

export function buildScene(
  model: Model,
  placement: Placement,
  routes: readonly RoutedLink[],
): Scene {
  const theme = THEMES[model.settings.theme];
  const rot = model.settings.rotation;
  const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const grow = ([x, y]: Pt) => {
    bounds.minX = Math.min(bounds.minX, x);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxY = Math.max(bounds.maxY, y);
  };
  /** project + track bounds */
  const P = (x: number, y: number, z = 0): Pt => {
    const p = project(x, y, z);
    grow(p);
    return p;
  };
  const growText = (
    x: number,
    y: number,
    text: string,
    size: number,
    anchor: "start" | "middle" | "end",
    weight = 400,
  ) => {
    const w = textWidth(text, size, weight);
    const x0 = anchor === "start" ? x : anchor === "middle" ? x - w / 2 : x - w;
    grow([x0 - 4, y - size]);
    grow([x0 + w + 4, y + size * 0.35]);
  };

  const view = (p: Placed): Rect =>
    rotateRect({ x: p.abs[0], y: p.abs[1], w: p.size[0], d: p.size[1] }, rot);
  const items: SceneItem[] = [];

  // ---- canvas + grid (world coordinates, then rotated) ------------------------------
  const canvas = canvasRect(model, placement);
  if (model.settings.grid !== "none") {
    const prims: Prim[] = [];
    const corner = (x: number, y: number) => {
      const [vx, vy] = rotatePoint([x, y], rot);
      return P(vx, vy);
    };
    const c = canvas;
    prims.push({
      kind: "path",
      d: pathOf([
        corner(c.x, c.y),
        corner(c.x + c.w, c.y),
        corner(c.x + c.w, c.y + c.d),
        corner(c.x, c.y + c.d),
      ]),
      fill: theme.paper,
    });
    const minor: string[] = [];
    const major: string[] = [];
    const technical = model.settings.grid === "technical";
    for (let x = c.x; x <= c.x + c.w; x++) {
      const seg = `M${corner(x, c.y).join(" ")} L${corner(x, c.y + c.d).join(" ")}`;
      (technical && x % 5 === 0 ? major : minor).push(seg);
    }
    for (let y = c.y; y <= c.y + c.d; y++) {
      const seg = `M${corner(c.x, y).join(" ")} L${corner(c.x + c.w, y).join(" ")}`;
      (technical && y % 5 === 0 ? major : minor).push(seg);
    }
    prims.push({
      kind: "path",
      d: minor.join(" "),
      fill: "none",
      stroke: theme.gridMinor,
      strokeWidth: 1,
    });
    if (major.length)
      prims.push({
        kind: "path",
        d: major.join(" "),
        fill: "none",
        stroke: theme.gridMajor,
        strokeWidth: 1.25,
      });
    items.push({ role: "grid", layer: "floor", prims });
  }

  // ---- groups (outer → inner) ----------------------------------------------------------
  const depthOf = (id: string): number => {
    const p = placement.get(id);
    return p?.parent ? 1 + depthOf(p.parent) : 0;
  };
  const groups = [...model.groups].sort((a, b) => depthOf(a.id) - depthOf(b.id));
  for (const g of groups) {
    const p = placement.get(g.id);
    if (p) items.push(groupItem(g, view(p), theme, P));
  }

  // ---- planes (floor) -------------------------------------------------------------------
  const resources = model.resources.filter((r) => placement.has(r.id));
  for (const r of resources.filter((r) => r.shape === "plane")) {
    const v = view(placement.get(r.id) as Placed);
    const prims: Prim[] = [
      {
        kind: "path",
        d: pathOf([P(v.x, v.y), P(v.x + v.w, v.y), P(v.x + v.w, v.y + v.d), P(v.x, v.y + v.d)]),
        fill: r.color,
        fillOpacity: 0.35,
        stroke: shade(r.color, -0.2),
        strokeWidth: 1,
      },
      ...faceIcons(r, v, 0),
    ];
    items.push({ id: r.id, role: "resource", layer: "floor", prims });
  }

  // ---- links (floor) + their labels (overlay) ---------------------------------------
  const linkLabels: SceneItem[] = [];
  for (const { link, points } of routes) {
    const vp = points; // already in the view frame
    const sp = vp.map(([x, y]) => P(x, y));
    const color = link.color ?? theme.link;
    const prims: Prim[] = [
      {
        kind: "path",
        d: pathOf(sp, false),
        fill: "none",
        stroke: color,
        strokeWidth: 2,
        ...(link.style === "dashed"
          ? { dash: "8 6" }
          : link.style === "dotted"
            ? { dash: "2 5" }
            : {}),
      },
    ];
    if (link.arrow === "end" || link.arrow === "both") prims.push(arrowHead(vp, color, P));
    if (link.arrow === "start" || link.arrow === "both")
      prims.push(arrowHead([...vp].reverse(), color, P));
    items.push({ id: link.id, role: "link", layer: "floor", prims });
    if (link.label) {
      const [mx, my] = midpoint(sp);
      growText(mx, my - 6, link.label, 12, "middle");
      linkLabels.push({
        id: link.id,
        role: "label",
        layer: "overlay",
        prims: [
          {
            kind: "text",
            x: mx,
            y: my - 6,
            text: link.label,
            size: 12,
            fill: theme.mutedText,
            anchor: "middle",
            halo: theme.halo,
          },
        ],
      });
    }
  }

  // ---- solids (depth-sorted) ------------------------------------------------------------
  const solids = resources.filter((r) => r.shape !== "plane");
  const rects = solids.map((r) => view(placement.get(r.id) as Placed));
  const order = depthOrder(rects.map((v, i) => ({ ...v, h: (solids[i] as ResourceModel).height })));
  const labels: SceneItem[] = [];
  for (const i of order) {
    const r = solids[i] as ResourceModel;
    const v = rects[i] as Rect;
    const prims =
      r.shape === "cylinder"
        ? cylinder(r, v, theme, P)
        : r.shape === "decal"
          ? decal(r, v, P)
          : box(r, v, theme, P);
    items.push({ id: r.id, role: "resource", layer: "solids", prims });
  }

  // ---- resource labels ------------------------------------------------------------------
  for (const r of resources) {
    if (!r.label) continue;
    const v = view(placement.get(r.id) as Placed);
    if (r.labelPlane === "ground") {
      const m = groundMatrix(v.x + 0.15, r.shape === "plane" ? v.y + 0.25 : v.y + v.d + 0.15);
      growGroundText(m, r.label, 12, grow);
      items.push({
        id: r.id,
        role: "label",
        layer: "floor",
        prims: [
          {
            kind: "text",
            x: 0,
            y: 12,
            text: r.label,
            size: 12,
            fill: theme.text,
            anchor: "start",
            matrix: m,
          },
        ],
      });
    } else {
      const ly = project(v.x + v.w, v.y + v.d)[1] + 16;
      const lx = project(v.x + v.w / 2, v.y + v.d / 2)[0];
      growText(lx, ly, r.label, 13, "middle", 500);
      labels.push({
        id: r.id,
        role: "label",
        layer: "overlay",
        prims: [
          {
            kind: "text",
            x: lx,
            y: ly,
            text: r.label,
            size: 13,
            fill: theme.text,
            anchor: "middle",
            weight: 500,
            halo: theme.halo,
          },
        ],
      });
    }
  }
  items.push(...labels, ...linkLabels);

  const layerRank: Record<Layer, number> = { floor: 0, solids: 1, overlay: 2 };
  // Stable sort keeps the order within each layer.
  const ordered = items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => layerRank[a.it.layer] - layerRank[b.it.layer] || a.i - b.i);

  return {
    title: model.title,
    theme,
    items: ordered.map((o) => o.it),
    symbols: model.icons,
    bounds,
  };
}

// ---------------------------------------------------------------------------------------

function canvasRect(model: Model, placement: Placement): Rect {
  const c = model.settings.canvas;
  if (c.size) {
    const at = c.at ?? [0, 0];
    return { x: at[0], y: at[1], w: c.size[0], d: c.size[1] };
  }
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of placement.values()) {
    x0 = Math.min(x0, p.abs[0]);
    y0 = Math.min(y0, p.abs[1]);
    x1 = Math.max(x1, p.abs[0] + p.size[0]);
    y1 = Math.max(y1, p.abs[1] + p.size[1]);
  }
  if (!Number.isFinite(x0)) {
    x0 = 0;
    y0 = 0;
    x1 = 10;
    y1 = 10;
  }
  const pad = c.padding;
  const ax = Math.floor(x0 - pad);
  const ay = Math.floor(y0 - pad);
  return { x: ax, y: ay, w: Math.ceil(x1 + pad) - ax, d: Math.ceil(y1 + pad) - ay };
}

type ProjectFn = (x: number, y: number, z?: number) => Pt;

function groupItem(g: GroupModel, v: Rect, theme: Theme, P: ProjectFn): SceneItem {
  const outline = [P(v.x, v.y), P(v.x + v.w, v.y), P(v.x + v.w, v.y + v.d), P(v.x, v.y + v.d)];
  // Front-left edge: nothing inside the group can stand in front of it.
  const m = groundMatrix(v.x + 0.35, v.y + v.d - 0.3);
  return {
    id: g.id,
    role: "group",
    layer: "floor",
    prims: [
      {
        kind: "path",
        d: pathOf(outline),
        fill: g.color,
        fillOpacity: theme.groupFillOpacity,
        stroke: g.color,
        strokeWidth: g.style === "region" ? 1.5 : 1.25,
        ...(g.style === "region" ? { dash: "10 6" } : {}),
      },
      {
        kind: "text",
        x: 0,
        y: 0,
        text: g.label,
        size: 14,
        weight: 600,
        fill: shade(g.color, -0.25),
        anchor: "start",
        matrix: m,
      },
    ],
  };
}

function growGroundText(m: Matrix, text: string, size: number, grow: (p: Pt) => void) {
  const w = textWidth(text, size);
  for (const [u, v] of [
    [0, 0],
    [w, 0],
    [0, size * 1.3],
    [w, size * 1.3],
  ] as const)
    grow([m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]]);
}

function arrowHead(vp: readonly Vec2[], color: string, P: ProjectFn): Prim {
  const end = vp.at(-1) as Vec2;
  const prev = vp.at(-2) as Vec2;
  const dx = end[0] - prev[0];
  const dy = end[1] - prev[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const L = 0.45;
  const W = 0.22;
  const bx = end[0] - ux * L;
  const by = end[1] - uy * L;
  return {
    kind: "path",
    d: pathOf([P(end[0], end[1]), P(bx - uy * W, by + ux * W), P(bx + uy * W, by - ux * W)]),
    fill: color,
  };
}

function midpoint(pts: readonly Pt[]): Pt {
  const segs = pts.slice(1).map((p, i) => {
    const a = pts[i] as Pt;
    return { a, b: p, len: Math.hypot(p[0] - a[0], p[1] - a[1]) };
  });
  let half = segs.reduce((s, x) => s + x.len, 0) / 2;
  for (const s of segs) {
    if (half <= s.len) {
      const t = s.len ? half / s.len : 0;
      return [s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t];
    }
    half -= s.len;
  }
  return pts[0] ?? [0, 0];
}

function box(r: ResourceModel, v: Rect, theme: Theme, P: ProjectFn): Prim[] {
  const { x, y, w, d } = v;
  const h = r.height;
  const x1 = x + w;
  const y1 = y + d;
  const edge = shade(r.color, theme.edge);
  const face = (pts: Pt[], fill: string): Prim => ({
    kind: "path",
    d: pathOf(pts),
    fill,
    stroke: edge,
    strokeWidth: 1,
  });
  return [
    face([P(x, y1, 0), P(x1, y1, 0), P(x1, y1, h), P(x, y1, h)], r.color), // left (y = y1)
    face([P(x1, y, 0), P(x1, y1, 0), P(x1, y1, h), P(x1, y, h)], shade(r.color, -0.22)), // right (x = x1)
    face([P(x, y, h), P(x1, y, h), P(x1, y1, h), P(x, y1, h)], shade(r.color, 0.25)), // top
    ...faceIcons(r, v, h),
  ];
}

/** Icons projected onto box/plane faces. */
function faceIcons(r: ResourceModel, v: Rect, h: number): Prim[] {
  const out: Prim[] = [];
  const { x, y, w, d } = v;
  const cx = x + w / 2;
  const cy = y + d / 2;
  for (const icon of r.icons) {
    const faces = new Set(icon.faces.includes("all") ? ["top", "left", "right"] : icon.faces);
    if (faces.has("top")) {
      const s = Math.min(w, d) * icon.size;
      out.push(use(icon, faceMatrix([cx - s / 2, cy - s / 2, h], [s, 0, 0], [0, s, 0])));
    }
    if (h > 0 && faces.has("left")) {
      const s = Math.min(w, h) * icon.size;
      out.push(use(icon, faceMatrix([cx - s / 2, y + d, h / 2 + s / 2], [s, 0, 0], [0, 0, -s])));
    }
    if (h > 0 && faces.has("right")) {
      const s = Math.min(d, h) * icon.size;
      out.push(use(icon, faceMatrix([x + w, cy + s / 2, h / 2 + s / 2], [0, -s, 0], [0, 0, -s])));
    }
  }
  return out;
}

const use = (icon: IconUse, matrix: Matrix): Prim => ({
  kind: "icon",
  symbol: icon.symbol,
  matrix,
  color: icon.color,
  opacity: icon.opacity,
});

function cylinder(r: ResourceModel, v: Rect, theme: Theme, P: ProjectFn): Prim[] {
  const cx = v.x + v.w / 2;
  const cy = v.y + v.d / 2;
  const rad = Math.min(v.w, v.d) / 2;
  const h = r.height;
  // A ground circle of radius rad projects to an axis-aligned ellipse.
  const rx = Math.SQRT2 * rad * Math.cos(Math.PI / 6) * S;
  const ry = Math.SQRT2 * rad * 0.5 * S;
  const [px, pBot] = project(cx, cy, 0);
  const pTop = project(cx, cy, h)[1];
  for (const p of [
    [px - rx, pTop - ry],
    [px + rx, pBot + ry],
  ] as Pt[])
    P(...unproject(p));
  const edge = shade(r.color, theme.edge);
  const side = `M${px - rx} ${pTop} L${px - rx} ${pBot} A${rx} ${ry} 0 0 0 ${px + rx} ${pBot} L${px + rx} ${pTop} Z`;
  const shadeRight = `M${px} ${pTop + ry} L${px} ${pBot + ry} A${rx} ${ry} 0 0 0 ${px + rx} ${pBot} L${px + rx} ${pTop} A${rx} ${ry} 0 0 1 ${px} ${pTop + ry} Z`;
  const top = `M${px - rx} ${pTop} A${rx} ${ry} 0 1 0 ${px + rx} ${pTop} A${rx} ${ry} 0 1 0 ${px - rx} ${pTop} Z`;
  const prims: Prim[] = [
    { kind: "path", d: side, fill: r.color, stroke: edge, strokeWidth: 1 },
    { kind: "path", d: shadeRight, fill: shade(r.color, -0.22) },
    { kind: "path", d: side, fill: "none", stroke: edge, strokeWidth: 1 },
    { kind: "path", d: top, fill: shade(r.color, 0.25), stroke: edge, strokeWidth: 1 },
  ];
  for (const icon of r.icons) {
    if (!icon.faces.includes("top") && !icon.faces.includes("all")) continue;
    const s = rad * Math.SQRT2 * icon.size;
    prims.push(use(icon, faceMatrix([cx - s / 2, cy - s / 2, h], [s, 0, 0], [0, s, 0])));
  }
  return prims;
}

/** Screen point → a grid point on z=0 with that projection (used only for bounds tracking). */
function unproject([sx, sy]: Pt): [number, number, number] {
  const a = sx / (Math.cos(Math.PI / 6) * S);
  const b = sy / (0.5 * S);
  return [(a + b) / 2, (b - a) / 2, 0];
}

function decal(r: ResourceModel, v: Rect, P: ProjectFn): Prim[] {
  const cx = v.x + v.w / 2;
  const cy = v.y + v.d / 2;
  const [px, py] = project(cx, cy, 0);
  const rad = Math.min(v.w, v.d) / 2;
  const rx = Math.SQRT2 * rad * Math.cos(Math.PI / 6) * S * 0.7;
  const ry = Math.SQRT2 * rad * 0.5 * S * 0.7;
  const prims: Prim[] = [
    {
      kind: "path",
      d: `M${px - rx} ${py} A${rx} ${ry} 0 1 0 ${px + rx} ${py} A${rx} ${ry} 0 1 0 ${px - rx} ${py} Z`,
      fill: "#000000",
      opacity: 0.12,
    },
  ];
  for (const icon of r.icons) {
    const size = Math.max(v.w, v.d) * S * icon.size * 1.1;
    const top = py - size - ry * 0.3;
    P(...unproject([px - size / 2, top]));
    P(...unproject([px + size / 2, py]));
    prims.push(use(icon, [size, 0, 0, size, px - size / 2, top]));
  }
  return prims;
}
