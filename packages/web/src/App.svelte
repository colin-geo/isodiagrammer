<script lang="ts">
import type { Diagnostic, EditOp, LayoutInfo } from "@isodiagrammer/core";
import { onDestroy, onMount } from "svelte";
import { type CompileResponse, Compiler, createCompileWorker } from "./lib/compiler.ts";
import DiagnosticsPanel from "./lib/DiagnosticsPanel.svelte";
import { applyOpToLayout, nodeAtSource } from "./lib/drag.ts";
import Editor from "./lib/Editor.svelte";
import { EXAMPLES, STARTER } from "./lib/examples.ts";
import { baseName, cleanSvg, download, svgToPng } from "./lib/export.ts";
import { type FileHandle, openFile, saveFile } from "./lib/files.ts";
import HelpPanel from "./lib/HelpPanel.svelte";
import Preview from "./lib/Preview.svelte";
import { autosave, loadAutosave, loadUi, saveUi } from "./lib/storage.ts";

const restored = loadAutosave();
const initialText = restored?.text ?? STARTER?.text ?? "version: 1\n";

let editor: Editor;
let name = $state(restored?.name ?? STARTER?.name ?? "diagram.yaml");
let text = $state(initialText);
let savedText = $state<string | undefined>(restored ? restored.savedText : initialText);
let handle: FileHandle | undefined;

let result = $state<CompileResponse | undefined>();
let lastGoodSvg = $state<string | undefined>();
let lastGoodLayout = $state<LayoutInfo | undefined>();
let renderKey = $state(0);
let selected = $state<string | undefined>();
let fitRequest = $state(0);
let busy = $state(false);
let message = $state<string | undefined>();

const ui = $state(loadUi());
let main: HTMLElement;

const dirty = $derived(text !== savedText);
const diagnostics = $derived<readonly Diagnostic[]>(result?.diagnostics ?? []);
const errors = $derived(diagnostics.filter((d) => d.severity === "error").length);
const warnings = $derived(diagnostics.filter((d) => d.severity === "warning").length);
const stale = $derived(
  result !== undefined && result.svg === undefined && lastGoodSvg !== undefined,
);

$effect(() => {
  document.title = `${dirty ? "• " : ""}${name} · Isometric Diagrammer`;
});

// ---- compile pipeline --------------------------------------------------------------
const worker = createCompileWorker();
const compiler = new Compiler(worker, (r) => {
  result = r;
  renderKey++;
  if (r.svg) {
    lastGoodSvg = r.svg;
    lastGoodLayout = r.layout;
  }
  editor?.showDiagnostics(r.text, r.diagnostics);
});
onDestroy(() => worker.terminate());

let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
function persist() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => autosave({ name, text, savedText }), 400);
}

function onchange(t: string, immediate: boolean) {
  text = t;
  compiler.update(t, immediate);
  persist();
}

// ---- preview ↔ editor ----------------------------------------------------------------
/** Cursor moved in the editor: highlight the node whose entry it's in. */
function onEditorSelection(pos: number) {
  if (lastGoodLayout && result?.text === text) selected = nodeAtSource(lastGoodLayout, pos);
}

/** Clicked in the preview: select the node's key in the editor (without stealing focus). */
function onPreviewSelect(id: string | undefined) {
  selected = id;
  const key = id ? lastGoodLayout?.nodes.find((n) => n.id === id)?.key : undefined;
  if (key) editor.select(key.from, key.to);
}

function onPreviewEdit(op: EditOp) {
  message = undefined;
  try {
    editor.applyOp(op);
    // Optimistic: the next drag/nudge starts from here, even before the re-render arrives.
    if (lastGoodLayout) lastGoodLayout = applyOpToLayout(lastGoodLayout, op);
  } catch (e) {
    message = `Couldn't apply that change: ${(e as Error).message}`;
  }
}

function loadDocument(newName: string, newText: string, newHandle?: FileHandle) {
  name = newName;
  text = newText;
  savedText = newText;
  handle = newHandle;
  selected = undefined;
  editor.load(newText);
  compiler.update(newText, true);
  fitRequest++;
  persist();
}

onMount(() => {
  compiler.update(initialText, true);
});

// ---- actions --------------------------------------------------------------------------
const confirmDiscard = () =>
  !dirty || window.confirm("Discard unsaved changes to the current diagram?");

async function run(action: () => Promise<void>) {
  message = undefined;
  try {
    await action();
  } catch (e) {
    message = (e as Error).message;
  }
}

const newDoc = () => {
  if (confirmDiscard())
    loadDocument("untitled.yaml", "version: 1\n\nresources:\n  web: { type: server }\n");
};

const open = () =>
  run(async () => {
    if (!confirmDiscard()) return;
    const f = await openFile();
    if (f) loadDocument(f.name, f.text, f.handle);
  });

const save = (saveAs = false) =>
  run(async () => {
    const r = await saveFile(text, name, handle, saveAs);
    if (!r) return;
    name = r.name;
    handle = r.handle;
    savedText = text;
    persist();
  });

const exportSvg = () =>
  run(async () => {
    if (lastGoodSvg)
      download(
        new Blob([cleanSvg(lastGoodSvg)], { type: "image/svg+xml" }),
        `${baseName(name)}.svg`,
      );
  });

const exportPng = () =>
  run(async () => {
    if (!lastGoodSvg) return;
    busy = true;
    try {
      download(await svgToPng(cleanSvg(lastGoodSvg), 2), `${baseName(name)}.png`);
    } finally {
      busy = false;
    }
  });

function chooseExample(e: Event) {
  const select = e.currentTarget as HTMLSelectElement;
  const ex = EXAMPLES.find((x) => x.name === select.value);
  select.value = "";
  if (ex && confirmDiscard()) loadDocument(ex.name, ex.text);
}

function onkeydown(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === "s") {
    e.preventDefault();
    save(e.shiftKey);
  } else if (k === "o") {
    e.preventDefault();
    open();
  }
}

// ---- split pane ------------------------------------------------------------------------
function startResize(e: PointerEvent) {
  const target = e.currentTarget as HTMLElement;
  target.setPointerCapture(e.pointerId);
  const move = (ev: PointerEvent) => {
    const r = main.getBoundingClientRect();
    ui.split = Math.min(0.75, Math.max(0.2, (ev.clientX - r.left) / r.width));
  };
  const up = () => {
    target.removeEventListener("pointermove", move);
    saveUi(ui);
  };
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", up, { once: true });
}

function resizeKey(e: KeyboardEvent) {
  const d = e.key === "ArrowLeft" ? -0.02 : e.key === "ArrowRight" ? 0.02 : 0;
  if (!d) return;
  e.preventDefault();
  ui.split = Math.min(0.75, Math.max(0.2, ui.split + d));
  saveUi(ui);
}

function toggleHelp() {
  ui.helpOpen = !ui.helpOpen;
  saveUi(ui);
}
</script>

<svelte:window {onkeydown} />

<div class="app" class:help-open={ui.helpOpen}>
  <header class="toolbar">
    <div class="brand">
      <img src="/favicon.svg" alt="" width="20" height="20" />
      <span>Isometric Diagrammer</span>
    </div>
    <div class="file" title={name}>
      <span class="name" data-testid="doc-name">{name}</span>
      {#if dirty}<span class="dot" aria-label="unsaved changes">•</span>{/if}
    </div>
    <nav class="actions" aria-label="Document">
      <button type="button" onclick={newDoc}>New</button>
      <button type="button" onclick={open} title="Open (Ctrl+O)">Open</button>
      <button type="button" onclick={() => save()} title="Save (Ctrl+S)">Save</button>
      <select aria-label="Load an example" onchange={chooseExample}>
        <option value="">Examples…</option>
        {#each EXAMPLES as ex (ex.name)}<option value={ex.name}>{ex.name}</option>{/each}
      </select>
      <span class="sep"></span>
      <button type="button" onclick={exportSvg} disabled={!lastGoodSvg}>Export SVG</button>
      <button type="button" onclick={exportPng} disabled={!lastGoodSvg || busy}>{busy ? "Exporting…" : "Export PNG"}</button>
      <span class="sep"></span>
      <button type="button" class:active={ui.helpOpen} onclick={toggleHelp} aria-pressed={ui.helpOpen}>Help</button>
    </nav>
  </header>

  <main bind:this={main} style:grid-template-columns="{ui.split * 100}% 6px 1fr">
    <section class="left" aria-label="Editor">
      <div class="editor-wrap">
        <Editor bind:this={editor} initial={initialText} {onchange} onselection={onEditorSelection} />
      </div>
      <DiagnosticsPanel {diagnostics} text={result?.text ?? text} onselect={(f, t) => editor.reveal(f, t)} />
    </section>
    <!-- WAI-ARIA "window splitter": a focusable separator is interactive, which Svelte's lint doesn't know. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      class="divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize editor"
      aria-valuenow={Math.round(ui.split * 100)}
      aria-valuemin={20}
      aria-valuemax={75}
      tabindex="0"
      onpointerdown={startResize}
      onkeydown={resizeKey}
    ></div>
    <section class="right" aria-label="Preview">
      <Preview
        svg={lastGoodSvg}
        {stale}
        {fitRequest}
        {renderKey}
        layout={lastGoodLayout}
        {selected}
        onselect={onPreviewSelect}
        onedit={onPreviewEdit}
        onundo={() => editor.undo()}
        onredo={() => editor.redo()}
      />
      {#if ui.helpOpen}
        <div class="help-wrap"><HelpPanel onclose={toggleHelp} /></div>
      {/if}
    </section>
  </main>

  <footer class="status" role="status" data-testid="status">
    {#if message}
      <span class="err">{message}</span>
    {:else if !result}
      <span>Rendering…</span>
    {:else if errors + warnings === 0}
      <span class="ok">✓ No problems</span>
    {:else}
      <span class:err={errors > 0}>{errors} error{errors === 1 ? "" : "s"}</span>
      <span>{warnings} warning{warnings === 1 ? "" : "s"}</span>
    {/if}
    {#if result}<span class="dim">rendered in {Math.round(result.ms)} ms</span>{/if}
  </footer>
</div>

<style>
  .app {
    display: grid;
    grid-template-rows: auto 1fr auto;
    height: 100vh;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    min-width: 0;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    white-space: nowrap;
  }
  .file {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    color: var(--muted);
    font-family: var(--mono);
    font-size: 12.5px;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot {
    color: var(--accent);
    font-size: 18px;
    line-height: 1;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
  }
  .actions button,
  .actions select {
    height: 30px;
    padding: 0 10px;
    border: 1px solid var(--border);
    background: var(--button);
    color: var(--text);
    border-radius: 6px;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .actions button:hover:not(:disabled),
  .actions select:hover {
    background: var(--hover);
  }
  .actions button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .actions select {
    max-width: 150px;
  }
  .actions button.active {
    background: var(--accent);
    color: var(--accent-ink);
    border-color: var(--accent);
  }
  .sep {
    width: 1px;
    height: 20px;
    background: var(--border);
    margin: 0 4px;
  }
  main {
    display: grid;
    min-height: 0;
  }
  .left {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  .editor-wrap {
    flex: 1;
    min-height: 0;
  }
  .divider {
    cursor: col-resize;
    background: var(--border);
    border-left: 2px solid var(--panel);
    border-right: 2px solid var(--panel);
  }
  .divider:hover,
  .divider:focus-visible {
    background: var(--accent);
    outline: none;
  }
  .right {
    position: relative;
    min-width: 0;
    min-height: 0;
  }
  .help-wrap {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(360px, 90%);
    box-shadow: var(--shadow);
  }
  .status {
    display: flex;
    gap: 14px;
    padding: 4px 12px;
    font-size: 12px;
    border-top: 1px solid var(--border);
    background: var(--panel);
    color: var(--text);
  }
  .ok {
    color: var(--ok);
  }
  .err {
    color: var(--error);
  }
  .dim {
    color: var(--muted);
    margin-left: auto;
  }
  @media (max-width: 900px) {
    .brand span {
      display: none;
    }
  }
</style>
