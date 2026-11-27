/**
 * The DSL schema (PLAN.md §4) — the single source of truth. The JSON Schema used for
 * editor autocomplete is generated from this via `dslJsonSchema()`.
 */
import { z } from "zod";

const num = z.number().finite();
export const Vec2 = z.tuple([num, num]).describe("Grid coordinates [x, y] in cells");
export const Size2 = z
  .tuple([num.positive(), num.positive()])
  .describe("Footprint [width, depth] in cells");
export const Id = z
  .string()
  .regex(
    /^[A-Za-z_][A-Za-z0-9_-]*$/,
    "ids start with a letter or _ and contain letters, digits, _ or -",
  );
const Color = z.string().min(1).describe("Any CSS colour, e.g. #3b82f6 or teal");

export const Face = z.enum(["top", "left", "right", "all"]);
export const Shape = z.enum(["box", "cylinder", "plane", "decal"]);
export const LabelPlane = z.enum(["screen", "ground"]);

export const IconObject = z.strictObject({
  src: z.string().min(1).describe("builtin:<name>, @alias, relative path, https: URL or data: URI"),
  faces: z
    .union([Face, z.array(Face).min(1)])
    .optional()
    .describe("Faces to draw the icon on"),
  size: z.number().gt(0).max(1).optional().describe("Fraction of the face (0–1]"),
  opacity: z.number().min(0).max(1).optional(),
  color: Color.optional().describe("Colour for monochrome icons"),
});
export const IconRef = z.union([z.string().min(1), IconObject]);

const visualFields = {
  shape: Shape.optional(),
  size: Size2.optional(),
  height: num.min(0).optional().describe("Height in cells"),
  color: Color.optional(),
  icon: IconRef.optional(),
  labelPlane: LabelPlane.optional(),
};

export const TypeDef = z.strictObject(visualFields);

/** Built-in type names; keys of CATALOG (checked by a test). Listed here for editor autocomplete. */
export const BUILTIN_TYPES = [
  "server",
  "container",
  "function",
  "loadbalancer",
  "queue",
  "database",
  "cache",
  "storage",
  "firewall",
  "area",
  "user",
  "internet",
  "cloud",
] as const;

export const Resource = z.strictObject({
  type: z
    .union([z.enum(BUILTIN_TYPES), z.string()])
    .optional()
    .describe("Built-in type (server, database, …) or a key of `types`"),
  in: Id.optional().describe("Parent group id"),
  at: Vec2.optional().describe(
    "Pinned position, relative to the parent group. Omit for auto-layout.",
  ),
  label: z.string().optional(),
  ...visualFields,
});

export const GroupStyle = z.enum(["region", "zone", "plain"]);
export const Group = z.strictObject({
  in: Id.optional().describe("Parent group id"),
  at: Vec2.optional().describe(
    "Pinned position, relative to the parent group. Omit for auto-layout.",
  ),
  size: Size2.optional().describe("Fixed size; omit to fit children"),
  label: z.string().optional(),
  color: Color.optional(),
  style: GroupStyle.optional(),
});

export const LINK_PATTERN =
  /^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*(->|<->|--)\s*([A-Za-z_][A-Za-z0-9_-]*)\s*$/;
export const LinkStyle = z.enum(["solid", "dashed", "dotted"]);
export const Arrow = z.enum(["end", "start", "both", "none"]);
export const Route = z.enum(["orthogonal", "straight"]);

export const LinkObject = z.strictObject({
  from: Id,
  to: Id,
  id: Id.optional().describe("Needed when the same pair is linked more than once"),
  label: z.string().optional(),
  style: LinkStyle.optional(),
  arrow: Arrow.optional(),
  route: Route.optional(),
  color: Color.optional(),
});
export const Link = z.union([
  z.string().regex(LINK_PATTERN, 'link shorthand is "a -> b", "a <-> b" or "a -- b"'),
  LinkObject,
]);

export const Settings = z.strictObject({
  view: z
    .strictObject({
      rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
    })
    .optional(),
  grid: z.strictObject({ style: z.enum(["none", "simple", "technical"]).optional() }).optional(),
  layout: z
    .strictObject({
      spacing: z.number().int().min(0).optional().describe("Cells between auto-placed siblings"),
      groupPadding: z.number().int().min(0).optional().describe("Cells of padding inside groups"),
    })
    .optional(),
  canvas: z
    .strictObject({
      at: Vec2.optional(),
      size: Size2.optional(),
      padding: z.number().min(0).optional(),
    })
    .optional(),
  theme: z.enum(["light", "dark"]).optional(),
});

export const Icons = z.strictObject({
  aliases: z.record(Id, IconRef).optional().describe("Reusable icons, referenced as @name"),
});

export const DiagramDsl = z.strictObject({
  version: z.literal(1),
  title: z.string().optional(),
  settings: Settings.optional(),
  icons: Icons.optional(),
  types: z.record(Id, TypeDef).optional(),
  groups: z
    .record(
      Id,
      Group.nullable().describe(
        "A group: an area on the ground that holds resources and other groups. Every field is optional.",
      ),
    )
    .optional()
    .describe("Groups (regions, VPCs, subnets…), keyed by id"),
  resources: z
    .record(
      Id,
      Resource.nullable().describe(
        "A resource: a server, database, queue… Every field is optional; without `at` it is placed automatically.",
      ),
    )
    .optional()
    .describe("Resources, keyed by id. Ids are shared with groups."),
  links: z
    .array(Link)
    .optional()
    .describe('Connections: "a -> b", "a <-> b", "a -- b" or { from, to, … }'),
});

export type DiagramDsl = z.infer<typeof DiagramDsl>;
export type ResourceDsl = z.infer<typeof Resource>;
export type GroupDsl = z.infer<typeof Group>;
export type IconRefDsl = z.infer<typeof IconRef>;
export type TypeDefDsl = z.infer<typeof TypeDef>;
export type LinkDsl = z.infer<typeof Link>;
export type FaceName = z.infer<typeof Face>;
export type ShapeName = z.infer<typeof Shape>;

/** JSON Schema for editors (CodeMirror, VS Code `yaml.schemas`). */
export function dslJsonSchema(): object {
  return {
    ...z.toJSONSchema(DiagramDsl, { target: "draft-7", io: "input" }),
    title: "Isometric Diagrammer DSL v1",
  };
}
