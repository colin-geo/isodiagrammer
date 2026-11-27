# Isometric Diagrammer — PLAN

## What this application is
Isometric Diagrammer is a **client-only** (no backend) Vite + Vue 3 + TypeScript app that turns a **YAML DSL** into a Cloudcraft-like **isometric SVG diagram** on a graph-paper grid.

Key user-facing features:
- Split-pane **YAML editor + live preview**
- Inline **diagnostics** (YAML parse + schema validation + semantic validation)
- **Pan/zoom** preview (implemented inside the SVG renderer)
- **Export** to **SVG** (serialize preview `<svg>`) and **PNG** (rasterize SVG via `<img>` + `<canvas>`)
- **Icons**: built-in glyphs and an on-disk icon library served from `public\icon-lib\` (with a manifest picker UI)
- **Groups**, **resources**, **links**, and an optional **notes overlay** layer

## How to build / run / test
(From `package.json`)
- Install: `npm install`
- Dev: `npm run dev`
- Lint: `npm run lint`
- Tests (watch): `npm run test`
- Tests (CI): `npm run test:run`
  - Single test file: `npm run test:run -- src\diagram\parse.test.ts`
  - Single test name: `npm run test:run -- -t "rejects nested groups"`
- Build: `npm run build`
- Preview build: `npm run preview`

Note: `npm run dev` and `npm run build` both run `scripts\generate-icon-manifest.mjs` before Vite.

## High-level architecture (big picture)
This app is organized around a **pure data pipeline** + a UI shell.

### Runtime dataflow (YAML → SVG)
1. **Edit YAML**
   - `src\YamlEditor.vue` wraps CodeMirror 6.
   - The editor consumes diagnostics (with optional `{from,to}` ranges) and renders them via a CodeMirror linter.

2. **Parse + structural validation**
   - `src\diagram\parse.ts`:
     - Parses YAML using `yaml.parseDocument` (captures YAML parser errors/warnings).
     - Converts YAML to JSON (`doc.toJSON()`).
     - Validates against Zod schema `DiagramDslSchema` from `src\diagram\dsl.ts`.
     - Produces `ParseResult` with diagnostics and best-effort ranges.

3. **Normalize + semantic validation**
   - `src\diagram\normalize.ts`:
     - Applies defaults and converts the parsed DSL into a renderer-friendly `DiagramModel`.
     - Computes derived fields (notably `ResourceModel.atAbs` from grouping).
     - Enforces semantics that Zod cannot (bounds checks, missing references, ambiguity checks).
     - Produces a normalized model + diagnostics.

4. **Render SVG**
   - `src\diagram\DiagramSvg.vue`:
     - Renders groups/resources/links/notes into a single `<svg>`.
     - Performs isometric projection via `src\diagram\isometric.ts`.
     - Uses `src\diagram\catalog.ts` (and `typeDefs`) for resource footprints/heights/shapes.
     - Projects icons onto faces and renders labels either in the ground plane or screen plane.

5. **Export**
   - `src\diagram\export.ts`:
     - SVG: clone + serialize the preview `<svg>`.
     - PNG: clone SVG, inline external `<image href="…">` as data URIs, then rasterize.
     - Special-case: for technical grid patterns, counter-scale stroke widths during PNG export to avoid “fat grid” at higher raster scales.

### UI shell
- `src\App.vue` owns the editor/preview split layout and user actions (open/save YAML, export buttons, toggles).
- `src\DslHelp.vue` renders the bundled DSL help markdown (`src\help\dsl-help.md`).
- `src\IconLibraryPicker.vue` loads `/icon-lib/manifest.json` and inserts icon identifiers into the editor.

### Icon library tooling
- `scripts\generate-icon-manifest.mjs` walks `public\icon-lib\<pack>\**\*.svg|*.png` and writes `public\icon-lib\manifest.json`.
- Icon URLs in the DSL can reference this library via `url: "lib:<pack>/<icon>"` (defaults to `.svg` if no extension).

## The DSL model (conceptual)
The DSL is defined in TypeScript/Zod in `src\diagram\dsl.ts` and is versioned.

At a high level:
- **`settings`** controls grid rendering, canvas sizing, orientation, and link defaults.
- **`iconDefs`** defines reusable icons by name.
- **`typeDefs`** defines custom resource type defaults (shape/size/height/style/icons/etc.).
- **`groups`** are rectangular containers (absolute coordinates).
- **`resources`** are placed either absolutely or inside a group (relative coordinates) and render as 3D-ish shapes.
- **`links`** connect resources and/or groups.
- **`notes`** (top-level) optionally adds note markers + a side panel.

### Top-level document
Minimal skeleton:
```yaml
version: 1
settings: {}
iconDefs: {}
groups: {}
resources: {}
links: []
```

Only `version: 1` is required; other top-level keys are optional.

### Coordinates
- All coordinates are in **grid cells**.
- **Groups**: `at` is **absolute**.
- **Resources**:
  - If `in: <groupId>` is present, `at` is **relative to the group**.
  - Otherwise, `at` is **absolute**.
- Normalization computes:
  - `ResourceModel.atRel`: original DSL `at`.
  - `ResourceModel.atAbs`: absolute placement (group.at + resource.atRel).

### Semantic rules enforced in normalization
(Implemented in `src\diagram\normalize.ts`)
- If a resource references a missing group (`in:`), it’s skipped and a diagnostic is emitted.
- If a resource is inside a group:
  - `at` cannot be negative.
  - The resource **footprint must fit** within the group bounds.
- If `settings.canvas` is present:
  - Groups/resources that extend outside the canvas emit diagnostics.
- Links:
  - Endpoints may be a resource id or group id.
  - Ambiguous ids are rejected: the same id cannot be both a group id and a resource id if used by links.
  - Missing endpoints are rejected.
- Notes:
  - Notes can be configured at top-level `notes:` (preferred) or legacy `settings.notes:`.
  - `notes.items[].attachTo` may refer to a group id, resource id, or a link key (`meta.name` or `from->to`). If ambiguous, `kind` is required.

### Resource visuals resolution
(Implemented in `normalize.ts` + `catalog.ts`)
- `catalog.ts` provides the default visuals for built-in types (`server`, `database`, `container`, `queue`, `cache`, `area`, `decal`, etc.).
- `typeDefs.<type>` can override defaults (shape, size, height, style, rotation, decalPlane, default icons).
- Per-resource fields override both.

Resolution order:
1) Resource overrides (`resources.<id>.size/height/color/style/...`)
2) Type defaults (`typeDefs[resource.type]`)
3) Catalog defaults (`visualForType(resource.type)`)

### Icons
Icons can be provided:
- inline on a resource (`icon:` / `icons:`)
- by reference to `iconDefs` (`ref: <name>` or shorthand string `"@<name>"`)
- as built-in glyphs (license-safe placeholders)
- as URLs, including icon library URLs with `lib:`

Icon URL resolution rules (implemented in `normalize.ts`):
- `data:` and `http(s)://` are left as-is.
- `/absolute/path` stays absolute.
- `lib:pack/icon` resolves to `/icon-lib/pack/icon.svg` (defaults to `.svg`).
- other relative strings are treated as app-relative `/...`.

### Notes overlay
- Top-level `notes:` supports configuration + `items:`.
- Legacy `settings.notes:` supports configuration but **does not include** `items` or `panelPosition`.
- Notes text (`text` and `meta.notes`) can be a string or a non-empty list of strings.

## Implementation plan (agent-oriented)
This section describes how to implement this application (or large parts of it) from scratch, using the current code as the reference architecture.

### Phase 1 — Project scaffold
1. Create a Vite + Vue 3 + TypeScript project.
2. Add dependencies:
   - `vue`, `yaml`, `zod`
   - CodeMirror 6 packages for a YAML editor
   - `vitest` for tests
   - `eslint` + `eslint-plugin-vue` for linting
3. Add scripts matching `package.json` (dev/build/lint/test/test:run/preview).

### Phase 2 — Define the DSL
1. Implement the DSL schema in `src\diagram\dsl.ts` (Zod):
   - Base types: `Vec2`, `Size2`, enums.
   - Settings: grid, render orientation, links defaults, canvas.
   - Notes: legacy settings + top-level notes with items.
   - Group/resource/link schemas and metadata.
   - Icons: union of inline icon defs and `ref` overrides; support string shorthand via preprocessing.
2. Add a human-readable spec in `src\help\dsl-help.md`.
3. Generate a machine-readable JSON Schema:
   - This repo provides it as `diagram-dsl.schema.yaml`.

### Phase 3 — Parse + diagnostics
1. Implement `parseDiagramDsl(text)`:
   - Parse YAML with `yaml.parseDocument`.
   - Produce YAML diagnostics (errors + warnings) with ranges if possible.
   - Convert to JSON and validate with Zod using `safeParse`.
   - Convert Zod issues into diagnostics with paths and (best-effort) ranges.
2. Write baseline tests in `src\diagram\parse.test.ts`:
   - Minimal diagram parses.
   - Nested group rejection.
   - Notes parsing.

### Phase 4 — Normalize into a render model
1. Define model types in `src\diagram\normalize.ts` (or a sibling module):
   - `DiagramModel`, `GroupModel`, `ResourceModel`, `LinkModel`, `NotesLayerModel`.
2. Implement `normalizeDiagram(dsl)`:
   - Apply settings defaults.
   - Build groups list + id lookup.
   - Build resources list:
     - Resolve type visual defaults.
     - Compute footprint/height/shape.
     - Compute `atAbs` based on `in`.
     - Enforce bounds: canvas bounds, group bounds.
     - Normalize icons and resolve URLs.
   - Build links list:
     - Validate endpoints, ambiguity, and derive defaults.
   - Build notes layer:
     - Merge top-level notes vs legacy settings.
     - Resolve `attachTo` for notes items (group/resource/link) and validate.

### Phase 5 — SVG renderer
1. Implement isometric math (`src\diagram\isometric.ts`): `projectIso`, bounds helpers.
2. Implement shape rendering in `DiagramSvg.vue`:
   - Boxes: top/left/right faces with shading.
   - Cylinders: top ellipse + segmented side arcs.
   - Planes/areas: flat ground plane rectangles.
   - Decals: icon-only markers (ground-projected or screen-flat depending on `decalPlane`).
3. Implement icon projection:
   - Faces: `top`, `front`, `side`, `left`, `right`, or `all`.
   - Fit modes: `contain` vs `stretch`.
   - Builtin icons: render from path data; unknown builtins should simply not render.
4. Implement labels:
   - Ground-plane text uses a plane transform matrix.
   - Screen-plane labels render untransformed at the projected anchor.
5. Implement grid:
   - Simple and technical modes (technical uses patterns projected onto the ground plane).
6. Implement links:
   - Orthogonal (grid-space polyline) and straight.
   - Optional anchors + via constraints.
   - Stroke style + arrow markers.
7. Implement notes overlay:
   - Markers on diagram.
   - Side panel with formatting placeholders.

### Phase 6 — Editor + UX glue
1. Create `YamlEditor.vue` with CodeMirror:
   - YAML mode + lint gutter.
   - Expose methods for focus/insert snippet.
2. Create `App.vue`:
   - Debounce rendering to reduce work and icon fetches.
   - Wire parse → normalize → render.
   - Display diagnostics list.
   - Persist split sizes in localStorage.
3. Add `IconLibraryPicker.vue`:
   - Fetch and display `public\icon-lib\manifest.json`.
   - Insert `lib:` URLs into YAML.

### Phase 7 — Export
1. Implement `serializeSvg(svg)` and `downloadSvg(svg)`.
2. For PNG:
   - Clone SVG, inline `<image href>` by fetching and converting to data URLs.
   - Rasterize at a configurable scale.
   - Counter-scale technical grid stroke widths in patterns.

## Important files (reference implementation)
- DSL schema: `src\diagram\dsl.ts`
- Parser + diagnostics: `src\diagram\parse.ts`
- Normalization + semantics: `src\diagram\normalize.ts`
- Renderer: `src\diagram\DiagramSvg.vue`
- Export: `src\diagram\export.ts`
- Icon tooling: `scripts\generate-icon-manifest.mjs`
- DSL docs: `src\help\dsl-help.md`
- Tests: `src\diagram\parse.test.ts`
