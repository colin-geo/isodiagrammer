# Isometric Diagrammer

Turn a YAML description of your infrastructure into a Cloudcraft-style **isometric diagram**, with automatic layout, fine-tuning with `at:` coordinates, and SVG/PNG export. A CLI for docs and CI pipelines is available now; the web editor with drag-and-drop arrives next.

> **Status:** early development: milestones M0–M1 done. See [PLAN.md](PLAN.md) for the design and roadmap.

```yaml
version: 1
title: Checkout platform

groups:
  vpc:     { label: VPC, style: zone }
  public:  { in: vpc, label: Public subnet }
  private: { in: vpc, label: Private subnet }

resources:
  users: { type: user, label: Customers }
  lb:    { type: loadbalancer, in: public }
  web:   { type: server, in: public }
  db:    { type: database, in: private, at: [4, 2] }   # pinned; the rest is auto-laid-out

links:
  - users -> lb
  - lb -> web
  - { from: web, to: db, label: SQL, style: dashed }
```

More in [`examples/`](examples/).

## CLI

```bash
isodiagram render arch.yaml -o arch.svg
isodiagram render arch.yaml -o arch.png --scale 2 --theme dark
isodiagram render arch.yaml -o arch.svg --watch
isodiagram validate arch.yaml                # exit 1 on errors; --format json for CI
isodiagram schema > isodiagram.schema.json   # editor autocomplete
```

Until the package is published, run it from a checkout with `node packages/cli/src/main.ts …` (Node ≥ 23.6 runs the TypeScript directly).

**Editor autocomplete:** with the VS Code YAML extension, add to `settings.json`:

```json
"yaml.schemas": { "./isodiagram.schema.json": "*.iso.yaml" }
```

Problems are reported with stable codes. See [docs/diagnostics.md](docs/diagnostics.md).

## Development

Requires Node ≥ 23.6 and [pnpm](https://pnpm.io) (`npm i -g pnpm`).

```bash
pnpm install
pnpm test        # watch mode
pnpm test:run    # single run (CI); add -u to accept intentional golden changes
pnpm lint        # Biome lint + format check
pnpm format      # apply Biome fixes
pnpm typecheck
```

| Path | What |
|---|---|
| `packages/core` | Framework-free engine: parse → resolve → layout → scene → SVG, plus YAML edit operations |
| `packages/core/src/__golden__` | Committed SVG/diagnostic snapshots of every example: review changes in diffs |
| `packages/cli` | The `isodiagram` command |
| `examples/` | Example diagrams (also the golden-test fixtures) |

## License

MIT
