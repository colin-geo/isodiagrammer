# Isometric Diagrammer

Turn a YAML description of your infrastructure into a Cloudcraft-style **isometric diagram**, with automatic layout, drag-and-drop fine-tuning that writes back to your YAML, and SVG/PNG export. Comes as a web app and a CLI.

> **Status:** early development (milestone M0 done). See [PLAN.md](PLAN.md) for the design and roadmap.

## Development

Requires Node ≥ 22 and [pnpm](https://pnpm.io) (`npm i -g pnpm`).

```bash
pnpm install
pnpm test        # watch mode
pnpm test:run    # single run (CI)
pnpm lint        # Biome lint + format check
pnpm format      # apply Biome fixes
pnpm typecheck
```

## Repository layout

| Path | What |
|---|---|
| `packages/core` | Framework-free engine: parse → resolve → layout → scene → SVG |
| `packages/spikes` | M0 throwaway spikes (YAML edits, ELK layout, depth sort) |

## License

MIT
