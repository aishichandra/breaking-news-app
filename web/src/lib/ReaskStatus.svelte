<script>
  import { onMount } from 'svelte'
  import { nextReask } from './time.js'

  let { publishedAt = null, runs = [] } = $props()

  // Ticks the countdown without needing fresh data from the server — the
  // schedule is computable purely from publishedAt + the last milestone
  // reached, so there's nothing to refetch, just the clock to re-check.
  let now = $state(Date.now())
  onMount(() => {
    const id = setInterval(() => (now = Date.now()), 30000)
    return () => clearInterval(id)
  })

  const status = $derived(nextReask(publishedAt, runs, now))
</script>

{#if status && !status.done}
  <span class="reask" class:due={status.overdue} title="Next scheduled re-ask: {status.label} after publication ({new Date(status.dueAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })})">
    <span class="dot" aria-hidden="true"></span>
    re-asks {status.label} mark {status.countdown}
  </span>
{:else if status?.done}
  <span class="reask done" title="Every scheduled re-ask (30m/1h/5h/1d after publication) has run">
    re-ask schedule complete
  </span>
{/if}

<style>
  .reask {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.72rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .dot {
    width: 0.4rem;
    height: 0.4rem;
    border-radius: 50%;
    background: var(--muted);
  }

  /* Due now reads as "waiting on the worker", not a problem — a warm amber
     rather than the danger red used for actual data issues elsewhere. */
  .reask.due { color: #9a6b00; }
  .reask.due .dot { background: #d9a400; }

  .reask.done { font-style: italic; }
</style>
