/** Built-in resource types: the defaults under `types:` and per-resource overrides. */

import type { z } from "zod";
import type { FaceName, LabelPlane, ShapeName } from "../dsl/schema.ts";

export interface Visual {
  shape: ShapeName;
  size: [number, number];
  height: number;
  color: string;
  /** builtin glyph drawn on `faces` unless the resource sets its own icon */
  icon?: { src: string; faces: FaceName[] };
  labelPlane: z.infer<typeof LabelPlane>;
}

const box = (size: [number, number], height: number, color: string, glyph?: string): Visual => ({
  shape: "box",
  size,
  height,
  color,
  labelPlane: "screen",
  ...(glyph ? { icon: { src: `builtin:${glyph}`, faces: ["top"] } } : {}),
});

const cyl = (size: [number, number], height: number, color: string, glyph?: string): Visual => ({
  ...box(size, height, color, glyph),
  shape: "cylinder",
});

const decal = (glyph: string, color: string): Visual => ({
  shape: "decal",
  size: [1, 1],
  height: 1,
  color,
  labelPlane: "screen",
  icon: { src: `builtin:${glyph}`, faces: ["all"] },
});

export const CATALOG: Record<string, Visual> = {
  server: box([2, 2], 1.2, "#3b82f6", "server"),
  container: box([1, 1], 0.8, "#06b6d4", "container"),
  function: box([1, 1], 0.6, "#f59e0b", "function"),
  loadbalancer: box([2, 2], 0.5, "#8b5cf6", "loadbalancer"),
  queue: box([3, 1], 0.6, "#ec4899", "queue"),
  database: cyl([2, 2], 1.4, "#10b981", "database"),
  cache: cyl([2, 2], 0.8, "#ef4444", "cache"),
  storage: cyl([2, 2], 1, "#84cc16", "storage"),
  firewall: box([2, 1], 1, "#f97316", "lock"),
  area: { shape: "plane", size: [4, 4], height: 0, color: "#94a3b8", labelPlane: "ground" },
  user: decal("user", "#334155"),
  internet: decal("globe", "#334155"),
  cloud: decal("cloud", "#334155"),
};

export const DEFAULT_VISUAL: Visual = box([2, 2], 1, "#64748b");
