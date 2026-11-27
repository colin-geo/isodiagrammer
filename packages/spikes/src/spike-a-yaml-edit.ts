/**
 * Spike A — comment-preserving YAML edits as minimal text changes (PLAN.md §7).
 *
 * Instead of re-serialising the whole document (which loses formatting), we use the
 * source ranges the `yaml` parser records on every node and emit the smallest
 * possible `{from, to, insert}` changes. These map 1:1 onto CodeMirror transactions,
 * which gives the app a single undo stack for editor + preview.
 */
import {
  isMap,
  isScalar,
  isSeq,
  type Node,
  type Pair,
  parseDocument,
  type Range,
  type YAMLMap,
} from "yaml";

export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

export type Vec2 = readonly [number, number];

const SECTIONS = ["resources", "groups"] as const;

function rangeOf(node: Node): Range {
  if (!node.range) throw new Error("node has no source range");
  return node.range;
}

function findEntry(text: string, id: string): Pair<Node, Node | null> {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) throw new Error(`YAML has errors: ${doc.errors[0]?.message}`);
  for (const section of SECTIONS) {
    const map = doc.get(section, true);
    if (!isMap(map)) continue;
    for (const pair of map.items) {
      if (isScalar(pair.key) && pair.key.value === id) return pair as Pair<Node, Node | null>;
    }
  }
  throw new Error(`no group or resource with id "${id}"`);
}

function findKey(map: YAMLMap, key: string): Pair<Node, Node | null> | undefined {
  return map.items.find((p) => isScalar(p.key) && p.key.value === key) as
    | Pair<Node, Node | null>
    | undefined;
}

function lineStart(text: string, pos: number): number {
  return text.lastIndexOf("\n", pos - 1) + 1;
}

/** Position just after the newline that ends the line containing `pos` (or EOF). */
function nextLineStart(text: string, pos: number): number {
  const nl = text.indexOf("\n", pos);
  return nl === -1 ? text.length : nl + 1;
}

const fmtVec = ([x, y]: Vec2) => `[${x}, ${y}]`;

/** Set (or add) `at:` on a group/resource. Preserves comments, key order and style. */
export function setAt(text: string, id: string, at: Vec2): TextChange[] {
  const entry = findEntry(text, id);
  const value = entry.value;

  // `web:` with no value, or `web: ~`
  if (value === null || (isScalar(value) && value.value === null)) {
    const colon = text.indexOf(":", rangeOf(entry.key)[1]);
    const to = value ? Math.max(colon + 1, rangeOf(value)[1]) : colon + 1;
    return [{ from: colon + 1, to, insert: ` { at: ${fmtVec(at)} }` }];
  }
  if (!isMap(value)) throw new Error(`"${id}" is not a mapping`);

  const existing = findKey(value, "at");
  if (existing?.value) {
    const v = existing.value;
    // Edit the two numbers in place: keeps flow `[4, 1]` *and* block `- 4\n- 1` styles.
    if (isSeq(v) && v.items.length === 2 && v.items.every((i) => isScalar(i))) {
      return v.items.map((item, i) => {
        const [from, to] = rangeOf(item as Node);
        return { from, to, insert: String(at[i]) };
      });
    }
    const [from, to] = rangeOf(v);
    return [{ from, to, insert: fmtVec(at) }];
  }

  const [mapStart, mapValueEnd] = rangeOf(value);
  if (value.flow) {
    const last = value.items.at(-1);
    if (!last) {
      // `{}` → `{ at: [x, y] }`
      return [{ from: mapStart + 1, to: mapValueEnd - 1, insert: ` at: ${fmtVec(at)} ` }];
    }
    const lastEnd = last.value ? rangeOf(last.value as Node)[1] : rangeOf(last.key as Node)[1];
    return [{ from: lastEnd, to: lastEnd, insert: `, at: ${fmtVec(at)}` }];
  }

  // Block map: new line after the map's last entry, at the indentation of its first key.
  const firstKey = value.items[0]?.key as Node;
  const indent = " ".repeat(rangeOf(firstKey)[0] - lineStart(text, rangeOf(firstKey)[0]));
  const line = `${indent}at: ${fmtVec(at)}`;
  const insertAt = mapValueEnd;
  if (text[insertAt - 1] === "\n") return [{ from: insertAt, to: insertAt, insert: `${line}\n` }];
  return [{ from: insertAt, to: insertAt, insert: `\n${line}` }];
}

/** Remove `at:` (unpin). No-op if absent. */
export function removeAt(text: string, id: string): TextChange[] {
  const entry = findEntry(text, id);
  const value = entry.value;
  if (!isMap(value)) return [];
  const idx = value.items.findIndex((p) => isScalar(p.key) && p.key.value === "at");
  if (idx === -1) return [];
  const pair = value.items[idx] as Pair<Node, Node | null>;
  const keyStart = rangeOf(pair.key)[0];
  const valEnd = pair.value ? rangeOf(pair.value)[1] : rangeOf(pair.key)[1];

  if (value.flow) {
    const prev = value.items[idx - 1] as Pair<Node, Node | null> | undefined;
    if (prev) {
      const prevEnd = prev.value ? rangeOf(prev.value)[1] : rangeOf(prev.key)[1];
      return [{ from: prevEnd, to: valEnd, insert: "" }];
    }
    const next = value.items[idx + 1] as Pair<Node, Node | null> | undefined;
    return [{ from: keyStart, to: next ? rangeOf(next.key)[0] : valEnd, insert: "" }];
  }

  // Block: delete whole line(s) including any trailing comment on the `at:` line.
  const nodeEnd = pair.value ? rangeOf(pair.value)[2] : valEnd;
  // Block collections' ranges already end at the start of the following line.
  const lineEnd = text[valEnd - 1] === "\n" ? valEnd : nextLineStart(text, valEnd);
  const end = Math.max(nodeEnd, lineEnd);
  return [{ from: lineStart(text, keyStart), to: end, insert: "" }];
}

/** Apply changes (non-overlapping, any order) to a string — used by tests and the CLI. */
export function applyChanges(text: string, changes: readonly TextChange[]): string {
  return [...changes]
    .sort((a, b) => b.from - a.from)
    .reduce((t, c) => t.slice(0, c.from) + c.insert + t.slice(c.to), text);
}
