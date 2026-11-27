<script lang="ts">
/**
 * CodeMirror 6 YAML editor with schema-driven autocomplete and hover docs. Diagnostics
 * come from the engine (not a separate schema linter) so the editor and CLI always agree.
 */
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { yaml, yamlLanguage } from "@codemirror/lang-yaml";
import {
  bracketMatching,
  foldGutter,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { type Diagnostic as CmDiagnostic, lintGutter, setDiagnostics } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  hoverTooltip,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { type Diagnostic, dslJsonSchema } from "@isodiagrammer/core";
import { tags as t } from "@lezer/highlight";
import { stateExtensions } from "codemirror-json-schema";
import { yamlCompletion, yamlSchemaHover } from "codemirror-json-schema/yaml";
import { onDestroy, onMount } from "svelte";

interface Props {
  initial: string;
  onchange: (text: string) => void;
}
const { initial, onchange }: Props = $props();

let host: HTMLDivElement;
let view: EditorView | undefined;

const schema = dslJsonSchema() as Parameters<typeof stateExtensions>[0];

const highlight = HighlightStyle.define([
  { tag: t.propertyName, color: "var(--syn-key)" },
  { tag: [t.string, t.special(t.string)], color: "var(--syn-string)" },
  { tag: [t.number, t.bool, t.null], color: "var(--syn-number)" },
  { tag: t.comment, color: "var(--syn-comment)", fontStyle: "italic" },
  { tag: [t.punctuation, t.separator, t.squareBracket, t.brace], color: "var(--syn-punct)" },
  { tag: [t.keyword, t.typeName, t.labelName], color: "var(--syn-keyword)" },
]);

const theme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13px",
    backgroundColor: "var(--editor-bg)",
    color: "var(--text)",
  },
  ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.55", fontVariantLigatures: "none" },
  ".cm-gutters": { backgroundColor: "var(--editor-gutter)", color: "var(--muted)", border: "none" },
  ".cm-activeLine": { backgroundColor: "var(--editor-active)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--editor-active)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--editor-selection) !important",
  },
  ".cm-cursor": { borderLeftColor: "var(--text)" },
  ".cm-tooltip": {
    backgroundColor: "var(--panel)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    boxShadow: "var(--shadow)",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--accent)",
    color: "var(--accent-ink)",
  },
  ".cm-tooltip.cm-tooltip-hover": { padding: "6px 10px", maxWidth: "420px", fontSize: "12.5px" },
});

function createState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      lineNumbers(),
      foldGutter(),
      lintGutter(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      drawSelection(),
      history(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      yaml(),
      yamlLanguage.data.of({ autocomplete: yamlCompletion() }),
      hoverTooltip(yamlSchemaHover()),
      stateExtensions(schema),
      syntaxHighlighting(highlight),
      theme,
      EditorState.tabSize.of(2),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...completionKeymap,
        indentWithTab,
      ]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) onchange(u.state.doc.toString());
      }),
      EditorView.contentAttributes.of({ "aria-label": "Diagram YAML" }),
    ],
  });
}

onMount(() => {
  view = new EditorView({ state: createState(initial), parent: host });
});
onDestroy(() => view?.destroy());

/** Replace the whole document with a fresh history (new / open / example). */
export function load(text: string) {
  view?.setState(createState(text));
}

export function getText(): string {
  return view?.state.doc.toString() ?? initial;
}

/** Show engine diagnostics, but only if they belong to the current text. */
export function showDiagnostics(text: string, diagnostics: readonly Diagnostic[]) {
  if (!view || view.state.doc.toString() !== text) return;
  const len = view.state.doc.length;
  const cm: CmDiagnostic[] = diagnostics.flatMap((d) => {
    if (!d.range) return [];
    const from = Math.min(d.range.from, len);
    const to = Math.min(Math.max(d.range.to, from + 1), len);
    return [
      {
        from,
        to,
        severity: d.severity,
        message: `${d.message}${d.hint ? `\n${d.hint}` : ""}`,
        source: d.code,
      },
    ];
  });
  view.dispatch(setDiagnostics(view.state, cm));
}

export function reveal(from: number, to: number) {
  if (!view) return;
  const len = view.state.doc.length;
  view.dispatch({
    selection: { anchor: Math.min(from, len), head: Math.min(to, len) },
    scrollIntoView: true,
  });
  view.focus();
}
</script>

<div class="editor" bind:this={host}></div>

<style>
  .editor {
    height: 100%;
    overflow: hidden;
  }
</style>
