<script>
  import { untrack } from 'svelte'
  import { API } from './api.js'
  import {
    describeSourceAge,
    domainOf,
    formatSourceStamp,
    fromLocalParts,
    toLocalDateValue,
    toLocalTimeValue
  } from './time.js'

  let { citation, articlePublishedAt = null, onSaved = () => {} } = $props()

  // A publish date belongs to the URL, not to this one citation, so saving
  // writes to the shared `sources` record.
  let publishedAt = $state(untrack(() => citation.source_published_at ?? null))
  let precision = $state(untrack(() => citation.source_precision ?? null))

  let editing = $state(false)
  // Time is optional: many outlets stamp a story with a date and nothing more.
  let draftDate = $state('')
  let draftTime = $state('')
  let saving = $state(false)
  let error = $state(null)

  // Depends on the incoming props ONLY. Reading `editing` as a dependency would
  // re-run this the instant a save closes the editor — before the parent has
  // refetched — overwriting the date just saved with the stale prop and making
  // it flicker back for as long as the round trip takes.
  $effect(() => {
    const incoming = citation.source_published_at ?? null
    const incomingPrecision = citation.source_precision ?? null

    untrack(() => {
      if (editing) return
      publishedAt = incoming
      precision = incomingPrecision
    })
  })

  const domain = $derived(domainOf(citation.url) ?? 'source')
  const stamp = $derived(formatSourceStamp(publishedAt, precision))

  // How far the cited source sits from the story being asked about.
  const age = $derived(describeSourceAge(articlePublishedAt, publishedAt))
  // A date-only source carries a placeholder hour, so the gap is approximate.
  const ageLabel = $derived(
    age ? (precision === 'date' ? `~${age.label}` : age.label) : null
  )

  // Enter saves, Escape backs out. Neither input sits in a form, so there is no
  // implicit submission to lean on — and no navigation to preventDefault away.
  function handleKey(event) {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (!saving && draftDate) save()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      editing = false
      error = null
    }
  }

  // Clicking "set date" should land you in the field ready to type. Done as an
  // action rather than the autofocus attribute, which trips the a11y warning.
  function focusOnOpen(node) {
    node.focus()
  }

  function open() {
    draftDate = toLocalDateValue(publishedAt)
    draftTime = toLocalTimeValue(publishedAt, precision)
    editing = true
    error = null
  }

  // One writer for both saving and clearing: a null date is a legitimate value,
  // not the absence of a save. Guessing a date you don't have is worse for the
  // data than leaving the field empty, so taking one back has to be possible.
  async function persist(iso, prec) {
    if (!citation.url) {
      error = 'This citation has no URL — cannot save a date'
      return
    }

    saving = true
    error = null

    try {
      const res = await fetch(`${API}/api/sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          { url: citation.url, published_at: iso, precision: prec }
        ])
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `API returned ${res.status}`)
      }

      publishedAt = iso
      precision = prec
      editing = false
      onSaved()
    } catch (err) {
      error = err.message
    } finally {
      saving = false
    }
  }

  async function save() {
    if (!draftDate) return

    const parts = fromLocalParts(draftDate, draftTime)
    if (!parts) {
      error = 'That is not a valid date/time'
      return
    }

    await persist(parts.iso, parts.precision)
  }

  async function clearDate() {
    await persist(null, null)
  }
</script>

<tr>
  <td class="src">
    <a href={citation.url} target="_blank" rel="noreferrer" title={citation.label}>
      {domain}
    </a>

    {#if citation.trust}
      <!-- Only Perplexity reports this, and only ever as "Trusted" — but the
           label is rendered from the stored value rather than assumed, so a new
           one shows up as itself instead of silently reading as trusted. -->
      <span class="trust" title="{citation.trust} — the platform's own label for this source">
        <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
          <path
            d="M8 1.4 3.2 3.2v4.3c0 3 2 5.6 4.8 6.8 2.8-1.2 4.8-3.8 4.8-6.8V3.2L8 1.4Z"
            fill="currentColor"
            opacity="0.15"
          />
          <path
            d="M8 1.4 3.2 3.2v4.3c0 3 2 5.6 4.8 6.8 2.8-1.2 4.8-3.8 4.8-6.8V3.2L8 1.4Z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linejoin="round"
          />
          <path
            d="m5.9 7.9 1.5 1.6 2.8-3.2"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span class="sr">{citation.trust}</span>
      </span>
    {/if}
  </td>

  {#if editing}
    <td class="editing" colspan="2">
      <input type="date" bind:value={draftDate} onkeydown={handleKey} use:focusOnOpen />
      <input
        type="time"
        class:unset={!draftTime}
        bind:value={draftTime}
        onkeydown={handleKey}
        title="Optional — leave blank if the source shows no time"
      />
      {#if saving}<span class="keys">saving…</span>{/if}
      {#if publishedAt}
        <button
          type="button"
          class="clear"
          onclick={clearDate}
          disabled={saving}
          title="Remove this date — use it when the source's publish time is genuinely unknown"
        >Clear</button>
      {/if}
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

    <td class="age">
      {#if ageLabel}
        <span
          class:stale={age.stale}
          class:newer={!age.older}
          title={precision === 'date'
            ? `${age.exact} (approximate — this source has a date but no time)`
            : `${age.exact} than the article`}
        >{ageLabel}</span>
      {:else}
        <span class="unknown">—</span>
      {/if}
    </td>
  {/if}
</tr>

{#if error}
  <tr class="err-row"><td colspan="3">{error}</td></tr>
{/if}

<style>
  td {
    padding: 0.28rem 0.4rem 0.28rem 0;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
  }

  tr:last-child td { border-bottom: 0; }

  /* Flex so the badge keeps its place while the domain takes the slack and
     ellipsises — a long host must not push the shield out of the cell. */
  .src {
    display: flex;
    align-items: center;
    gap: 0.28rem;
    max-width: 11rem;
  }

  .src a {
    min-width: 0;
    color: var(--text);
    text-decoration: none;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .trust {
    display: inline-flex;
    flex-shrink: 0;
    color: #0a6b3d;
  }

  /* Visible to screen readers, not to the layout. */
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .src a:hover { text-decoration: underline; }

  .when { text-align: right; white-space: nowrap; }

  .age {
    text-align: right;
    white-space: nowrap;
    padding-right: 0;
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }

  /* Background material rather than coverage of the story. */
  .age .stale { color: var(--danger); }
  .age .newer { font-style: italic; }
  .age .unknown { opacity: 0.5; }

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

  .editing input + input { margin-left: 0.2rem; }

  /* An empty time is a legitimate answer here, so it reads as faded rather
     than as something the form is still waiting for. */
  .editing input.unset { opacity: 0.55; }

  .editing button {
    margin-left: 0.2rem;
    padding: 0.12rem 0.4rem;
    font: inherit;
    font-size: 0.68rem;
    border: 1px solid var(--line);
    background: var(--card);
    cursor: pointer;
  }

  .editing .clear:hover:not(:disabled) { color: var(--danger); border-color: currentColor; }
  .editing .clear:disabled { opacity: 0.45; cursor: default; }

  /* Only shown mid-request; Enter commits the edit without announcing itself. */
  .editing .keys {
    margin-left: 0.35rem;
    font-size: 0.66rem;
    color: var(--muted);
    font-style: italic;
  }

  .err-row td { color: var(--danger); font-size: 0.7rem; border-bottom: 0; }
</style>
