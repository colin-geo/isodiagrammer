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

1. **The YAML text is the single source of truth.** The preview never holds state the text doesn't. Drags, palette drops and context-menu actions all produce _text edits_. One consequence: the editor's undo history is the app's only undo stack.
2. **The engine is a pure TypeScript library with no DOM.** Any input that comes from the platform (icons, fonts, files) is injected through an interface.
3. **Rendering doesn't depend on the preview.** The core produces a complete, self-contained SVG string, and export reuses that exact output. Nothing is scraped from the live DOM.
4. **Results are deterministic.** The same input gives byte-identical SVG in the browser and in Node. That's what makes golden tests and CI rendering trustworthy.
5. **One definition of the schema.** The Zod schema generates the JSON Schema, which drives editor autocomplete, hover docs and the VS Code YAML extension.

---

## 2. Technology decisions

### 2.1 Stack

| Area         | Choice                                                                                           | Why                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo     | **pnpm workspaces**                                                                              | Fast, strict dependency isolation, good workspace protocol                                                                                |
| Language     | TypeScript, `strict: true` everywhere                                                            |                                                                                                                                           |
| Lint/format  | **Biome**                                                                                        | One fast tool instead of ESLint + Prettier                                                                                                |
| Tests        | **Vitest** (unit/golden), **Playwright** (e2e, visual)                                           |                                                                                                                                           |
| Validation   | **Zod 4** (+ `z.toJSONSchema`)                                                                   |                                                                                                                                           |
| YAML         | **`yaml`** (eemeli)                                                                              | CST, source ranges, comment-preserving edits                                                                                              |
| Layout       | **`elkjs`** (lazy-loaded, run in a Web Worker)                                                   | Compound (nested) graphs, layered layout                                                                                                  |
| Editor       | **CodeMirror 6** + `codemirror-json-schema` (YAML mode)                                          | Schema autocomplete, hover, lint                                                                                                          |
| UI framework | **Svelte 5**                                                                                     | The UI is thin (the core renders the SVG). Svelte gives small bundles and simple reactivity. Easy to swap because it touches very little. |
| PNG (Node)   | **`@resvg/resvg-js`**                                                                            | Fast and deterministic, no headless browser                                                                                               |
| Release      | **Changesets** (npm packages), static hosting for the web app (Cloudflare Pages or GitHub Pages) |                                                                                                                                           |

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
  view: { rotation: 0 } # 0 | 90 | 180 | 270, rotates the whole scene
  grid: { style: technical } # none | simple | technical
  layout: { direction: east, spacing: 2, groupPadding: 1 }
  canvas: { padding: 2 } # or { at: [x, y], size: [w, h] } to force bounds
  theme: light # light | dark | <custom theme name>

icons:
  packs:
    fa: builtin:fontawesome-free
    k8s: builtin:kubernetes
    acme: ./icons/acme # folder, or URL to a pack.json
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
  cloud: { label: AWS eu-west-1, style: region }
  vpc: { in: cloud, label: VPC }
  public: { in: vpc, label: Public subnet }
  private: { in: vpc, label: Private subnet, at: [0, 6] } # pinned inside vpc

resources:
  lb: { type: loadbalancer, in: public }
  web: { type: api, in: public }
  db: { type: database, in: private, at: [4, 1], icon: "@db" }
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
  - String shorthand: `a -> b`, `a <-> b`, `a -- b` (no arrow). Object form: `{ from, to, label, style, arrow, route, via, fromSide, toSide, color, id }`.
  - Default link id is `from->to`. If the same pair is linked twice, each link needs an explicit `id`.
  - `route: orthogonal | straight` (default orthogonal). `via:` gives absolute grid cells the route passes through, in order.
  - `fromSide` / `toSide`: `left | right | back-left | back-right`, named as they look on screen (view-relative, like icon faces). `left`/`right` are the visible front sides.
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
- `elkjs` is loaded lazily, only when some node is actually unpinned. **Gotcha (found in M2):** loaded inside a Web Worker, `elk.bundled.js` replaces `self.onmessage` with its own dispatcher. Any worker that runs the engine must listen with `addEventListener` and ignore foreign messages (see `compile.worker.ts`).
- ELK's hierarchical mode dominates layout time (M0: ~50 ms at 20 resources, ~300 ms at 100, ~3 s at 300). Above a threshold (start at ~120 resources, tune later) the engine switches to `SEPARATE_CHILDREN`, which took ~110 ms at 300 resources but ignores cross-group edges when placing nodes. The UI should show an indicator while a layout is running.

---

## 6. Layout, routing and draw order

### 6.1 Placement

Layout runs in **ground-plane grid space** (2D, integer cells). Projection to isometric happens afterwards.

1. Build a compound graph: groups are compound nodes, resources are leaves, and links are edges (between leaves, crossing group borders where needed).
2. Run ELK `layered` with `hierarchyHandling: INCLUDE_CHILDREN` (or `SEPARATE_CHILDREN` for large diagrams, §5.3), using the `settings.layout` direction and spacing, plus `considerModelOrder: NODES_AND_EDGES` so document order breaks ties. Groups with no internal edges use `rectpacking` instead. Pinned nodes are still passed to ELK so their edges shape the layout, but ELK's position for them is discarded.
3. **Pinned nodes are hard constraints.**
   - Within each parent, pinned children are placed first and become obstacles.
   - Unpinned children take ELK's relative arrangement, which is then **snapped to integer cells** and nudged to the nearest free cell. A deterministic spiral search, in document order, resolves any collisions.
4. Group sizes are computed bottom-up from children plus padding, unless `size` is given.
5. **Determinism:** inputs are always fed to ELK in document order, and golden tests assert that identical input gives identical output.

**Stability caveat:** adding a node can reshuffle unpinned siblings. Two mitigations: dragging a node pins it (§7), and a **"Pin all"** command (CLI: `isodiagram freeze`) writes every computed `at` into the YAML.

### 6.2 Link routing

- Routing runs in the **view frame** (after rotation), because which faces are visible depends on the view. Arrowheads into a solid must land on a visible (front) edge. M1's simple router guarantees this by wrapping round the side of the target, and the A* router must keep the guarantee (it's a property test in `route.test.ts`).
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

| Operation                     | Text effect                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------- |
| `move(id, at)`                | Sets or updates `at:` (relative to the current parent). Pins the node.                            |
| `reparent(id, newParent, at)` | Updates or removes `in:` and sets the relative `at:`                                              |
| `unpin(id)`                   | Removes `at:`                                                                                     |
| `resizeGroup(id, size)`       | Sets `size:`                                                                                      |
| `add(resource, parent, at)`   | Inserts a new entry into `resources:` with a unique generated id                                  |
| `delete(id)`                  | Removes the entry and lists links/notes that would dangle, so the UI can offer to remove them too |
| `link(from, to)`              | Appends `from -> to` to `links:`                                                                  |
| `pinAll()`                    | Writes every computed `at`                                                                        |

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

| Platform | Sources                                                                                   |
| -------- | ----------------------------------------------------------------------------------------- |
| Web      | bundled packs, packs loaded by URL, packs uploaded as zip or folder (stored in IndexedDB) |
| CLI      | bundled packs, local folders, URL packs (`--icon-pack name=path`)                         |

### 8.3 What ships bundled — licensing

Only packs whose licence clearly allows redistribution are bundled:

- **Font Awesome Free**: icons CC BY 4.0, so attribution is required.
- **Kubernetes community icons**.
- Possibly **Simple Icons** (CC0) for brand logos. Trademarks still apply.

Every pack's licence and attribution is shown on an in-app **Credits** page. Exported SVGs can include a `<metadata>` attribution block.

**AWS, Azure and GCP architecture icons** are free to use _in diagrams_, but whether they may be _redistributed inside a tool_ is unclear. Plan: provide a `isodiagram icons import <vendor> <downloaded-zip>` command that converts the user's own official download into a pack. Bundle them only after confirming each vendor's current terms (§11).

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
isodiagram freeze arch.yaml                        # pin all positions (rewrites the file; --stdout prints instead)
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

| Level       | What                                                                                                                                                 | Tool           |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Unit        | parse/source map, schema → range mapping, resolve semantics, depth sort (all rotations), A* router, snapping and collision resolution, every edit op | Vitest         |
| Golden      | each `examples/*.yaml` → SVG snapshot, plus diagnostics snapshot for the `examples/invalid/*` fixtures                                               | Vitest         |
| Determinism | the same fixture compiled twice, and in Node vs jsdom/browser, gives identical output                                                                | Vitest         |
| Visual      | PNG of the golden fixtures, compared with pixelmatch within a tolerance                                                                              | Vitest + resvg |
| E2E         | type → preview updates; drag → YAML changes; undo restores both; export downloads; share link round-trips                                            | Playwright     |
| CLI         | render, validate exit codes, freeze rewrite                                                                                                          | Vitest (execa) |

CI (GitHub Actions) runs lint, typecheck, unit/golden and e2e on every PR.

---

## 11. Milestones

Each milestone ends with something usable. The three riskiest pieces are spiked first.

**M0: Scaffold and spikes** ✅ done, findings in §14

- Set up the pnpm monorepo, Biome, tsconfig, Vitest and CI.
- Spike A: a comment-preserving `at:` edit with the `yaml` CST, written as a CodeMirror transaction.
- Spike B: ELK compound layout snapped to the grid, with pinned nodes.
- Spike C: depth sort of solids across all four rotations.
- _Exit:_ the spikes either confirm the approach or change this plan (record any changes here).

**M1: Static core and CLI** ✅ done, notes in §15

- parse → schema → resolve → placement → scene → SVG.
- Shapes, grid, labels, straight/L-shaped links, `builtin:` and URL icons.
- CLI `render`/`validate`/`schema`.
- _Exit:_ the examples render from the CLI and the golden tests pass.
- _Changed from the original plan:_ ELK placement (from Spike B) was promoted in M1 instead of rejecting unpinned nodes until M4, because it was already working and tested.

**M2: Web editor** ✅ done, notes in §16

- CodeMirror with schema autocomplete and exact diagnostics, worker pipeline, pan/zoom.
- SVG/PNG export, autosave, open/save.
- _Exit:_ the old app's workflow is fully covered.

**M3: Drag-and-drop** ✅ done, notes in §17

- move/reparent/unpin/resize, snapped ghost and validity feedback, single undo stack, selection sync.
- _Exit:_ the Playwright drag/undo suite passes, and comments survive every edit op.

**M4: Auto layout and routing** ✅ done, notes in §18

- ELK placement exists since M1. M4 work: quality with pinned nodes, `settings.layout.direction`, `freeze`/"Pin all".
- A* orthogonal routing with obstacle avoidance and link separation (M1's wrap-around routes can run long and overlap each other), `via`, `fromSide`/`toSide`.
- Label collision avoidance (link labels currently sit at the path midpoint, even when that's under a box).
- _Exit:_ a diagram with no `at:` at all looks good, and pinning one node doesn't disturb the others unexpectedly.

**M5: Icons**

- Pack format, bundled Font Awesome Free and Kubernetes, custom folder/URL/zip packs, picker, Credits page, `icons import`.

**M6: Polish and publish**

- Notes overlay (`notes:` in §4.1), which wasn't scheduled in any earlier milestone.
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
- **Layout quality with pins** (revisited in M4, §18): pinning deliberately never moves unpinned siblings, so a node dragged far away leaves its neighbours where they were. That's the predictable choice; seeding ELK with pinned positions (interactive strategies) is still an option if real diagrams show neighbours looking unrelated to a pinned node.
- **elkjs licence**: EPL-2.0 (or GPL-3.0). Fine as an unmodified dependency of an MIT project. Keep it unmodified and list it in the Credits page and third-party notices.
- **elkjs size**: about 1 MB+, so it must be lazy-loaded. If that's unacceptable, a small custom layered layout is the fallback.
- **Font consistency** (raised in priority after M1: resvg fell back to a monospace system font when Inter wasn't installed, so PNGs from the CLI look different from the browser): identical metrics and rendering across browsers and resvg depend on bundling and, where possible, embedding one font.
- **Naming**: check that the npm scope `@isodiagrammer` and the domain are available before publishing.

---

## 14. M0 spike findings (2026-11-27)

The spike code was promoted into `packages/core` in M1 and the `packages/spikes` package removed; see git history for the originals. All three spikes confirmed the approach.

### Spike A: comment-preserving YAML edits ✅

- `yaml` gives every node a `range` of `[start, valueEnd, nodeEnd]`. Editing only the bytes that change preserves comments, key order and flow/block style.
- `setAt` / `removeAt` cover flow maps, block maps, nested block values, `{}` and bare `key:` entries, existing `at` in flow (`[4, 1]`) or block (`- 4` / `- 1`) style, trailing comments, and dangling comments.
- Things to watch:
  - Block collections' ranges end at the start of the *next* line, while scalars and flow collections end before their trailing comment.
  - New keys in a block map are inserted at the map's `valueEnd`, which lands correctly before dangling comments.
- The changes are a CodeMirror `ChangeSpec` as-is. A two-change edit applied as one transaction is undone by a single `undo`, which confirms the single-undo-stack design.

### Spike B: ELK compound layout on the grid ✅ (with a performance caveat)

- `layered` + `INCLUDE_CHILDREN` handles nested groups and edges that cross group borders. ELK coordinates divided by a cell unit and rounded give a clean grid placement.
- Bottom-up resolution (pinned children first, then unpinned children by spiral search, then auto-size the group) satisfied every invariant in a 40-round fuzz test:
  - no sibling overlaps
  - pins honoured exactly
  - children inside group bounds and padding
  - deterministic output
- Pinning a whole group leaves its children's relative positions unchanged, which confirms the relative-`at` design.
- Performance: see §5.3. All the time is in ELK, not in snapping or nudging.
- Visual quality is acceptable for a first pass. A default `groupPadding` of 1 looks cramped with nested groups and labels, so try 2 in M1.

### Spike C: draw order ✅

- The "A is behind B if `A.maxX ≤ B.minX` or `A.maxY ≤ B.minY`" rule, applied to pairs that overlap on screen and topologically sorted, matched a ray-cast ground truth at more than 10,000 random screen points per view rotation (60 random scenes × 4 rotations).
- A naive centre-depth sort fails the same test, which confirms the test can catch real draw-order bugs.
- View rotation is a footprint transform applied before sorting and projecting.

### Tooling notes

- TypeScript 7 (native `tsc`), Vitest 5 and Biome 2.6 work together without workarounds.
- Node ≥ 25 no longer ships corepack. Install pnpm with `npm i -g pnpm` (or use `npx pnpm@10`).
- Biome's `migrate` turned `recommended: true` into `preset: "none"`, which silently disabled linting. It's corrected to `preset: "recommended"`.

---

## 15. M1 notes (2026-11-27)

**Implemented DSL subset.** Everything in §4 except:
- `icons.packs` (M5)
- `notes` (M6)
- `settings.layout.direction` (M4)
- link `via`, `fromSide` and `toSide` (M4)

The schema rejects these as unknown keys rather than silently ignoring them.

**Defaults chosen from looking at real renders:**
- `groupPadding` 2 (1 was cramped, as Spike B suggested)
- `spacing` 3 (2 left no room for links between siblings)

**Group labels go on the front-left edge.** On the back edge, tall resources inside the group hid them.

**Text metrics are still an approximation** (a character-width estimate), so label bounds are deterministic but not exact. The bundled-font metrics table from §5.2 is still needed and is now the main font-consistency task (§13).

**Icons from files and URLs are embedded as `<image>` data URIs**, so they can't be recoloured. Parsing SVG icons into recolourable `<symbol>`s is part of M5. `builtin:` glyphs are real symbols and recolour fine, including in resvg.

**The Node rule is enforced by lint.** Biome's `noNodejsModules` rule applies to `packages/core/src` (excluding tests), so the engine stays browser-safe.

**Node ≥ 23.6 is required** for development, because the CLI runs its TypeScript source directly through Node's type stripping. Publishing (M6) needs a build step, since Node won't strip types inside `node_modules`.

**Test coverage:** 68 tests, including:
- golden SVGs for every example and golden diagnostics for every invalid example
- placement invariants fuzz-tested across random group trees and pins
- draw order checked against a ray-cast ground truth
- the visible-arrowhead routing property, mutation-checked
- CLI tests run as real subprocesses

---

## 16. M2 notes (2026-11-27)

**What shipped.** `packages/web` (Svelte 5 + Vite 8):
- **Editor:** CodeMirror with autocomplete and hover docs driven by the schema (`codemirror-json-schema`), and diagnostics from the engine shown inline and in a clickable problems list.
- **Rendering:** the whole pipeline runs in a Web Worker, debounced, with stale results dropped.
- **Preview:** pan/zoom with fit-to-view and keyboard support. When the current text can't be parsed, the last valid render stays visible.
- **Files and export:** SVG/PNG export, open/save through the File System Access API (with a download fallback), autosave, an examples menu, a resizable split, and a quick-reference panel generated from the engine's catalogue.

**Changes from the plan:**
- Autosave uses `localStorage`, not IndexedDB. Documents are small text, so it's enough. IndexedDB arrives with uploaded icon packs (M5), and autosave can move then.
- Draft-07 JSON Schema (not 2020-12) is the single output format. It's what `codemirror-json-schema` and the VS Code YAML extension handle best.
- `type:` accepts a built-in name or any string, so autocomplete can suggest built-in type names. A test keeps that list in sync with the catalogue.

**Decisions:**
- Preview input follows canvas-tool convention: drag or wheel pans; Ctrl/⌘ + wheel or pinch zooms. M3 will claim left-drag *on a node* for moving it, and dragging the background will keep panning.
- The preview shows the diagram's own theme (`settings.theme`), not the UI's, so what you see is what you export. A dark UI showing a light diagram is intended.
- Editor ligatures are off, so `->` reads as the two characters you type.

**Tooling:**
- `svelte-check` needs TypeScript ≤ 6, so the web package pins TypeScript 6 locally. Everything else uses TypeScript 7.
- Biome lints `.svelte` script blocks without seeing the template, so it reports template-only uses as unused. Its auto-fix would *delete* those imports, so `noUnusedImports` and `noUnusedVariables` are off for `*.svelte` (`svelte-check` covers them).
- E2E tests: 11 Playwright tests against the production build, with a CI job. Locally, `CHROMIUM_PATH=/usr/bin/chromium pnpm e2e` uses the system browser.

**To revisit:**
- The main bundle is about 345 KB gzipped (zod, yaml, CodeMirror and the schema plugin's markdown renderer). ELK (about 1.4 MB) is already split out and only loads in the worker. Options for M6: precompute the JSON Schema at build time so the main thread doesn't need zod, and lazy-load the hover renderer.
- PNG export uses the browser's fonts, so it can differ from the CLI's resvg output. That's the font-consistency risk again (§13).

---

## 17. M3 notes (2026-11-27)

**What shipped:**
- **Drag:** a ghost footprint that snaps to cells and turns green or red, a badge saying what will happen ("Move into …" or "Can't drop here: …"), and the target group highlighted while dragging.
- **Moving between groups:** dropping a node changes its group (moving it into a group, or out to the top level). <kbd>Alt</kbd> while dragging keeps the current group.
- **Selection:** synced both ways. Clicking selects the node's key in the editor; moving the cursor in the editor highlights the node.
- **Other edits:** Unpin, arrow-key nudging (a keyboard alternative to dragging), and a resize handle for groups.
- **Undo:** <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> work from the preview through the editor's history. Every preview edit is a single text change, kept as its own undo step.

**Core API:** `setKey`/`removeKey` (generalised from Spike A); `applyEdit(text, op)` with `move` (optionally changing the parent), `unpin` and `resize`, each returning one minimal change; `layoutInfo()`, the serialisable placement summary with source ranges; and `screenToWorld`, `worldToScreen`, `worldVecToScreen` and `footprintPolygon`.

**Decisions:**
- **Only pinned siblings block a drop.** Auto-placed siblings are re-laid-out around the newly pinned node, which is what pinning is for.
- **Groups drag by their label, or anywhere once selected.** Otherwise a large region group would cover the canvas and dragging could never pan.
- **Drop target** is the innermost group containing the dragged node's centre. A group can never be dropped into itself or its descendants.
- **Resizing** pulls the group's far world corner (x+w, y+d), so `at` never has to change, whichever way the view is rotated.
- **Arrow keys** move in the view frame (→ is +x towards the lower right, ↓ is +y towards the lower left), converted back to world coordinates.

**Bugs found by the browser tests:**
- The drag origin was taken when the pointer crossed the 4 px threshold, which lost the first part of every drag. It's now taken at `pointerdown`.
- Fast consecutive nudges or drags read the layout before the previous edit had re-rendered. Edits are now also applied optimistically to the in-memory layout (`applyOpToLayout`), and the next render replaces it.

**Still open:**
- **Moved to M4:** `pinAll`/freeze (done, §18).
- **Moved to M6 (polish):** a resource palette (drag in new resources), drawing links by dragging between nodes, and delete with a dangling-reference check. None is needed for the core "fine-tune the auto-layout" workflow.
- **Links during a drag:** they don't follow the node (they re-route on drop), and the dragged node isn't re-sorted for depth mid-drag. Both are cosmetic.

**Test counts:** 119 unit tests and 19 Playwright tests. The drag suite covers move, moving between groups, an invalid drop, Alt-drag, selection both ways, nudge, unpin, resize, panning, undo/redo, and comment preservation.

---

## 18. M4 notes (2026-11-27)

**Routing (`layout/route.ts`):** A* over (cell, direction) states in the view frame. Lanes run through cell centres, so a route is always half a cell clear of a footprint and adjacent lanes are a full cell apart.
- **Obstacles:** solid footprints. Groups and planes are not obstacles.
- **Costs** (all in `COST`):
  - 1 per cell
  - +2 per bend
  - +2 per cell of floor hidden behind a solid. The test is exact: a floor point is hidden if the line of sight `(x+t, y+t, t)` enters a box.
  - +3 per cell under a group label
  - +3 per cell already used by a link running the same way, +1 where one crosses. Earlier links (document order) get first pick, and later ones spread into neighbouring lanes.
  - Ports cost +0.5 per cell away from the middle of their side, +2 for leaving a solid from a back side, and +3 for reusing another link's port, so links fan out across a side.
- **Visible arrowheads:** an arrowhead into a solid may only use its front ports (`right` = x1, `left` = y1). A start arrow obeys the same rule at the source.
  - Turning on the very last half-cell into a port costs 3. Routes therefore usually approach an arrowhead head-on, but an L into a corner is still allowed when the alternative is a long hook.
- **`via`** is routed leg by leg, carrying the travel direction across each waypoint. A waypoint inside a solid is allowed for that link.
- **`fromSide`/`toSide`** restrict the ports. An arrowhead on a back side of a solid gives `W_HIDDEN_ARROW`.
- **Fallback:** if A* finds no way (e.g. a node walled in), the M1 I/L router is used. It always succeeds.
- **Property tests:** random layouts at every rotation check that segments are axis-aligned, that no route passes through any solid, and that the arrowhead lands on a visible front edge.

**Placement:**
- **`settings.layout.direction`** (`right | down | left | up`) maps directly to ELK's direction. `right` is +x, which is towards the lower right at rotation 0.
- **Compaction:** ELK's layered layout of compound graphs leaves big gaps. Its classic failure is arranging groups diagonally, which left the checkout example's VPC mostly empty. A scanline compaction pass now runs per parent, first along the flow axis and then across it. It keeps ELK's order and `spacing`, moves each node as close to the origin as possible, and never produces overlaps.
  - It runs on every child's ELK slot, including pinned ones. So **pinning or dragging a node never moves its unpinned siblings**, and a test checks this. This is the exit criterion's "doesn't disturb the others unexpectedly".
- Tried and dropped: ELK's `NETWORK_SIMPLEX` node placement made almost no visible difference.

**Labels (`scene/labels.ts`):**
- **Link labels** try the path midpoint first (the M1 behaviour). Next they try the middle, then the quarter points, of each segment, longest first.
  - The first spot clear of solid silhouettes, group labels and other labels wins. Collisions are tested with the separating-axis theorem against each solid's screen hexagon.
- **Group label cells** are shared with the router, so links stay off group labels where they can.

**Freeze:**
- `pinAllOp(layout)` produces a `pinAll` edit op, which applies as one minimal change.
- The web app has a **Pin all** toolbar button (one undo step). It's enabled only when the layout matches the text and there are no errors.
- `isodiagram freeze <file> [--stdout]` rewrites the file in place, and refuses to if the document has errors.
- A test freezes the examples and checks that the SVG is byte-identical and the comments survive.

**Still open:**
- Resource labels (below each solid) don't avoid other solids yet. In the showcase, `ctr`'s label touches `api`.
- Equal-cost routes sometimes take the outside of a cluster rather than the middle. They are the same length, but in isometric they read as a detour.
- `straight` routes ignore obstacles, by design.
- Long layered diagrams come out as a long diagonal strip in isometric. `direction: down` or pins are the workaround, and a wrapping or "grid" layout mode is a possible future option.

**Test counts:** 140 unit tests and 20 Playwright tests. New example: `examples/routing.yaml` (`direction: down`, `via`, `fromSide`/`toSide`).
