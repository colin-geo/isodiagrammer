<script lang="ts">
import type { Diagnostic } from "@isodiagrammer/core";
import { lineCol } from "./text.ts";

interface Props {
  diagnostics: readonly Diagnostic[];
  text: string;
  onselect: (from: number, to: number) => void;
}
const { diagnostics, text, onselect }: Props = $props();
</script>

{#if diagnostics.length > 0}
  <ul class="diagnostics" aria-label="Problems">
    {#each diagnostics as d, i (i)}
      {@const pos = d.range ? lineCol(text, d.range.from) : undefined}
      <li class={d.severity}>
        <button type="button" disabled={!d.range} onclick={() => d.range && onselect(d.range.from, d.range.to)}>
          <span class="sev" aria-label={d.severity}>{d.severity === "error" ? "●" : "▲"}</span>
          <span class="msg">
            {d.message}
            {#if d.hint}<span class="hint">{d.hint}</span>{/if}
          </span>
          <span class="meta">{d.code}{#if pos}&nbsp;· {pos.line}:{pos.col}{/if}</span>
        </button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .diagnostics {
    list-style: none;
    margin: 0;
    padding: 4px 0;
    max-height: 30vh;
    overflow: auto;
    border-top: 1px solid var(--border);
    background: var(--panel);
    font-size: 12.5px;
  }
  button {
    display: grid;
    grid-template-columns: 16px 1fr auto;
    gap: 8px;
    width: 100%;
    padding: 5px 12px;
    border: none;
    background: none;
    color: var(--text);
    text-align: left;
    font: inherit;
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    background: var(--hover);
  }
  button:disabled {
    cursor: default;
  }
  .error .sev {
    color: var(--error);
  }
  .warning .sev {
    color: var(--warning);
  }
  .hint {
    display: block;
    color: var(--muted);
  }
  .meta {
    color: var(--muted);
    font-family: var(--mono);
    font-size: 11.5px;
    white-space: nowrap;
  }
</style>
