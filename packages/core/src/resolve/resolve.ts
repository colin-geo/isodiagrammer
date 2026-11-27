/**
 * Stage 3 (PLAN.md §5.2): defaults, type merging, icon resolution, group tree and
 * semantic checks. Best effort: problems produce diagnostics and the offending part is
 * repaired or dropped so the rest of the diagram still renders.
 */
import type { Diagnostic, DocPath } from "../diagnostics.ts";
import {
  type DiagramDsl,
  type DirectionName,
  type FaceName,
  type IconRefDsl,
  LINK_PATTERN,
  type ResourceDsl,
  type ShapeName,
  type SideName,
} from "../dsl/schema.ts";
import { type SourceMap, withRange } from "../parse/parse.ts";
import { CATALOG, DEFAULT_VISUAL } from "./catalog.ts";
import { contrastInk, shade } from "./color.ts";
import { type IconProvider, type LoadedIcon, loadIcon } from "./icons.ts";

export type Vec2 = [number, number];
export type Rotation = 0 | 90 | 180 | 270;

export interface IconUse {
  /** symbol id in the rendered SVG */
  symbol: string;
  faces: FaceName[];
  size: number;
  opacity: number;
  color: string;
}

export interface ResourceModel {
  id: string;
  parent: string | undefined;
  at: Vec2 | undefined;
  size: Vec2;
  height: number;
  shape: ShapeName;
  color: string;
  icons: IconUse[];
  label: string;
  labelPlane: "screen" | "ground";
  path: DocPath;
}

export interface GroupModel {
  id: string;
  parent: string | undefined;
  at: Vec2 | undefined;
  size: Vec2 | undefined;
  label: string;
  color: string;
  style: "region" | "zone" | "plain";
  path: DocPath;
}

export interface LinkModel {
  id: string;
  from: string;
  to: string;
  label: string | undefined;
  style: "solid" | "dashed" | "dotted";
  arrow: "end" | "start" | "both" | "none";
  route: "orthogonal" | "straight";
  color: string | undefined;
  /** absolute world cells */
  via: Vec2[];
  fromSide: Side | undefined;
  toSide: Side | undefined;
  path: DocPath;
}

export type Side = SideName;

export interface ResolvedSettings {
  rotation: Rotation;
  grid: "none" | "simple" | "technical";
  spacing: number;
  groupPadding: number;
  direction: DirectionName;
  canvas: { at: Vec2 | undefined; size: Vec2 | undefined; padding: number };
  theme: "light" | "dark";
}

export interface Model {
  title: string | undefined;
  settings: ResolvedSettings;
  groups: GroupModel[];
  resources: ResourceModel[];
  links: LinkModel[];
  /** symbol id → icon */
  icons: Map<string, LoadedIcon>;
}

const GROUP_COLORS = { region: "#64748b", zone: "#0ea5e9", plain: "#94a3b8" } as const;

export async function resolveDiagram(
  dsl: DiagramDsl,
  sm: SourceMap,
  iconProvider: IconProvider,
): Promise<{ model: Model; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [];
  const err = (
    code: Diagnostic["code"],
    message: string,
    path: DocPath,
    key = false,
    hint?: string,
  ) =>
    diagnostics.push({
      severity: code.startsWith("W_") ? "warning" : "error",
      code,
      message,
      path,
      ...withRange(key ? sm.keyOf(path) : sm.value(path)),
      ...(hint ? { hint } : {}),
    });

  const s = dsl.settings ?? {};
  const settings: ResolvedSettings = {
    rotation: s.view?.rotation ?? 0,
    grid: s.grid?.style ?? "technical",
    spacing: s.layout?.spacing ?? 3,
    groupPadding: s.layout?.groupPadding ?? 2,
    direction: s.layout?.direction ?? "right",
    canvas: { at: s.canvas?.at, size: s.canvas?.size, padding: s.canvas?.padding ?? 2 },
    theme: s.theme ?? "light",
  };

  // ---- ids: one namespace ----------------------------------------------------
  const groupEntries = Object.entries(dsl.groups ?? {});
  const groupIds = new Set(groupEntries.map(([id]) => id));
  // The group wins; the clashing resource is reported and dropped.
  const resourceEntries = Object.entries(dsl.resources ?? {}).filter(([id]) => {
    if (!groupIds.has(id)) return true;
    err(
      "E_DUPLICATE_ID",
      `"${id}" is used as both a group and a resource id`,
      ["resources", id],
      true,
      "Ids are shared between groups and resources; rename one.",
    );
    return false;
  });

  // ---- groups --------------------------------------------------------------------
  const groups: GroupModel[] = groupEntries.map(([id, g]) => {
    const style = g?.style ?? "plain";
    return {
      id,
      parent: g?.in,
      at: g?.at as Vec2 | undefined,
      size: g?.size as Vec2 | undefined,
      label: g?.label ?? id,
      color: g?.color ?? GROUP_COLORS[style],
      style,
      path: ["groups", id],
    };
  });
  const groupById = new Map(groups.map((g) => [g.id, g]));
  for (const g of groups) {
    if (g.parent !== undefined && !groupById.has(g.parent)) {
      err("E_UNKNOWN_GROUP", `Unknown group "${g.parent}"`, [...g.path, "in"]);
      g.parent = undefined;
    }
  }
  // Break cycles deterministically (document order).
  for (const g of groups) {
    const seen = new Set<string>([g.id]);
    let p = g.parent;
    while (p !== undefined) {
      if (seen.has(p)) {
        err("E_GROUP_CYCLE", `Group "${g.id}" is inside itself via "in:"`, [...g.path, "in"]);
        g.parent = undefined;
        break;
      }
      seen.add(p);
      p = groupById.get(p)?.parent;
    }
  }

  // ---- icons -----------------------------------------------------------------------
  const aliases = dsl.icons?.aliases ?? {};
  const symbols = new Map<string, string>(); // src → symbol id
  const icons = new Map<string, LoadedIcon>();
  const missing = new Set<string>();
  const iconCache = new Map<string, Promise<LoadedIcon | undefined>>();

  const symbolFor = async (src: string, path: DocPath): Promise<string | undefined> => {
    const existing = symbols.get(src);
    if (existing) return existing;
    if (missing.has(src)) return undefined;
    let p = iconCache.get(src);
    if (!p) {
      p = loadIcon(src, iconProvider).catch(() => undefined);
      iconCache.set(src, p);
    }
    const icon = await p;
    if (!icon) {
      missing.add(src);
      err("W_ICON_NOT_FOUND", `Icon not found: ${src}`, path);
      return undefined;
    }
    const id = `icon-${symbols.size}`;
    symbols.set(src, id);
    icons.set(id, icon);
    return id;
  };

  const expandIcon = (ref: IconRefDsl, path: DocPath) => {
    const obj = typeof ref === "string" ? { src: ref } : ref;
    if (obj.src.startsWith("@")) {
      const name = obj.src.slice(1);
      const alias = aliases[name];
      if (alias === undefined) {
        err(
          "E_UNKNOWN_ICON_ALIAS",
          `Unknown icon alias "@${name}"`,
          path,
          false,
          "Define it under icons.aliases.",
        );
        return undefined;
      }
      const base = typeof alias === "string" ? { src: alias } : alias;
      return { ...base, ...obj, src: base.src };
    }
    return obj;
  };

  // ---- resources -------------------------------------------------------------------
  const types = dsl.types ?? {};
  const resources: ResourceModel[] = [];
  for (const [id, raw] of resourceEntries) {
    const r: ResourceDsl = raw ?? {};
    const path: DocPath = ["resources", id];
    const typeName = r.type ?? "server";
    const typeDef = types[typeName];
    const cat = CATALOG[typeName];
    if (!typeDef && !cat) {
      err(
        "W_UNKNOWN_TYPE",
        `Unknown type "${typeName}" — drawn as a plain box`,
        [...path, "type"],
        false,
        `Built-in types: ${Object.keys(CATALOG).join(", ")}. Or define it under types.`,
      );
    }
    const base = cat ?? DEFAULT_VISUAL;
    const shape = r.shape ?? typeDef?.shape ?? base.shape;
    const color = r.color ?? typeDef?.color ?? base.color;
    const visual = {
      shape,
      size: (r.size ?? typeDef?.size ?? base.size) as Vec2,
      height: r.height ?? typeDef?.height ?? (shape === "plane" ? 0 : base.height),
      color,
      labelPlane: r.labelPlane ?? typeDef?.labelPlane ?? base.labelPlane,
    };

    const iconSources: { ref: IconRefDsl; path: DocPath }[] = [];
    if (r.icon !== undefined) iconSources.push({ ref: r.icon, path: [...path, "icon"] });
    else if (typeDef?.icon !== undefined)
      iconSources.push({ ref: typeDef.icon, path: ["types", typeName, "icon"] });
    else if (base.icon)
      iconSources.push({ ref: { src: base.icon.src, faces: base.icon.faces }, path });

    const iconUses: IconUse[] = [];
    for (const { ref, path: ipath } of iconSources) {
      const icon = expandIcon(ref, ipath);
      if (!icon) continue;
      const symbol = await symbolFor(icon.src, ipath);
      if (!symbol) continue;
      const faces =
        icon.faces === undefined
          ? shape === "decal"
            ? ["all" as const]
            : ["top" as const]
          : Array.isArray(icon.faces)
            ? icon.faces
            : [icon.faces];
      iconUses.push({
        symbol,
        faces,
        size: icon.size ?? (shape === "decal" ? 1 : 0.6),
        opacity: icon.opacity ?? 1,
        color: icon.color ?? (shape === "decal" ? color : contrastInk(shade(color, 0.25))),
      });
    }

    let parent = r.in;
    if (parent !== undefined && !groupById.has(parent)) {
      err("E_UNKNOWN_GROUP", `Unknown group "${parent}"`, [...path, "in"]);
      parent = undefined;
    }
    resources.push({
      id,
      parent,
      at: r.at as Vec2 | undefined,
      ...visual,
      icons: iconUses,
      label: r.label ?? id,
      path,
    });
  }

  for (const n of [...groups, ...resources]) {
    if (n.parent !== undefined && n.at && (n.at[0] < 0 || n.at[1] < 0)) {
      err(
        "E_NEGATIVE_AT",
        `"${n.id}" is inside "${n.parent}", so "at" is relative to it and can't be negative`,
        [...n.path, "at"],
      );
      n.at = [Math.max(0, n.at[0]), Math.max(0, n.at[1])];
    }
  }

  // ---- links -------------------------------------------------------------------------
  const nodeIds = new Set([...groupIds, ...resources.map((r) => r.id)]);
  const links: LinkModel[] = [];
  const linkIds = new Set<string>();
  (dsl.links ?? []).forEach((l, i) => {
    const path: DocPath = ["links", i];
    let link: LinkModel;
    if (typeof l === "string") {
      const m = LINK_PATTERN.exec(l) as RegExpExecArray;
      const [, from, op, to] = m as unknown as [string, string, string, string];
      link = {
        id: `${from}->${to}`,
        from,
        to,
        label: undefined,
        style: "solid",
        arrow: op === "->" ? "end" : op === "<->" ? "both" : "none",
        route: "orthogonal",
        color: undefined,
        via: [],
        fromSide: undefined,
        toSide: undefined,
        path,
      };
    } else {
      link = {
        id: l.id ?? `${l.from}->${l.to}`,
        from: l.from,
        to: l.to,
        label: l.label,
        style: l.style ?? "solid",
        arrow: l.arrow ?? "end",
        route: l.route ?? "orthogonal",
        color: l.color,
        via: (l.via ?? []).map(([x, y]) => [x, y] as Vec2),
        fromSide: l.fromSide,
        toSide: l.toSide,
        path,
      };
    }
    let ok = true;
    for (const end of ["from", "to"] as const) {
      if (!nodeIds.has(link[end])) {
        err(
          "E_UNKNOWN_LINK_ENDPOINT",
          `Link ${end} "${link[end]}" is not a group or resource`,
          typeof l === "string" ? path : [...path, end],
        );
        ok = false;
      }
    }
    if (linkIds.has(link.id)) {
      err(
        "E_DUPLICATE_LINK_ID",
        `Duplicate link id "${link.id}"`,
        path,
        false,
        "Give one of the links an explicit `id`.",
      );
      ok = false;
    }
    if (!ok) return;
    // An arrowhead on a hidden (back) side of a solid can't be seen.
    const solid = (id: string) => {
      const r = resources.find((x) => x.id === id);
      return !!r && r.shape !== "plane" && r.height > 0;
    };
    const ends = [
      ["toSide", link.toSide, link.to, link.arrow === "end" || link.arrow === "both"],
      ["fromSide", link.fromSide, link.from, link.arrow === "start" || link.arrow === "both"],
    ] as const;
    for (const [key, side, id, arrow] of ends) {
      if (arrow && side?.startsWith("back-") && solid(id))
        err(
          "W_HIDDEN_ARROW",
          `The arrowhead on "${id}" is on its ${side} side, which is hidden behind it`,
          [...path, key],
          false,
          "Use left or right, the sides that face the viewer.",
        );
    }
    linkIds.add(link.id);
    links.push(link);
  });

  return {
    model: { title: dsl.title, settings, groups, resources, links, icons },
    diagnostics,
  };
}
