<script>
  import { untrack } from 'svelte'
  import { API } from './api.js'
  import CitationRow from './CitationRow.svelte'
  import { highlightSegments } from './highlight.js'
  import { describeLag } from './time.js'
  import { PLATFORM_LABELS as LABELS, VERDICTS } from './verdicts.js'

  let {
    name,
    result,
    publishedAt = null,
    articleId,
    questionIndex,
    onGraded = () => {},
    onCitationSaved = () => {},
    terms = null
  } = $props()

  const askedAt = $derived(result?.asked_at ?? null)
  const lag = $derived(
    publishedAt && askedAt ? describeLag(publishedAt, askedAt) : null
  )


  const segments = $derived(highlightSegments(result?.answer ?? '', terms))
  const isLong = $derived((result?.answer?.length ?? 0) > 420)
  const citations = $derived(result?.citations ?? [])

  let expanded = $state(false)
  let verdict = $state(untrack(() => result?.verdict ?? null))
  let note = $state(untrack(() => result?.note ?? ''))
  let savedNote = $state(untrack(() => result?.note ?? ''))
  let savingNote = $state(false)
  let saveError = $state(null)
  let commenting = $state(false)

  async function patchAnswer(body) {
    const res = await fetch(`${API}/api/answers/${result._id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detail.error ?? `API returned ${res.status}`)
    }
  }

  async function setVerdict(next) {
    const previous = verdict
    verdict = verdict === next ? null : next
    saveError = null

    try {
      await patchAnswer({ verdict })
      onGraded(name, verdict)
    } catch (err) {
      verdict = previous
      saveError = err.message
      onGraded(name, previous)
    }
  }

  async function saveNote() {
    savingNote = true
    saveError = null
    try {
      await patchAnswer({ note })
      savedNote = note.trim()
      note = savedNote
      commenting = false
    } catch (err) {
      saveError = err.message
    } finally {
      savingNote = false
    }
  }

  function startComment() {
    commenting = true
  }

  function cancelComment() {
    note = savedNote
    commenting = false
    saveError = null
  }
</script>

<div class="platform" data-verdict={verdict}>
  <div class="head">
    <span class="name">{LABELS[name] ?? name}</span>
    {#if result?.url}
      <a class="session" href={result.url} target="_blank" rel="noreferrer">↗</a>
    {/if}
  </div>

  {#if result}
    {#if saveError}<p class="save-error">{saveError}</p>{/if}

    {#if lag}
      <p class="when">
        <span class="lag" class:warn={lag.negative}>{lag.text}</span>
      </p>
    {/if}

    <p class="answer" class:clamped={isLong && !expanded}>
      {#each segments as seg}{#if seg.kind}<mark class={seg.kind}>{seg.text}</mark>{:else}{seg.text}{/if}{/each}
    </p>

    {#if isLong}
      <button class="link" onclick={() => (expanded = !expanded)}>
        {expanded ? 'Show less' : 'Show more'}
      </button>
    {/if}

    <div class="cites">
      {#if citations.length > 0}
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Citation</th><th>Published</th><th class="vs">v article</th></tr>
            </thead>
            <tbody>
              {#each citations as c, i (`${c.url ?? ''}#${i}`)}
                <CitationRow
                  citation={c}
                  articlePublishedAt={publishedAt}
                  onSaved={onCitationSaved}
                />
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <span class="none">No citations</span>
      {/if}
    </div>
    <div class="grade">
      {#each VERDICTS as v}
        <button
          class="verdict {v.value}"
          class:on={verdict === v.value}
          data-tip={v.title}
          onclick={() => setVerdict(v.value)}
        >{v.symbol}</button>
      {/each}

      {#if verdict}
        <span class="verdict-name">{verdict}</span>
      {/if}
    </div>

    {#if commenting}
      <div class="comment">
        <textarea
          bind:value={note}
          rows="2"
          placeholder="Comment on this verdict…"
        ></textarea>
        <div class="comment-actions">
          {#if note.trim() !== (savedNote ?? '').trim()}
            <button type="button" class="save-note" onclick={saveNote} disabled={savingNote}>
              {savingNote ? 'Saving…' : 'Save comment'}
            </button>
          {/if}
          <button type="button" class="link" onclick={cancelComment}>Cancel</button>
        </div>
      </div>
    {:else if savedNote}
      <p class="comment-text">{savedNote}</p>
      <button type="button" class="link comment-toggle" onclick={startComment}>edit comment</button>
    {:else}
      <button type="button" class="link comment-toggle" onclick={startComment}>add comment</button>
    {/if}

  {:else}
    <p class="none">No answer recorded</p>
  {/if}
</div>

<style>
  .platform {
    display: flex;
    flex-direction: column;
    padding: 0.85rem 0.9rem;
    background: var(--card);
    border: 1px solid var(--line);
  }

  .platform[data-verdict='correct']     { background: #f7fbf8; }
  .platform[data-verdict='incorrect']   { background: #fdf7f7; }
  .platform[data-verdict='partial']     { background: #fffdf5; }
  .platform[data-verdict='abstained']   { background: #fafafa; }
  .platform[data-verdict='speculation'] { background: #faf8fd; }

  .head { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; }

  .name {
    font-size: 0.68rem;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }

  .session { font-size: 0.75rem; color: var(--muted); text-decoration: none; }

  .when {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.35rem 0.55rem;
    margin: 0 0 0.45rem;
    font-size: 0.7rem;
    font-variant-numeric: tabular-nums;
  }


  .grade { display: flex; align-items: center; gap: 0.2rem; margin-top: 0.75rem; padding-top: 0.7rem; border-top: 1px solid var(--line); }
  .verdict-name { margin-left: 0.35rem; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }

  .comment { margin-top: 0.45rem; }
  .comment textarea {
    display: block;
    width: 100%;
    padding: 0.4rem 0.45rem;
    font: inherit;
    font-size: 0.72rem;
    line-height: 1.4;
    color: var(--text);
    background: var(--card);
    border: 1px solid var(--line);
    resize: vertical;
  }
  .comment-actions {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    margin-top: 0.3rem;
  }
  .comment-text {
    margin: 0.4rem 0 0;
    font-size: 0.72rem;
    line-height: 1.4;
    color: var(--muted);
    white-space: pre-wrap;
  }
  .comment-toggle { margin-top: 0.35rem; }
  .save-note {
    padding: 0.2rem 0.5rem;
    font: inherit;
    font-size: 0.68rem;
    color: #fff;
    background: var(--accent);
    border: 0;
    cursor: pointer;
  }
  .save-note:disabled { opacity: 0.45; cursor: default; }

  .verdict {
    width: 1.6rem;
    height: 1.5rem;
    font: inherit;
    font-size: 0.8rem;
    line-height: 1;
    color: var(--muted);
    background: var(--card);
    border: 1px solid var(--line);
    cursor: pointer;
  }

  .verdict:hover { color: var(--text); border-color: var(--muted); }
  .verdict.correct.on     { background: #1a7f45; border-color: transparent; color: #fff; }
  .verdict.partial.on     { background: #b8860b; border-color: transparent; color: #fff; }
  .verdict.incorrect.on   { background: #b00020; border-color: transparent; color: #fff; }
  .verdict.abstained.on   { background: #55555f; border-color: transparent; color: #fff; }
  .verdict.speculation.on { background: #6b4fa8; border-color: transparent; color: #fff; }

  .lag {
    color: var(--muted);
  }
  .lag.warn { color: var(--danger); }

  .answer { margin: 0; font-size: 0.82rem; line-height: 1.6; white-space: pre-wrap; overflow-wrap: break-word; }
  .clamped { display: -webkit-box; -webkit-line-clamp: 9; line-clamp: 9; -webkit-box-orient: vertical; overflow: hidden; }

  mark { background: none; color: inherit; padding: 0; }
  mark.number { background: #ffe89a; font-weight: 650; }
  mark.word { box-shadow: inset 0 -0.35em 0 #eef1f6; }

  .link {
    align-self: flex-start;
    margin-top: 0.4rem;
    padding: 0;
    font: inherit;
    font-size: 0.72rem;
    color: var(--muted);
    background: none;
    border: 0;
    cursor: pointer;
  }
  .link:hover { color: var(--text); text-decoration: underline; }

  .cites { margin-top: auto; padding-top: 0.6rem; }
  .cites:empty { padding-top: 0; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 0.7rem; }

  th {
    padding: 0 0.4rem 0.2rem 0;
    font-size: 0.6rem;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    text-align: left;
    white-space: nowrap;
    border-bottom: 1px solid var(--line);
  }
  /* Citation stays left; the two numeric columns line up on the right. */
  th + th { text-align: right; }
  th:last-child { padding-right: 0; }

  /* Instant tooltip. The native `title` attribute waits about a second before
     showing, which is useless for a row of symbol buttons you're scanning. */
  [data-tip] { position: relative; }

  [data-tip]::after {
    content: attr(data-tip);
    position: absolute;
    bottom: calc(100% + 5px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 20;
    padding: 0.25rem 0.45rem;
    font-size: 0.68rem;
    font-weight: 400;
    letter-spacing: 0;
    text-transform: none;
    white-space: nowrap;
    color: #fff;
    background: #1a1a1e;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.1s ease-out;
  }

  [data-tip]:hover::after { opacity: 1; }

  .none { font-size: 0.72rem; color: var(--muted); font-style: italic; }
  .save-error { margin: 0 0 0.4rem; font-size: 0.7rem; color: var(--danger); }
</style>
