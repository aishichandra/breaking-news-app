<script>
  import { onMount } from 'svelte'
  import { API } from './api.js'
  import { nextReask } from './time.js'

  let { articleId, publishedAt = null, runs = [], queued = null, onChange = () => {} } = $props()

  // Ticks the countdown without needing fresh data from the server — the
  // schedule is computable purely from publishedAt + the last milestone
  // reached, so there's nothing to refetch, just the clock to re-check.
  let now = $state(Date.now())
  onMount(() => {
    const id = setInterval(() => (now = Date.now()), 30000)
    return () => clearInterval(id)
  })

  const status = $derived(publishedAt ? nextReask(publishedAt, runs, now) : null)

  // Re-asks are manual: the pipeline only alerts when a mark comes due, and
  // the run happens when it's asked for here. A queued request waits its turn
  // for the answer worker, so it can be cancelled until the worker starts it.
  let busy = $state(false)
  let error = $state(null)

  async function send(method) {
    busy = true
    error = null
    try {
      const res = await fetch(`${API}/api/articles/${articleId}/reask`, { method })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.error ?? `API returned ${res.status}`)
      }
      onChange()
    } catch (err) {
      error = err.message
    } finally {
      busy = false
    }
  }
</script>

<span class="row">
{#if status && !status.done}
  <span class="reask" class:due={status.overdue} title="Next re-ask mark: {status.label} after publication ({new Date(status.dueAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}). A re-ask only runs when you queue one.">
    <span class="dot" aria-hidden="true"></span>
    {status.label} mark {status.overdue ? 'due' : status.countdown}
  </span>
{:else if status?.done}
  <span class="reask done" title="Every mark (30m/1h/5h/1d after publication) has been re-asked">
    all marks re-asked
  </span>
{/if}

{#if queued}
  <span class="queued" title="Waiting for the answer worker, which runs one story at a time">
    re-ask queued{queued.position > 1 ? ` (#${queued.position} in line)` : ''}
  </span>
  <button class="mini" onclick={() => send('DELETE')} disabled={busy}>Cancel</button>
{:else}
  <button class="mini" onclick={() => send('POST')} disabled={busy} title="Put this story's questions to all four platforms again">Re-ask now</button>
{/if}

{#if error}
  <span class="error">{error}</span>
{/if}
</span>

<style>
  .row {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.2rem 0.6rem;
    vertical-align: middle;
  }

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

  /* Due now reads as "waiting on you", not a problem — a warm amber
     rather than the danger red used for actual data issues elsewhere. */
  .reask.due { color: #9a6b00; }
  .reask.due .dot { background: #d9a400; }

  .reask.done { font-style: italic; }

  .queued {
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
  }

  .mini {
    padding: 0.15rem 0.5rem;
    font: inherit;
    font-size: 0.72rem;
    color: var(--text);
    background: var(--card);
    border: 1px solid #dfe4ec;
    cursor: pointer;
  }
  .mini:disabled { opacity: 0.45; cursor: default; }

  .error { font-size: 0.72rem; color: var(--danger); }
</style>
