<script lang="ts">
/** Quick reference, generated from the engine's own catalogue so it can't drift. */
import { CATALOG, GLYPHS } from "@isodiagrammer/core";

interface Props {
  onclose: () => void;
}
const { onclose }: Props = $props();

const types = Object.entries(CATALOG);
const glyphs = Object.keys(GLYPHS);
</script>

<aside class="help" aria-label="Quick reference">
  <header>
    <h2>Quick reference</h2>
    <button type="button" onclick={onclose} aria-label="Close quick reference">✕</button>
  </header>

  <section>
    <h3>Skeleton</h3>
    <pre>version: 1
groups:
  vpc: &#123; label: VPC &#125;
resources:
  web: &#123; type: server, in: vpc &#125;
  db:  &#123; type: database, in: vpc, at: [6, 2] &#125;
links:
  - web -> db</pre>
    <p>Leave out <code>at</code> and the node is placed automatically. Add <code>at: [x, y]</code> to pin it, relative to its group.</p>
  </section>

  <section>
    <h3>Links</h3>
    <ul>
      <li><code>a -> b</code> arrow, <code>a &lt;-> b</code> both ways, <code>a -- b</code> no arrow</li>
      <li><code>&#123; from: a, to: b, label: SQL, style: dashed &#125;</code>, with <code>style</code> one of solid · dashed · dotted, and <code>route</code> orthogonal · straight</li>
    </ul>
  </section>

  <section>
    <h3>Built-in types</h3>
    <ul class="chips">
      {#each types as [name, v] (name)}
        <li><span class="swatch" style:background={v.color}></span>{name}<span class="dim">{v.shape}</span></li>
      {/each}
    </ul>
    <p>Define your own under <code>types:</code> with <code>shape</code>, <code>size</code>, <code>height</code>, <code>color</code>, <code>icon</code>.</p>
  </section>

  <section>
    <h3>Icons</h3>
    <p><code>icon: builtin:NAME</code>, a relative path, an <code>https:</code> URL, or <code>@alias</code> (defined under <code>icons.aliases</code>). Use <code>faces: [top, left, right]</code> or <code>all</code> to choose where it's drawn.</p>
    <p class="dim">Built-in glyphs: {glyphs.join(" · ")}</p>
  </section>

  <section>
    <h3>Keyboard</h3>
    <ul>
      <li><kbd>Ctrl</kbd>+<kbd>Space</kbd> autocomplete · hover a key for docs</li>
      <li><kbd>Ctrl</kbd>+<kbd>S</kbd> save · <kbd>Ctrl</kbd>+<kbd>O</kbd> open</li>
      <li>Preview: drag or wheel to pan · <kbd>Ctrl</kbd>+wheel or <kbd>+</kbd>/<kbd>−</kbd> to zoom · <kbd>0</kbd> fit</li>
    </ul>
  </section>
</aside>

<style>
  .help {
    height: 100%;
    overflow: auto;
    padding: 0 16px 16px;
    background: var(--panel);
    border-left: 1px solid var(--border);
    font-size: 13px;
    line-height: 1.5;
  }
  header {
    position: sticky;
    top: 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: var(--panel);
    padding: 12px 0 4px;
  }
  h2 {
    font-size: 14px;
    margin: 0;
  }
  h3 {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    margin: 18px 0 6px;
  }
  header button {
    border: none;
    background: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 14px;
  }
  pre,
  code,
  kbd {
    font-family: var(--mono);
    font-size: 12px;
  }
  pre {
    background: var(--editor-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 10px;
    margin: 0 0 8px;
  }
  code {
    background: var(--hover);
    padding: 1px 4px;
    border-radius: 4px;
  }
  kbd {
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: 4px;
    padding: 0 4px;
  }
  ul {
    margin: 0;
    padding-left: 18px;
  }
  .chips {
    list-style: none;
    padding: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px 12px;
  }
  .chips li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .swatch {
    width: 10px;
    height: 10px;
    border-radius: 3px;
    flex: none;
  }
  .dim {
    color: var(--muted);
    font-size: 12px;
    margin-left: auto;
  }
  p.dim {
    margin-left: 0;
  }
</style>
