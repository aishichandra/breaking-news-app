<script>
  import { untrack } from 'svelte'
  import { API } from './api.js'
  import { domainOf, formatSourceStamp, toLocalInputValue } from './time.js'

  let { citation, onSaved = () => {} } = $props()

  // A publish date belongs to the URL, not to this one citation, so saving
  // writes to the shared `sources` record.
  let publishedAt = $state(untrack(() => citation.source_published_at ?? null))
  let precision = $state(untrack(() => citation.source_precision ?? null))

  let editing = $state(false)
  let draft = $state('')
  let saving = $state(false)
  let error = $state(null)

  $effect(() => {
    if (editing) return
    publishedAt = citation.source_published_at ?? null
    precision = citation.source_precision ?? null
  })

  const domain = $derived(domainOf(citation.url) ?? 'source')
  const stamp = $derived(formatSourceStamp(publishedAt, precision))

  function open() {
    draft = toLocalInputValue(publishedAt)
    editing = true
    error = null
  }

  async function save() {
    if (!citation.url) {
      error = 'This citation has no URL — cannot save a date'
      return
    }
    if (!draft) return

    const when = new Date(draft)
    if (Number.isNaN(when.getTime())) {
      error = 'That is not a valid date/time'
      return
    }

    saving = true
    error = null
    const iso = when.toISOString()

    try {
      const res = await fetch(`${API}/api/sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([{ url: citation.url, published_at: iso }])
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `API returned ${res.status}`)
      }

      publishedAt = iso
      precision = 'datetime'
      editing = false
      onSaved()
    } catch (err) {
      error = err.message
    } finally {
      saving = false
    }
  }
</script>

<tr>
  <td class="src">
    <a href={citation.url} target="_blank" rel="noreferrer" title={citation.label}>
      {domain}
    </a>
  </td>

  {#if editing}
    <td class="editing">
      <input type="datetime-local" bind:value={draft} />
      <button type="button" class="save" onclick={save} disabled={saving || !draft}>
        {saving ? '…' : 'Save'}
      </button>
      <button type="button" class="cancel" onclick={() => (editing = false)}>Cancel</button>
    </td>
  {:else}
    <td class="when">
      <button
        type="button"
        class="stamp"
        class:missing={!stamp}
        onclick={open}
        title="Click to set the publish date for this URL"
      >
        {#if stamp}
          {stamp}
        {:else}
          set date
        {/if}
      </button>
    </td>
  {/if}
</tr>

{#if error}
  <tr class="err-row"><td colspan="2">{error}</td></tr>
{/if}

<style>
  td {
    padding: 0.28rem 0.4rem 0.28rem 0;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
  }

  tr:last-child td { border-bottom: 0; }

  .src { max-width: 11rem; }

  .src a {
    display: block;
    color: var(--text);
    text-decoration: none;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .src a:hover { text-decoration: underline; }

  .when { text-align: right; white-space: nowrap; padding-right: 0; }

  .stamp {
    padding: 0;
    font: inherit;
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
    color: var(--text);
    background: none;
    border: 0;
    cursor: pointer;
    white-space: nowrap;
    text-align: right;
  }

  .stamp:hover { text-decoration: underline; }
  .stamp.missing { color: var(--danger); font-style: italic; }

  .editing { text-align: right; white-space: nowrap; padding-right: 0; }

  .editing input {
    padding: 0.1rem 0.25rem;
    font: inherit;
    font-size: 0.7rem;
    border: 1px solid var(--line);
    background: var(--card);
  }

  .editing button {
    margin-left: 0.2rem;
    padding: 0.12rem 0.4rem;
    font: inherit;
    font-size: 0.68rem;
    border: 1px solid var(--line);
    background: var(--card);
    cursor: pointer;
  }

  .editing .save { background: var(--accent); color: #fff; border-color: transparent; }
  .editing .save:disabled { opacity: 0.45; cursor: default; }

  .err-row td { color: var(--danger); font-size: 0.7rem; border-bottom: 0; }
</style>
