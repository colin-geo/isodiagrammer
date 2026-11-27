import { history, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { describe, expect, test } from "vitest";
import { applyChanges, removeAt, setAt } from "./spike-a-yaml-edit.ts";

const DOC = `version: 1
# Top comment stays put
groups:
  public: { label: Public subnet }   # flow group
  private:
    label: Private subnet
    in: vpc

resources:
  web: { type: api, in: public }   # web tier
  db:
    type: database   # managed
    in: private
    at: [4, 1]   # pinned on purpose
  cache:
    type: cache
    tags:
      - a
      - b
  # dangling comment before queue
  queue:
    type: queue
    at:
      - 7
      - 2
  bare:
  empty: {}
`;

const edit = (fn: (t: string) => ReturnType<typeof setAt>) => applyChanges(DOC, fn(DOC));

describe("setAt", () => {
  test("updates flow seq in place, keeping the trailing comment", () => {
    const out = edit((t) => setAt(t, "db", [10, 3]));
    expect(out).toContain("    at: [10, 3]   # pinned on purpose\n");
    expect(out.replace("[10, 3]", "[4, 1]")).toBe(DOC);
  });

  test("updates block seq in place, keeping block style", () => {
    const out = edit((t) => setAt(t, "queue", [0, 9]));
    expect(out).toContain("    at:\n      - 0\n      - 9\n");
  });

  test("adds to a flow map before the closing brace", () => {
    const out = edit((t) => setAt(t, "web", [2, 5]));
    expect(out).toContain("  web: { type: api, in: public, at: [2, 5] }   # web tier\n");
  });

  test("adds to a block map after its last (nested) entry, before dangling comments", () => {
    const out = edit((t) => setAt(t, "cache", [1, 1]));
    expect(out).toContain("      - b\n    at: [1, 1]\n  # dangling comment before queue\n  queue:");
  });

  test("adds to a group block map in the groups section", () => {
    const out = edit((t) => setAt(t, "private", [0, 6]));
    expect(out).toContain("    in: vpc\n    at: [0, 6]\n\nresources:");
  });

  test("adds to an empty flow map and a bare key", () => {
    expect(edit((t) => setAt(t, "empty", [3, 3]))).toContain("  empty: { at: [3, 3] }\n");
    expect(edit((t) => setAt(t, "bare", [3, 3]))).toContain("  bare: { at: [3, 3] }\n");
  });

  test("result always re-parses to the expected data", async () => {
    const { parse } = await import("yaml");
    for (const id of ["web", "db", "cache", "queue", "private", "bare", "empty"]) {
      const data = parse(edit((t) => setAt(t, id, [8, 8])));
      const node = data.resources[id] ?? data.groups[id];
      expect(node.at, id).toEqual([8, 8]);
    }
  });

  test("unknown id throws", () => {
    expect(() => setAt(DOC, "nope", [0, 0])).toThrow(/no group or resource/);
  });
});

describe("removeAt", () => {
  test("removes a block `at:` line including its comment", () => {
    const out = edit((t) => removeAt(t, "db"));
    expect(out).toContain("    in: private\n  cache:");
    expect(out).not.toContain("pinned on purpose");
  });

  test("removes a multi-line block seq", () => {
    expect(edit((t) => removeAt(t, "queue"))).toContain("    type: queue\n  bare:");
  });

  test("setAt then removeAt round-trips flow and block maps exactly", () => {
    for (const id of ["web", "cache", "private", "empty"]) {
      const added = applyChanges(DOC, setAt(DOC, id, [1, 2]));
      expect(applyChanges(added, removeAt(added, id)).replace("{  }", "{}"), id).toBe(DOC);
    }
  });
});

describe("CodeMirror integration", () => {
  test("a drag is one transaction, and one undo restores the original text", () => {
    let state = EditorState.create({ doc: DOC, extensions: [history()] });
    const changes = setAt(state.doc.toString(), "queue", [5, 5]); // two changes (x and y)
    state = state.update({ changes, userEvent: "move.drag" }).state;
    expect(state.doc.toString()).toContain("      - 5\n      - 5\n");

    let undone = state;
    undo({ state, dispatch: (tr) => (undone = tr.state) });
    expect(undone.doc.toString()).toBe(DOC);
  });
});
