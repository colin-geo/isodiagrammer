<script lang="ts">
/**
 * Interactive preview (PLAN.md §7).
 * - Drag a resource (or a group by its label / once selected) to move it; the drop is
 *   written back to the YAML as one undoable edit. Alt-drag keeps the current group.
 * - Click selects (synced with the editor). Arrows nudge the selection; Esc deselects.
 * - Drag the background, Space+drag, middle-drag or wheel to pan; Ctrl/⌘+wheel or pinch zooms.
 */
import {
  type EditOp,
  footprintPolygon,
  type LayoutInfo,
  type NodeInfo,
  type Pt,
  screenToWorld,
  type Vec2,
  worldToScreen,
  worldVecToScreen,
} from "@isodiagrammer/core";
import { onDestroy, onMount } from "svelte";
import {
  computeDrop,
  computeResize,
  type DropCandidate,
  nudgeDelta,
  type ResizeCandidate,
  withDescendants,
} from "./drag.ts";
import { fit, panBy, svgSize, type View, zoomAt } from "./panzoom.ts";

interface Props {
  svg: string | undefined;
  /** true when `svg` is an older render because the current text has errors */
  stale: boolean;
  /** bump to request fit-to-content */
  fitRequest: number;
  /** bumps on every compile result (even if the SVG is unchanged) */
  renderKey: number;
  layout: LayoutInfo | undefined;
  selected: string | undefined;
  onselect: (id: string | undefined) => void;
  onedit: (op: EditOp) => void;
  onundo: () => void;
  onredo: () => void;
}
const {
  svg,
  stale,
  fitRequest,
  renderKey,
  layout,
  selected,
  onselect,
  onedit,
  onundo,
  onredo,
}: Props = $props();

let container: HTMLDivElement;
let content = $state<HTMLDivElement>();
let view = $state<View>({ x: 0, y: 0, k: 1 });
let vw = 0;
let vh = 0;
let lastFit = -1;

const size = $derived(svg ? svgSize(svg) : { w: 0, h: 0 });
const viewBox = $derived(svg ? (/<svg\b[^>]*\sviewBox="([^"]+)"/.exec(svg)?.[1] ?? "") : "");
const interactive = $derived(!stale && layout !== undefined);
const nodes = $derived(new Map((layout?.nodes ?? []).map((n) => [n.id, n])));
const rotation = $derived(layout?.rotation ?? 0);
const selectedNode = $derived(selected ? nodes.get(selected) : undefined);

function doFit() {
  view = fit(size.w, size.h, vw, vh);
}

$effect(() => {
  if (svg && fitRequest !== lastFit && vw > 0) {
    lastFit = fitRequest;
    doFit();
  }
});

let ro: ResizeObserver | undefined;
onMount(() => {
  ro = new ResizeObserver(([entry]) => {
    if (!entry) return;
    vw = entry.contentRect.width;
    vh = entry.contentRect.height;
    if (svg && lastFit !== fitRequest) {
      lastFit = fitRequest;
      doFit();
    }
  });
  ro.observe(container);
});
onDestroy(() => ro?.disconnect());

// ---- selection highlight & cleanup after each render -----------------------------------
$effect(() => {
  void renderKey;
  void svg;
  const root = content;
  if (!root) return;
  clearTransforms();
  for (const el of root.querySelectorAll(".selected")) el.classList.remove("selected");
  if (selected) {
    for (const el of root.querySelectorAll(`[data-id="${CSS.escape(selected)}"]`))
      el.classList.add("selected");
  }
});

// ---- geometry helpers -------------------------------------------------------------------
const local = (e: { clientX: number; clientY: number }) => {
  const r = container.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};

/** Pointer → world grid coordinates via the diagram SVG's own transform. */
function toWorld(e: { clientX: number; clientY: number }): Vec2 | undefined {
  const svgEl = content?.querySelector<SVGSVGElement>(":scope > svg:not(.overlay)");
  const ctm = svgEl?.getScreenCTM();
  if (!ctm) return undefined;
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
  return screenToWorld(p.x, p.y, rotation);
}

const points = (pts: Pt[]) => pts.map(([x, y]) => `${x},${y}`).join(" ");

// ---- moving elements during a drag --------------------------------------------------------
let translated: Element[] = [];

function translate(ids: Set<string>, delta: Vec2) {
  if (!content) return;
  if (translated.length === 0) {
    translated = [...content.querySelectorAll("[data-id]")].filter((el) =>
      ids.has((el as HTMLElement).dataset.id ?? ""),
    );
  }
  const [dx, dy] = worldVecToScreen(delta, rotation);
  for (const el of translated) el.setAttribute("transform", `translate(${dx} ${dy})`);
}

function clearTransforms() {
  for (const el of translated) el.removeAttribute("transform");
  translated = [];
}

// ---- gestures -------------------------------------------------------------------------------
type Gesture =
  | { kind: "none" }
  | {
      kind: "pending";
      id: number;
      at: { x: number; y: number };
      /** world point under the pointer at press time: the drag's origin */
      world: Vec2 | undefined;
      node?: NodeInfo;
      draggable: boolean;
      resize: boolean;
    }
  | { kind: "pan"; id: number; last: { x: number; y: number } }
  | {
      kind: "drag";
      id: number;
      node: NodeInfo;
      start: Vec2;
      ids: Set<string>;
      candidate?: DropCandidate;
    }
  | { kind: "resize"; id: number; node: NodeInfo; candidate?: ResizeCandidate };

let gesture = $state<Gesture>({ kind: "none" });
const pointers = new Map<number, { x: number; y: number }>();
let pinchDist = 0;
let spaceDown = false;

const dropCandidate = $derived(gesture.kind === "drag" ? gesture.candidate : undefined);
const resizeCandidate = $derived(gesture.kind === "resize" ? gesture.candidate : undefined);

function onwheel(e: WheelEvent) {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    const p = local(e);
    view = zoomAt(view, Math.exp(-e.deltaY * 0.0025), p.x, p.y);
  } else {
    view = panBy(view, -e.deltaX, -e.deltaY);
  }
}

function cancelGesture() {
  clearTransforms();
  gesture = { kind: "none" };
}

function onpointerdown(e: PointerEvent) {
  if (e.button !== 0 && e.button !== 1) return;
  const target = e.target as Element;
  // Don't capture presses on overlay controls, or their clicks never arrive.
  if (target.closest("button, .zoom, .selbar")) return;
  container.setPointerCapture(e.pointerId);
  container.focus({ preventScroll: true });
  const p = local(e);
  pointers.set(e.pointerId, p);

  if (pointers.size === 2) {
    cancelGesture();
    const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    return;
  }
  if (e.button === 1 || spaceDown || !interactive) {
    gesture = { kind: "pan", id: e.pointerId, last: p };
    return;
  }
  if (target.closest(".resize-handle") && selectedNode) {
    gesture = {
      kind: "pending",
      id: e.pointerId,
      at: p,
      world: toWorld(e),
      node: selectedNode,
      draggable: true,
      resize: true,
    };
    return;
  }
  const hit = (target.closest("[data-id]") as HTMLElement | null)?.dataset.id;
  const node = hit ? nodes.get(hit) : undefined;
  const draggable =
    !!node && (node.kind === "resource" || target.tagName === "text" || selected === node.id);
  gesture = {
    kind: "pending",
    id: e.pointerId,
    at: p,
    world: toWorld(e),
    ...(node ? { node } : {}),
    draggable,
    resize: false,
  };
}

function onpointermove(e: PointerEvent) {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  const p = local(e);
  pointers.set(e.pointerId, p);

  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDist > 0) view = zoomAt(view, d / pinchDist, (a.x + b.x) / 2, (a.y + b.y) / 2);
    pinchDist = d;
    return;
  }

  const g = gesture;
  if (g.kind === "pending" && g.id === e.pointerId) {
    if (Math.hypot(p.x - g.at.x, p.y - g.at.y) < 4) return;
    const start = g.world;
    if (g.resize && g.node) gesture = { kind: "resize", id: g.id, node: g.node };
    else if (g.draggable && g.node && start && layout)
      gesture = {
        kind: "drag",
        id: g.id,
        node: g.node,
        start,
        ids: withDescendants(layout, g.node.id),
      };
    else gesture = { kind: "pan", id: g.id, last: g.at };
  }

  const cur = gesture;
  if (cur.kind === "pan" && cur.id === e.pointerId) {
    view = panBy(view, p.x - cur.last.x, p.y - cur.last.y);
    gesture = { ...cur, last: p };
  } else if (cur.kind === "drag" && cur.id === e.pointerId && layout) {
    const w = toWorld(e);
    if (!w) return;
    const delta: Vec2 = [Math.round(w[0] - cur.start[0]), Math.round(w[1] - cur.start[1])];
    const candidate = computeDrop(layout, cur.node.id, delta, { keepParent: e.altKey });
    translate(cur.ids, delta);
    gesture = { ...cur, ...(candidate ? { candidate } : {}) };
  } else if (cur.kind === "resize" && cur.id === e.pointerId && layout) {
    const w = toWorld(e);
    if (!w) return;
    const size: Vec2 = [
      Math.max(1, Math.round(w[0] - cur.node.abs[0])),
      Math.max(1, Math.round(w[1] - cur.node.abs[1])),
    ];
    const candidate = computeResize(layout, cur.node.id, size);
    gesture = { ...cur, ...(candidate ? { candidate } : {}) };
  }
}

function onpointerup(e: PointerEvent) {
  pointers.delete(e.pointerId);
  pinchDist = 0;
  const g = gesture;
  if ("id" in g && g.id !== e.pointerId) return;
  gesture = { kind: "none" };

  if (g.kind === "pending") {
    onselect(g.node?.id); // a click: select (or deselect on background)
  } else if (g.kind === "drag") {
    const c = g.candidate;
    if (c?.valid && c.changed) {
      // Keep the elements where they were dropped until the new render replaces them.
      onselect(c.id);
      onedit({
        kind: "move",
        id: c.id,
        at: c.at,
        ...(c.reparented ? { parent: c.parent ?? null } : {}),
      });
    } else {
      clearTransforms();
    }
  } else if (g.kind === "resize") {
    const c = g.candidate;
    if (c?.valid && c.changed) onedit({ kind: "resize", id: c.id, size: c.size });
  }
}

function onpointercancel(e: PointerEvent) {
  pointers.delete(e.pointerId);
  cancelGesture();
}

const zoomBy = (f: number) => {
  view = zoomAt(view, f, vw / 2, vh / 2);
};

function onkeydown(e: KeyboardEvent) {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (mod && key === "z") {
    e.preventDefault();
    if (e.shiftKey) onredo();
    else onundo();
    return;
  }
  if (mod && key === "y") {
    e.preventDefault();
    onredo();
    return;
  }
  if (mod) return;
  if (e.key === " ") {
    spaceDown = true;
    e.preventDefault();
    return;
  }
  if (e.key === "Escape") {
    if (gesture.kind !== "none") cancelGesture();
    else onselect(undefined);
    return;
  }
  // Arrow keys nudge the selection by one cell; with nothing selected they pan.
  const nudge = nudgeDelta(e.key, rotation);
  if (nudge && selectedNode && interactive && layout) {
    e.preventDefault();
    const c = computeDrop(layout, selectedNode.id, nudge, { keepParent: true });
    if (c?.valid && c.changed) onedit({ kind: "move", id: c.id, at: c.at });
    return;
  }
  const step = e.shiftKey ? 120 : 40;
  const actions: Record<string, () => void> = {
    "+": () => zoomBy(1.25),
    "=": () => zoomBy(1.25),
    "-": () => zoomBy(0.8),
    0: doFit,
    ArrowLeft: () => (view = panBy(view, step, 0)),
    ArrowRight: () => (view = panBy(view, -step, 0)),
    ArrowUp: () => (view = panBy(view, 0, step)),
    ArrowDown: () => (view = panBy(view, 0, -step)),
  };
  const action = actions[e.key];
  if (action) {
    e.preventDefault();
    action();
  }
}

function onkeyup(e: KeyboardEvent) {
  if (e.key === " ") spaceDown = false;
}

// ---- overlay shapes -----------------------------------------------------------------------
const ghost = $derived.by(() => {
  if (dropCandidate) {
    const n = nodes.get(dropCandidate.id);
    return n
      ? { pts: footprintPolygon(dropCandidate.abs, n.size, rotation), valid: dropCandidate.valid }
      : undefined;
  }
  if (resizeCandidate) {
    const n = nodes.get(resizeCandidate.id);
    return n
      ? {
          pts: footprintPolygon(n.abs, resizeCandidate.size, rotation),
          valid: resizeCandidate.valid,
        }
      : undefined;
  }
  return undefined;
});

const targetGroup = $derived.by(() => {
  if (!dropCandidate?.parent || !dropCandidate.reparented) return undefined;
  const g = nodes.get(dropCandidate.parent);
  return g ? footprintPolygon(g.abs, g.size, rotation) : undefined;
});

const handle = $derived.by(() => {
  if (!interactive || selectedNode?.kind !== "group" || gesture.kind === "drag") return undefined;
  const n = selectedNode;
  const size = resizeCandidate?.size ?? n.size;
  return worldToScreen([n.abs[0] + size[0], n.abs[1] + size[1]], rotation);
});

const hint = $derived.by(() => {
  const c = dropCandidate ?? resizeCandidate;
  if (!c) return undefined;
  if (!c.valid) return { text: `Can't drop here: ${c.reason}`, valid: false };
  if (resizeCandidate)
    return {
      text: `Resize to ${resizeCandidate.size[0]} × ${resizeCandidate.size[1]}`,
      valid: true,
    };
  if (dropCandidate?.reparented)
    return {
      text: dropCandidate.parent
        ? `Move into “${dropCandidate.parent}”`
        : "Move out to the top level",
      valid: true,
    };
  return { text: `at [${dropCandidate?.at.join(", ")}]`, valid: true };
});
</script>

<svelte:window onblur={() => (spaceDown = false)} />

<!-- A focusable pan/zoom canvas with its own keyboard handling: role="application" is the
     correct ARIA role, but Svelte's a11y lint treats it as non-interactive. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="preview"
  class:stale
  class:interactive
  class:dragging={gesture.kind === "drag" || gesture.kind === "resize"}
  class:panning={gesture.kind === "pan"}
  bind:this={container}
  {onwheel}
  {onpointerdown}
  {onpointermove}
  {onpointerup}
  {onpointercancel}
  {onkeydown}
  {onkeyup}
  role="application"
  aria-label="Diagram preview. Drag items to move them; drag the background or use the wheel to pan; Ctrl+wheel or +/− to zoom; 0 to fit. With an item selected, arrow keys nudge it."
  tabindex="0"
>
  {#if svg}
    <div
      class="content"
      bind:this={content}
      style:transform="translate({view.x}px, {view.y}px) scale({view.k})"
    >
      {@html svg}
      <svg class="overlay" viewBox={viewBox} width={size.w} height={size.h} aria-hidden="true">
        {#if targetGroup}
          <polygon class="target" points={points(targetGroup)} />
        {/if}
        {#if ghost}
          <polygon class="ghost" class:invalid={!ghost.valid} points={points(ghost.pts)} />
        {/if}
        {#if handle}
          <circle class="resize-handle" cx={handle[0]} cy={handle[1]} r={7 / view.k} />
        {/if}
      </svg>
    </div>
  {:else}
    <p class="empty">Nothing to show yet: fix the errors on the left.</p>
  {/if}

  {#if hint}
    <div class="badge" class:invalid={!hint.valid} role="status">{hint.text}</div>
  {:else if stale}
    <div class="badge" role="status">Showing the last valid render</div>
  {/if}

  {#if selectedNode && interactive}
    <div class="selbar" data-testid="selection">
      <strong>{selectedNode.id}</strong>
      <span class="dim">{selectedNode.pinned ? `pinned at [${selectedNode.at.join(", ")}]` : "auto-placed"}</span>
      {#if selectedNode.pinned}
        <button type="button" onclick={() => onedit({ kind: "unpin", id: selectedNode.id })} title="Remove `at` and let layout place it">Unpin</button>
      {/if}
      <button type="button" class="close" onclick={() => onselect(undefined)} aria-label="Deselect">✕</button>
    </div>
  {/if}

  <div class="zoom" role="toolbar" aria-label="Zoom">
    <button type="button" onclick={() => zoomBy(0.8)} aria-label="Zoom out" title="Zoom out (−)">−</button>
    <span class="level" data-testid="zoom-level">{Math.round(view.k * 100)}%</span>
    <button type="button" onclick={() => zoomBy(1.25)} aria-label="Zoom in" title="Zoom in (+)">+</button>
    <button type="button" onclick={doFit} title="Fit to view (0)">Fit</button>
  </div>
</div>

<style>
  .preview {
    position: relative;
    height: 100%;
    overflow: hidden;
    background: var(--canvas);
    cursor: grab;
    touch-action: none;
    outline: none;
  }
  .preview.panning {
    cursor: grabbing;
  }
  .preview.dragging {
    cursor: move;
  }
  .preview:focus-visible {
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .content {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
    line-height: 0;
    transition: opacity 0.15s;
  }
  .stale .content {
    opacity: 0.45;
  }
  .content :global(svg) {
    display: block;
    user-select: none;
  }
  .interactive .content :global(g.resource[data-id]),
  .interactive .content :global(g.label[data-id]),
  .interactive .content :global(g.group text),
  .interactive .content :global(g.group.selected) {
    cursor: move;
  }
  .content :global(g.selected) {
    filter: drop-shadow(0 0 1.5px var(--accent)) drop-shadow(0 0 4px var(--accent));
  }
  .dragging .content :global(g[transform]) {
    opacity: 0.85;
  }
  .overlay {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
    overflow: visible;
  }
  .ghost {
    fill: rgb(34 197 94 / 0.25);
    stroke: rgb(22 163 74);
    stroke-width: 2;
    stroke-dasharray: 6 4;
  }
  .ghost.invalid {
    fill: rgb(239 68 68 / 0.25);
    stroke: rgb(220 38 38);
  }
  .target {
    fill: none;
    stroke: var(--accent);
    stroke-width: 3;
  }
  .resize-handle {
    pointer-events: auto;
    fill: var(--panel);
    stroke: var(--accent);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
    cursor: nwse-resize;
  }
  .empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--muted);
    margin: 0;
  }
  .badge {
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--warn-bg);
    color: var(--warn-ink);
    border: 1px solid var(--warn-border);
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 12px;
    pointer-events: none;
    white-space: nowrap;
  }
  .badge:not(.invalid) {
    background: var(--panel);
    color: var(--text);
    border-color: var(--border);
  }
  .stale .badge:not(.invalid) {
    background: var(--warn-bg);
    color: var(--warn-ink);
    border-color: var(--warn-border);
  }
  .badge.invalid {
    background: #fef2f2;
    color: #991b1b;
    border-color: #fca5a5;
  }
  .selbar {
    position: absolute;
    left: 12px;
    bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 4px 4px 4px 10px;
    box-shadow: var(--shadow);
    font-size: 12.5px;
    cursor: default;
  }
  .selbar strong {
    font-family: var(--mono);
    font-weight: 600;
  }
  .selbar .dim {
    color: var(--muted);
  }
  .selbar button {
    height: 26px;
    padding: 0 8px;
    border: 1px solid var(--border);
    background: var(--button);
    color: var(--text);
    border-radius: 5px;
    font: inherit;
    cursor: pointer;
  }
  .selbar button.close {
    border: none;
    background: none;
    color: var(--muted);
  }
  .zoom {
    position: absolute;
    right: 12px;
    bottom: 12px;
    display: flex;
    align-items: center;
    gap: 2px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 3px;
    box-shadow: var(--shadow);
    cursor: default;
  }
  .zoom button {
    min-width: 28px;
    height: 28px;
    border: none;
    background: transparent;
    color: var(--text);
    border-radius: 5px;
    font: inherit;
    cursor: pointer;
  }
  .zoom button:hover {
    background: var(--hover);
  }
  .level {
    min-width: 46px;
    text-align: center;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }
</style>
