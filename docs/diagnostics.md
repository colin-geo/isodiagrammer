# Diagnostics

Every problem the engine finds is reported as a diagnostic with a **stable code**, a severity, a message, the path into the document, and (almost always) the exact text range it refers to. The CLI prints them as `file:line:col: severity CODE: message`; `isodiagram validate --format json` gives the same data as JSON.

Codes are never renumbered or reused. Errors (`E_`) make `isodiagram validate` / `render` exit with status 1; warnings (`W_`) don't.

The engine is best-effort: wherever possible the offending part is repaired or skipped so the rest of the diagram still renders.

| Code | Severity | Meaning | What happens |
|---|---|---|---|
| `E_YAML_SYNTAX` | error | The text isn't valid YAML. | Nothing renders until it's fixed. |
| `W_YAML` | warning | YAML parser warning (e.g. an unusual tag). | Rendering continues. |
| `E_SCHEMA` | error | A value has the wrong type or isn't an allowed option. | Nothing renders until it's fixed. |
| `E_UNKNOWN_KEY` | error | A key the DSL doesn't recognise (often a typo, e.g. `colour`). | Nothing renders until it's fixed. |
| `E_DUPLICATE_ID` | error | An id is used twice: a duplicate key, or a resource reusing a group id (groups and resources share one namespace). | The duplicate resource is dropped. |
| `E_UNKNOWN_GROUP` | error | `in:` names a group that doesn't exist. | The node is placed at the top level. |
| `E_GROUP_CYCLE` | error | Groups are nested inside each other in a loop. | The loop is broken at the reported group. |
| `E_NEGATIVE_AT` | error | `at` inside a group is relative to that group, so it can't be negative. | Clamped to 0. |
| `E_GROUP_TOO_SMALL` | error | A group with a fixed `size` can't hold its contents. | Rendered anyway; contents spill out. |
| `E_FOOTPRINT_OVERLAP` | error | Two pinned siblings overlap. | Rendered anyway; draw order may look wrong. |
| `E_UNKNOWN_LINK_ENDPOINT` | error | A link's `from`/`to` isn't a group or resource id. | The link is skipped. |
| `E_DUPLICATE_LINK_ID` | error | Two links have the same id (by default `from->to`). Give one an explicit `id`. | The later link is skipped. |
| `E_UNKNOWN_ICON_ALIAS` | error | `@name` isn't defined under `icons.aliases`. | The icon is skipped. |
| `W_UNKNOWN_TYPE` | warning | `type:` is neither built in nor defined under `types`. | Drawn as a plain grey box. |
| `W_ICON_NOT_FOUND` | warning | An icon file, URL or `builtin:` name couldn't be loaded. | The icon is skipped. |
| `W_OUTSIDE_CANVAS` | warning | Reserved: something lies outside a fixed `settings.canvas`. | — |
| `W_HIDDEN_ARROW` | warning | A link's `toSide` (or `fromSide`, for a start arrow) puts an arrowhead on the back side of a solid, where the solid hides it. | The route is drawn as asked; use `left` or `right`. |
| `E_LAYOUT` | error | Automatic layout failed unexpectedly (please report it). | Unpinned nodes are packed, without overlapping, near their parent's origin. |
