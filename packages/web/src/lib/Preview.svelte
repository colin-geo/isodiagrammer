<script lang="ts">
/**
 * Pan/zoom preview of the engine's SVG. Conventions (as in most canvas tools):
 * drag or wheel to pan, Ctrl/⌘ + wheel or pinch to zoom.
 */
import { onDestroy, onMount } from "svelte";
import { fit, panBy, svgSize, type View, zoomAt } from "./panzoom.ts";

interface Props {
  svg: string | undefined;
  /** true when `svg` is an older render because the current text has errors */
  stale: boolean;
  /** bump to request fit-to-content */
  fitRequest: number;
}
const { svg, stale, fitRequest }: Props = $props();

let container: HTMLDivElement;
let view = $state<View>({ x: 0, y: 0, k: 1 });
let vw = 0;
let vh = 0;
let lastFit = -1;

const size = $derived(svg ? svgSize(svg) : { w: 0, h: 0 });

function doFit() {
  view = fit(size.w, size.h, vw, vh);
}

// Fit when asked to, once we have both a render and a measured viewport.
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

// ---- input ------------------------------------------------------------------------
const pointers = new Map<number, { x: number; y: number }>();
let pinchDist = 0;

const local = (e: { clientX: number; clientY: number }) => {
  const r = container.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};

function onwheel(e: WheelEvent) {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    const p = local(e);
    view = zoomAt(view, Math.exp(-e.deltaY * 0.0025), p.x, p.y);
  } else {
    view = panBy(view, -e.deltaX, -e.deltaY);
  }
}

function onpointerdown(e: PointerEvent) {
  if (e.button !== 0 && e.button !== 1) return;
  // Don't capture presses on the overlay controls, or their clicks never arrive.
  if ((e.target as Element).closest("button, .zoom")) return;
  container.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, local(e));
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
  }
}

function onpointermove(e: PointerEvent) {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  const p = local(e);
  pointers.set(e.pointerId, p);
  if (pointers.size === 1) {
    view = panBy(view, p.x - prev.x, p.y - prev.y);
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDist > 0) view = zoomAt(view, d / pinchDist, (a.x + b.x) / 2, (a.y + b.y) / 2);
    pinchDist = d;
  }
}

function onpointerup(e: PointerEvent) {
  pointers.delete(e.pointerId);
  pinchDist = 0;
}

const zoomBy = (f: number) => {
  view = zoomAt(view, f, vw / 2, vh / 2);
};

function onkeydown(e: KeyboardEvent) {
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
  if (action && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    action();
  }
}
</script>

<!-- A focusable pan/zoom canvas with its own keyboard handling: role="application" is the
     correct ARIA role, but Svelte's a11y lint treats it as non-interactive. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="preview"
  class:stale
  bind:this={container}
  {onwheel}
  {onpointerdown}
  {onpointermove}
  {onpointerup}
  onpointercancel={onpointerup}
  {onkeydown}
  role="application"
  aria-label="Diagram preview. Drag or arrow keys to pan, Ctrl+wheel or +/− to zoom, 0 to fit."
  tabindex="0"
>
  {#if svg}
    <div class="content" style:transform="translate({view.x}px, {view.y}px) scale({view.k})">
      {@html svg}
    </div>
  {:else}
    <p class="empty">Nothing to show yet: fix the errors on the left.</p>
  {/if}

  {#if stale}
    <div class="badge" role="status">Showing the last valid render</div>
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
  .preview:active {
    cursor: grabbing;
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
