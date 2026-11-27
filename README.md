# Isometric Diagrammer

Client-only **Vite + Vue + TypeScript** app that turns a YAML DSL into Cloudcraft-like **isometric infrastructure diagrams** on a graph-paper grid. Includes a split editor/preview, zoom+pan, and export to **SVG** / **PNG**.

## Commands

```bash
npm install
npm run dev
npm run lint
npm run test:run
npm run build
```

## DSL highlights

### Canvas sizing (grid area)

By default, the SVG viewBox fits the rendered content. To force a specific canvas size (useful for exports / leaving extra space), set:

```yaml
settings:
  canvas:
    at: [-2, -2]
    size: [18, 14]
    padding: 2
```

### Shared icon definitions (define once, reuse)

```yaml
version: 1

iconDefs:
  cloudMark:
    builtin: cloud
    size: 0.7
    opacity: 0.9
  dbMark:
    url: "/icons/db.svg"
    size: 0.6

resources:
  web:
    type: server
    in: vpc
    at: [1, 1]
    icon:
      ref: cloudMark
      faces: [top, front]
  db:
    type: database
    in: vpc
    at: [8, 3]
    icon: "@dbMark"   # shorthand for { ref: dbMark }
```

Notes:
- Icon sources: `builtin:` (placeholder glyphs) or `url:` (SVG/PNG/data URI)
- `faces:` can be `top|front|side|left|right|all` (or a list)
- For PNG export, prefer same-origin URLs or data URIs to avoid canvas/CORS issues
