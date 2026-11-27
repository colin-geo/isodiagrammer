# Isometric Diagrammer — PLAN (v2, clean rewrite)

## 1. What we're building

A tool that turns a **YAML description of infrastructure** into a Cloudcraft-style **isometric diagram**, with:

- **Automatic layout**, plus fine-tuning by setting `at:` coordinates on any node.
- **Drag-and-drop editing** in the preview. Every drag is written back into the YAML as a minimal text edit that keeps comments and formatting.
- **Two front ends sharing one engine**: a web app (installable as a PWA) and a CLI for CI/docs pipelines. The design leaves room for a desktop app later (§12).
- **Icon packs**: bundled, permissively licensed packs (Font Awesome Free, Kubernetes, …) plus user-supplied packs and one-off icons.
- Export to self-contained **SVG** and **PNG**.

The goal is to publish it for others to use (e.g. Tiny Tool Town), so polish, docs, examples and licensing are in scope.

### Guiding principles

1. **The YAML text is the single source of truth.** The preview never holds state the text doesn't. Drags, palette drops and context-menu actions all produce *text edits*. One consequence: the editor's undo history is the app's only undo stack.
2. **The engine is a pure TypeScript library with no DOM.** Any input that comes from the platform (icons, fonts, files) is injected through an interface.
3. **Rendering doesn't depend on the preview.** The core produces a complete, self-contained SVG string, and export reuses that exact output. Nothing is scraped from the live DOM.
4. **Results are deterministic.** The same input gives byte-identical SVG in the browser and in Node. That's what makes golden tests and CI rendering trustworthy.
5. **One definition of the schema.** The Zod schema generates the JSON Schema, which drives editor autocomplete, hover docs and the VS Code YAML extension.

---

## 2. Technology decisions

### 2.1 Stack

| Area | Choice | Why |
|---|---|---|
| Monorepo | **pnpm workspaces** | Fast, strict dependency isolation, good workspace protocol |
| Language | TypeScript, `strict: true` everywhere | |
| Lint/format | **Biome** | One fast tool instead of ESLint + Prettier |
| Tests | **Vitest** (unit/golden), **Playwright** (e2e, visual) | |
| Validation | **Zod 4** (+ `z.toJSONSchema`) | |
| YAML | **`yaml`** (eemeli) | CST, source ranges, comment-preserving edits |
| Layout | **`elkjs`** (lazy-loaded, run in a Web Worker) | Compound (nested) graphs, layered layout |
| Editor | **CodeMirror 6** + `codemirror-json-schema` (YAML mode) | Schema autocomplete, hover, lint |
| UI framework | **Svelte 5** | The UI is thin (the core renders the SVG). Svelte gives small bundles and simple reactivity. Easy to swap because it touches very little. |
| PNG (Node) | **`@resvg/resvg-js`** | Fast and deterministic, no headless browser |
| Release | **Changesets** (npm packages), static hosting for the web app (Cloudflare Pages or GitHub Pages) | |

---

## 3. Repository layout

```
packages/
  core/       @isodiagrammer/core   pure TS: parse → resolve → layout → scene → svg; edit ops
  icons/      @isodiagrammer/icons  icon pack format, loader, bundled packs, pack build scripts
  cli/        @isodiagrammer/cli    `isodiagram` command (Node)
  web/        Svelte + Vite app (PWA)
examples/     example diagrams: docs gallery and golden-test fixtures
docs/         user docs (DSL reference generated partly from the schema)
```

Dependency direction: `core` ← `icons` ← `cli` / `web`. `core` never imports from the others.

---

## 4. The DSL (version 1, fresh design)

### 4.1 Example

```yaml
version: 1
title: Checkout platform

settings:
  view: { rotation: 0 }               # 0 | 90 | 180 | 270, rotates the whole scene
  grid: { style: technical }          # none | simple | technical
  layout: { direction: east, spacing: 2, groupPadding: 1 }
  canvas: { padding: 2 }              # or { at: [x, y], size: [w, h] } to force bounds
  theme: light                        # light | dark | <custom theme name>

icons:
  packs:
    fa: builtin:fontawesome-free
    k8s: builtin:kubernetes
    acme: ./icons/acme                # folder, or URL to a pack.json
  aliases:
    db: fa:solid/database

types:
  api:
    shape: box
    size: [2, 2]
    height: 1
    color: "#3b82f6"
    icon: { src: fa:solid/server, faces: [top] }

groups:
  cloud:   { label: AWS eu-west-1, style: region }
  vpc:     { in: cloud, label: VPC }
  public:  { in: vpc, label: Public subnet }
  private: { in: vpc, label: Private subnet, at: [0, 6] }   # pinned inside vpc

resources:
  lb:    { type: loadbalancer, in: public }
  web:   { type: api, in: public }
  db:    { type: database, in: private, at: [4, 1], icon: "@db" }
  cache: { type: cache, in: private }

links:
  - lb -> web
  - web -> db
  - { from: web, to: cache, label: sessions, style: dashed }

notes:
  panel: right
  items:
    - { attachTo: db, text: "Multi-AZ, nightly snapshots" }
```

### 4.2 Rules

- **Single id namespace.** Group ids and resource ids must all be unique across the document, and duplicates are an error. Links and notes can therefore refer to anything by id without a disambiguating `kind`.
- **Flat maps with `in:` for nesting.** Groups nest to any depth through `in:`. Flat maps (rather than nested `children:` blocks) were chosen deliberately: moving a node to another group, by hand or by drag-drop, is a **one-line edit** instead of cutting and pasting a YAML block. Cycles in `in:` are an error.
- **`at` is optional and relative to the parent group** (or to the world origin at top level).
  - Node without `at`: **auto-placed** by layout.
  - Node with `at`: **pinned**. Layout treats it as fixed.
  - Moving a group never requires editing its children.
- **Group `size` is optional.** If omitted, the group auto-fits its children plus `groupPadding`. If given, children must fit, and an error is reported if they don't.
- **Footprints within the same parent may not overlap** (error). This guarantees a valid draw order (§6.3).
- **Links**
  - String shorthand: `a -> b`, `a <-> b`, `a -- b` (no arrow). Object form: `{ from, to, label, style, route, via, id }`.
  - Default link id is `from->to`. If the same pair is linked twice, each link needs an explicit `id`.
  - `route: orthogonal | straight` (default orthogonal). `via:` gives grid waypoints.
- **Shapes:** `box`, `cylinder`, `plane` (flat area on the ground), `decal` (icon standing upright and facing the viewer, or lying on the ground).
- **Faces for icons** are named as they appear on screen: `top | left | right | all`. Values are view-relative, so they behave intuitively when the view is rotated.
- **Visual resolution order:** resource fields → `types.<type>` → built-in catalog defaults.
- **Icon references:** `pack:path` (e.g. `fa:solid/database`), `@alias`, a relative path, an `https:` URL or a `data:` URI.

### 4.3 Diagnostics

Every diagnostic is `{ severity, code, message, path, range, hint? }`:

- `code` is stable (e.g. `E_UNKNOWN_REF`, `E_FOOTPRINT_OVERLAP`, `W_ICON_NOT_FOUND`), and each code is documented in `docs/diagnostics.md`.
- `range` is **exact**. The parse step keeps a map from schema path to YAML node range, so every Zod or semantic error points at the offending text.

---

## 5. Core engine (`packages/core`)

### 5.1 Public API

```ts
compile(text: string, opts: CompileOptions): Promise<CompileResult>
//   CompileResult = { svg, scene, model, diagnostics, sourceMap, layout }

applyEdit(text: string, op: EditOp, ctx: CompileResult): TextChange[]
//   TextChange = { from, to, insert }  (CodeMirror-compatible)

screenToGrid(point, ctx): GridPoint   // inverse projection onto the ground plane
dslJsonSchema(): JSONSchema
```

`CompileOptions` carries the injected platform services: an `IconProvider` (resolves and loads icon SVGs), a `FontMetrics` provider, and the `LayoutEngine` (ELK running in-process or in a worker).

### 5.2 Pipeline stages (one folder each, each separately tested)

1. **`parse/`**: `yaml.parseDocument` → JS value + `SourceMap` (path → range) + YAML diagnostics.
2. **`schema/`**: Zod validation. Issues are mapped to ranges through the `SourceMap`. Also generates the JSON Schema.
3. **`resolve/`**: applies defaults, merges `types`, resolves icon references (async through `IconProvider`), builds the group tree, and runs semantic checks (unknown refs, cycles, duplicate ids, link id clashes, note attachments). Output: `Model`.
4. **`layout/`**: placement and link routing (§6). Output: integer grid positions for every node, group sizes, and link polylines.
5. **`scene/`**: converts the laid-out model into drawing primitives (polygons, ellipse arcs, paths, text, icon uses), each tagged with a `layer`, a `depth` and the node `id` it belongs to. Projection maths lives in `scene/iso.ts`: one module for the projection constants and view rotation.
6. **`render/svg.ts`**: scene → SVG string.
   - Icons are emitted once as `<symbol>` and placed with `<use>`, so the file is self-contained.
   - Every node's elements are wrapped in `<g data-id="…">` for hit-testing.
   - Font embedding is optional (a subset WOFF2).
7. **`edit/`**: edit operations (§7).
8. **`text/`**: label measurement from a bundled font's metrics table. This gives identical results in Node and the browser, with no dependency on canvas `measureText`.

### 5.3 Performance

- In the web app the whole pipeline runs in a **Web Worker**. The UI thread only applies the SVG string and handles input.
- Layout results are cached by a structural hash (nodes, `in`, `at`, sizes, links), so editing a label doesn't re-run ELK.
- `elkjs` is loaded lazily, only when some node is actually unpinned.

---

## 6. Layout, routing and draw order

### 6.1 Placement

Layout runs in **ground-plane grid space** (2D, integer cells). Projection to isometric happens afterwards.

1. Build a compound graph: groups are compound nodes, resources are leaves, and links are edges (between leaves, crossing group borders where needed).
2. Run ELK `layered` with `hierarchyHandling: INCLUDE_CHILDREN`, using the `settings.layout` direction and spacing. Groups with no internal edges use `rectpacking` instead.
3. **Pinned nodes are hard constraints.**
   - Within each parent, pinned children are placed first and become obstacles.
   - Unpinned children take ELK's relative arrangement, which is then **snapped to integer cells** and nudged to the nearest free cell. A deterministic spiral search, in document order, resolves any collisions.
4. Group sizes are computed bottom-up from children plus padding, unless `size` is given.
5. **Determinism:** inputs are always fed to ELK in document order, and golden tests assert that identical input gives identical output.

**Stability caveat:** adding a node can reshuffle unpinned siblings. Two mitigations: dragging a node pins it (§7), and a **"Pin all"** command (CLI: `isodiagram freeze`) writes every computed `at` into the YAML.

### 6.2 Link routing

- **Orthogonal routes** use A* on the cell grid. Resource footprints are obstacles; group borders are not. Cost is length + a turn penalty + a penalty for crossing an existing link.
- Links leave and enter on the sides of a footprint (left/right/top/bottom). The side is chosen by the router, or set with `fromSide` / `toSide`.
- `via:` waypoints are routed segment by segment.
- `straight` routes are a direct line clipped to the footprint edges.

### 6.3 Draw order (the classic isometric problem)

Links are drawn **on the ground plane**, like Cloudcraft does. That allows a simple, correct layered scheme:

1. **Floor layer**, in order: grid → group planes (outer to inner) → `plane` shapes → links and arrowheads → ground labels and decals.
2. **Solids layer**: boxes, cylinders and upright decals, **depth-sorted**.
   - Solids sit on the ground with axis-aligned footprints that don't overlap. A is behind B if, in the rotated view frame, `A.maxX ≤ B.minX` or `A.maxY ≤ B.minY`.
   - Topologically sort the pairs whose screen bounding boxes overlap. Non-overlapping footprints guarantee there are no cycles.
   - This logic gets heavy unit tests, including every view rotation.
3. **Overlay layer**: screen-facing labels, note markers, selection and drag feedback (feedback is preview-only and never exported).

Raised links and stacked objects (`z`) are explicitly out of scope for v1 (§12).

---

## 7. Drag-and-drop editing

All of these are pure functions in `core/edit`. Each takes the current text plus the compile context and returns minimal `TextChange[]` built through the `yaml` CST, so comments, key order and the existing flow/block style are preserved.

| Operation | Text effect |
|---|---|
| `move(id, at)` | Sets or updates `at:` (relative to the current parent). Pins the node. |
| `reparent(id, newParent, at)` | Updates or removes `in:` and sets the relative `at:` |
| `unpin(id)` | Removes `at:` |
| `resizeGroup(id, size)` | Sets `size:` |
| `add(resource, parent, at)` | Inserts a new entry into `resources:` with a unique generated id |
| `delete(id)` | Removes the entry and lists links/notes that would dangle, so the UI can offer to remove them too |
| `link(from, to)` | Appends `from -> to` to `links:` |
| `pinAll()` | Writes every computed `at` |

**Interaction design:**

- **During a drag**, the UI translates only that node's `<g>`, and shows a snapped ghost footprint coloured valid or invalid (overlap, out of bounds). Hovering a group highlights it as a reparent target. Nothing is written until the drop.
- **On drop**, the app calls `applyEdit` and dispatches the changes as **one CodeMirror transaction**. Undo/redo then works in both the editor and the preview with no extra machinery. The worker recompiles and the preview updates.
- **Selection sync**: clicking a node selects its YAML entry in the editor, and moving the cursor in the editor highlights the node in the preview.
- **Later in the roadmap**: a resource palette (drag a new resource in), drawing a link by dragging from a node's edge handle, and group resize handles.

Every edit op is unit-tested on fixture texts (before → after), including texts with comments, flow maps and odd indentation.

---

## 8. Icons (`packages/icons`)

### 8.1 Pack format

A pack is either:

- a **folder of SVG/PNG files**, where the id is the relative path without extension (the CLI scans it directly, and the web app accepts it as a folder upload), or
- a **`pack.json`** with `{ name, version, license, attribution, homepage, icons: { id: { file, tags?, monochrome? } } }` next to the files. This form is required for packs loaded by URL in the web app.

**Monochrome icons** (e.g. Font Awesome) are recoloured through `color` / `iconColor`. Multi-colour vendor icons are rendered as-is.

### 8.2 Sources per platform

| Platform | Sources |
|---|---|
| Web | bundled packs, packs loaded by URL, packs uploaded as zip or folder (stored in IndexedDB) |
| CLI | bundled packs, local folders, URL packs (`--icon-pack name=path`) |

### 8.3 What ships bundled — licensing

Only packs whose licence clearly allows redistribution are bundled:

- **Font Awesome Free**: icons CC BY 4.0, so attribution is required.
- **Kubernetes community icons**.
- Possibly **Simple Icons** (CC0) for brand logos. Trademarks still apply.

Every pack's licence and attribution is shown on an in-app **Credits** page. Exported SVGs can include a `<metadata>` attribution block.

**AWS, Azure and GCP architecture icons** are free to use *in diagrams*, but whether they may be *redistributed inside a tool* is unclear. Plan: provide a `isodiagram icons import <vendor> <downloaded-zip>` command that converts the user's own official download into a pack. Bundle them only after confirming each vendor's current terms (§11).

### 8.4 Picker UI

The picker lets users search across all loaded packs by id and tags, preview icons, and insert a reference or alias at the cursor. Dragging an icon onto a node sets its `icon:`.

---

## 9. Front ends

### 9.1 CLI (`isodiagram`)

```
isodiagram render arch.yaml -o arch.svg            # format from extension: .svg | .png
isodiagram render arch.yaml -o arch.png --scale 2 --theme dark
isodiagram render arch.yaml --watch
isodiagram validate arch.yaml                      # non-zero exit on errors; --format json for CI
isodiagram freeze arch.yaml                        # pin all positions (writes file)
isodiagram schema > isodiagram.schema.json         # for VS Code yaml.schemas
isodiagram icons import aws ./Asset-Package.zip -o ./icons/aws
```

PNG output goes through resvg with the bundled font. Distributed on npm (`npx @isodiagrammer/cli`). A ready-made GitHub Action is a stretch goal.

### 9.2 Web app (`packages/web`)

- Split view (resizable): CodeMirror YAML editor ↔ preview with pan/zoom (wheel, pinch, space-drag) and fit-to-content.
- The editor gets schema autocomplete, hover docs, lint ranges and code actions for common fixes (e.g. "create missing group").
- Export: SVG (the core string), and PNG (core string → `<img>` → canvas). Icons are already inlined, so there are no CORS problems.
- Open and save use the File System Access API where available, with upload/download as the fallback. Autosave goes to IndexedDB.
- **Share link**: YAML compressed (deflate + base64url) into the URL fragment, so no backend is needed. Large diagrams get a warning about URL length.
- Example gallery, built-in DSL reference, light/dark UI.
- Installable PWA that works offline.
- Platform access sits behind a `Platform` interface (files, storage, icon folders, watching), with a web implementation. This interface is the seam for a future desktop shell (§12).

---

## 10. Testing strategy

| Level | What | Tool |
|---|---|---|
| Unit | parse/source map, schema → range mapping, resolve semantics, depth sort (all rotations), A* router, snapping and collision resolution, every edit op | Vitest |
| Golden | each `examples/*.yaml` → SVG snapshot, plus diagnostics snapshot for the `examples/invalid/*` fixtures | Vitest |
| Determinism | the same fixture compiled twice, and in Node vs jsdom/browser, gives identical output | Vitest |
| Visual | PNG of the golden fixtures, compared with pixelmatch within a tolerance | Vitest + resvg |
| E2E | type → preview updates; drag → YAML changes; undo restores both; export downloads; share link round-trips | Playwright |
| CLI | render, validate exit codes, freeze rewrite | Vitest (execa) |

CI (GitHub Actions) runs lint, typecheck, unit/golden and e2e on every PR.

---

## 11. Milestones

Each milestone ends with something usable. The three riskiest pieces are spiked first.

**M0: Scaffold and spikes**
- Set up the pnpm monorepo, Biome, tsconfig, Vitest and CI.
- Spike A: a comment-preserving `at:` edit with the `yaml` CST, written as a CodeMirror transaction.
- Spike B: ELK compound layout snapped to the grid, with pinned nodes.
- Spike C: depth sort of solids across all four rotations.
- *Exit:* the spikes either confirm the approach or change this plan (record any changes here).

**M1: Static core and CLI**
- parse → schema → resolve → manual-only placement (unpinned nodes are an error for now) → scene → SVG.
- Shapes, grid, labels, straight/L-shaped links, `builtin:` and URL icons.
- CLI `render`/`validate`/`schema`.
- *Exit:* the examples render from the CLI and the golden tests pass.

**M2: Web editor**
- CodeMirror with schema autocomplete and exact diagnostics, worker pipeline, pan/zoom.
- SVG/PNG export, autosave, open/save.
- *Exit:* the old app's workflow is fully covered.

**M3: Drag-and-drop**
- move/reparent/unpin/resize, snapped ghost and validity feedback, single undo stack, selection sync.
- *Exit:* the Playwright drag/undo suite passes, and comments survive every edit op.

**M4: Auto layout and routing**
- ELK placement with pinning, A* orthogonal routing, `via`, `freeze`/"Pin all".
- *Exit:* a diagram with no `at:` at all looks good, and pinning one node doesn't disturb the others unexpectedly.

**M5: Icons**
- Pack format, bundled Font Awesome Free and Kubernetes, custom folder/URL/zip packs, picker, Credits page, `icons import`.

**M6: Polish and publish**
- Themes, example gallery, docs site (DSL reference generated from the schema), share links, PWA.
- npm publish via Changesets, landing page, Tiny Tool Town submission.

---

## 12. Out of scope for v1 (future ideas)

- **Desktop app.** The installable PWA covers "app in its own window" for v1. If a native app is wanted later, wrap `packages/web` in a shell (Tauri or Electron) and add a second `Platform` implementation for native file dialogs, watching the open file for edits made in another editor, local icon folders and `.iso.yaml` file associations. The core, CLI and web code need no changes. This is a self-contained piece a contributor could take on.

- Stacked or elevated objects (`z`) and raised links (needs a more general depth sort)
- Custom 3D shape definitions
- Real-time collaboration
- Import from Terraform state, Kubernetes manifests or CloudFormation (a strong v2 feature: generate the YAML, then auto-layout)
- Animated flows along links
- A VS Code extension with a live preview (the CLI and JSON Schema cover most of this in v1)

## 13. Open questions and risks

- **Vendor icon licensing**: confirm AWS, Azure and GCP redistribution terms before bundling, and confirm Font Awesome's attribution expectations for CC BY icons.
- **ELK and hard pins**: ELK's interactive modes treat positions as hints. The snap-and-nudge approach (§6.1) still needs to be validated in Spike B.
- **elkjs size**: about 1 MB+, so it must be lazy-loaded. If that's unacceptable, a small custom layered layout is the fallback.
- **Font consistency**: identical metrics and rendering across browsers and resvg depend on bundling and, where possible, embedding one font.
- **Naming**: check that the npm scope `@isodiagrammer` and the domain are available before publishing.
