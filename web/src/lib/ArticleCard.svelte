<script>
  import { API } from './api.js'
  import QuestionBlock from './QuestionBlock.svelte'
  import { untrack } from 'svelte'
  import { parseArrayField } from './parseData.js'
  import { formatDateTime, toLocalInputValue } from './time.js'

  let { article, onDeleted, onCitationSaved = () => {}, onUpdated = () => {} } = $props()


  let deleting = $state(false)
  let error = $state(null)

  // Publish date, revision stamp and snippet are optional at creation time, so
  // all three are editable here. Everything else about an article is fixed.
  let publishedAt = $state(untrack(() => article.published_at ?? null))
  let updatedAt = $state(untrack(() => article.updated_at ?? null))
  let snippet = $state(untrack(() => article.snippet ?? ''))
  let exclusive = $state(untrack(() => article.exclusive ?? false))

  let editingDate = $state(false)
  // Named for the date field, not the "Add update" run flow below.
  let editingUpdatedDate = $state(false)
  let editingSnippet = $state(false)
  let draftDate = $state('')
  let draftUpdatedDate = $state('')
  let draftSnippet = $state('')
  let savingField = $state(false)

  // Read-only here: the snapshot arrives with the scraper payload, and hand
  // editing it would defeat the point of it being a snapshot.
  const markdown = $derived(article.markdown ?? '')
  const captured = $derived(
    article.markdown_at ? formatDateTime(article.markdown_at) : null
  )

  const published = $derived(publishedAt ? formatDateTime(publishedAt) : null)
  const updated = $derived(updatedAt ? formatDateTime(updatedAt) : null)
  // A revision that predates publication is a typo somewhere, worth showing.
  const updatedBackwards = $derived(
    publishedAt && updatedAt ? new Date(updatedAt) < new Date(publishedAt) : false
  )

  async function patchArticle(body) {
    savingField = true
    error = null
    try {
      const res = await fetch(`${API}/api/articles/${article._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.error ?? `API returned ${res.status}`)
      }
      return true
    } catch (err) {
      error = err.message
      return false
    } finally {
      savingField = false
    }
  }

  async function saveDate() {
    const iso = draftDate ? new Date(draftDate).toISOString() : null
    if (await patchArticle({ published_at: iso })) {
      publishedAt = iso
      editingDate = false
    }
  }

  async function saveUpdatedDate() {
    const iso = draftUpdatedDate ? new Date(draftUpdatedDate).toISOString() : null
    if (await patchArticle({ updated_at: iso })) {
      updatedAt = iso
      editingUpdatedDate = false
    }
  }

  async function toggleExclusive(event) {
    // Held before the await: currentTarget is nulled once the handler returns,
    // and the checkbox has to be put back if the write fails.
    const input = event.currentTarget
    const next = input.checked

    if (await patchArticle({ exclusive: next })) {
      exclusive = next
    } else {
      input.checked = exclusive
    }
  }

  async function saveSnippet() {
    if (await patchArticle({ snippet: draftSnippet })) {
      snippet = draftSnippet.trim()
      editingSnippet = false
    }
  }

  const questionCount = $derived(article.questions?.length ?? 0)

  async function handleDelete() {
    const ok = confirm(
      `Delete this article and its ${questionCount} question(s)?\n\n${article.url}\n\nThis cannot be undone.`
    )
    if (!ok) return

    deleting = true
    error = null

    try {
      const res = await fetch(`${API}/api/articles/${article._id}`, {
        method: 'DELETE'
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `API returned ${res.status}`)
      }

      onDeleted()
    } catch (err) {
      error = err.message
      deleting = false
    }
  }

  let addingQuestions = $state(false)
  let questionsJson = $state('')
  let newQuestionPlatformJson = $state('')
  let savingQuestions = $state(false)

  let addingUpdate = $state(false)
  let platformJson = $state('')
  let savingUpdate = $state(false)
  let updateNote = $state(null)
  let copiedQuestions = $state(false)

  // Ground truth added after the fact: a story develops an angle worth asking
  // about, or the question set grows mid-experiment. Answers come later through
  // the normal update flow.
  async function submitQuestions(event) {
    event.preventDefault()
    savingQuestions = true
    error = null
    updateNote = null

    try {
      const questions = parseArrayField(questionsJson, 'Ground-truth Q&A')
      if (questions.length === 0) {
        throw new Error('Paste at least one question/answer pair')
      }

      const platform_answers = parseArrayField(
        newQuestionPlatformJson,
        'Platform answers'
      )

      const res = await fetch(`${API}/api/articles/${article._id}/questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions, platform_answers })
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `API returned ${res.status}`)

      const skipped = body.skipped?.length
        ? ` Skipped ${body.skipped.length}: ${body.skipped.map((sk) => sk.reason).join('; ')}.`
        : ''
      const answers = body.answers_recorded
        ? ` Recorded ${body.answers_recorded} answer(s) across ${body.questions_matched} question(s).`
        : ''
      const unmatched = body.questions_skipped?.length
        ? ` No match for ${body.questions_skipped.length} pasted answer(s).`
        : ''
      updateNote = `Added ${body.added} question(s).${skipped}${answers}${unmatched}`
      questionsJson = ''
      newQuestionPlatformJson = ''
      addingQuestions = false
      onUpdated()
    } catch (err) {
      error = err.message
    } finally {
      savingQuestions = false
    }
  }

  const activeQuestionList = $derived(
    JSON.stringify(
      (article.questions ?? [])
        .filter((q) => !q.flagged)
        .map((q) => q.question ?? ''),
      null,
      2
    )
  )

  async function copyQuestions() {
    try {
      await navigator.clipboard.writeText(activeQuestionList)
      copiedQuestions = true
      setTimeout(() => (copiedQuestions = false), 1500)
    } catch {
      error = 'Could not copy questions'
    }
  }

  async function submitUpdate(event) {
    event.preventDefault()
    savingUpdate = true
    error = null
    updateNote = null

    try {
      const platform_answers = parseArrayField(platformJson, 'Platform answers')
      if (platform_answers.length === 0) {
        throw new Error('Paste the platform JSON — at least one question entry')
      }

      const res = await fetch(`${API}/api/articles/${article._id}/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform_answers })
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `API returned ${res.status}`)

      const skipped = body.questions_skipped?.length
        ? ` Skipped ${body.questions_skipped.length} unmatched question(s).`
        : ''
      updateNote = `Recorded ${body.answers_recorded} answer(s) across ${body.questions_matched} question(s).${skipped}`
      platformJson = ''
      addingUpdate = false
      onUpdated()
    } catch (err) {
      error = err.message
    } finally {
      savingUpdate = false
    }
  }
</script>

<article class="card">
  <header>
    <div class="meta">
      <div class="title-row">
        <a href={article.url} target="_blank" rel="noreferrer">{article.url}</a>
        <label class="excl" title="Only one outlet has this story — no wire copy or aggregators for a platform to lean on">
          <input
            type="checkbox"
            checked={exclusive}
            onchange={toggleExclusive}
            disabled={savingField}
          />
          <span class="box" aria-hidden="true"></span>
          Exclusive story
        </label>
      </div>
      <p class="date">
        {#if editingDate}
          <span class="editor inline">
            <input type="datetime-local" bind:value={draftDate} />
            <button class="mini primary" onclick={saveDate} disabled={savingField}>Save</button>
            <button class="mini" onclick={() => (editingDate = false)}>Cancel</button>
            {#if publishedAt}
              <button
                class="mini"
                onclick={() => { draftDate = ''; saveDate() }}
                disabled={savingField}
                title="Remove the publish date — better than a guessed one"
              >Clear</button>
            {/if}
          </span>
        {:else}
          <button
            class="field"
            class:empty={!published}
            onclick={() => { draftDate = toLocalInputValue(publishedAt); editingDate = true }}
          >{published ? `Published ${published}` : 'add publish date'}</button>
        {/if}

        <span class="sep">&middot;</span>

        {#if editingUpdatedDate}
          <span class="editor inline">
            <input type="datetime-local" bind:value={draftUpdatedDate} />
            <button class="mini primary" onclick={saveUpdatedDate} disabled={savingField}>Save</button>
            <button class="mini" onclick={() => (editingUpdatedDate = false)}>Cancel</button>
            {#if updatedAt}
              <button
                class="mini"
                onclick={() => { draftUpdatedDate = ''; saveUpdatedDate() }}
                disabled={savingField}
              >Clear</button>
            {/if}
          </span>
        {:else}
          <button
            class="field"
            class:empty={!updated}
            class:warn={updatedBackwards}
            title={updatedBackwards ? 'This revision predates publication — check the dates' : null}
            onclick={() => {
              draftUpdatedDate = toLocalInputValue(updatedAt)
              editingUpdatedDate = true
            }}
          >{updated ? `Updated ${updated}` : 'add updated date'}</button>
        {/if}
      </p>

      {#if editingSnippet}
        <p class="snippet editor">
          <textarea bind:value={draftSnippet} rows="3"></textarea>
          <span class="row">
            <button class="mini primary" onclick={saveSnippet} disabled={savingField}>Save</button>
            <button class="mini" onclick={() => (editingSnippet = false)}>Cancel</button>
          </span>
        </p>
      {:else}
        <p class="snippet">
          <span class="snippet-label">snippet</span>
          <button
            class="field"
            class:empty={!snippet}
            onclick={() => { draftSnippet = snippet; editingSnippet = true }}
          >{snippet || 'add snippet'}</button>
        </p>
      {/if}

      {#if markdown}
        <details class="md">
          <summary>
            article markdown
            {#if captured}<span class="captured">captured {captured}</span>{/if}
          </summary>
          <pre>{markdown}</pre>
        </details>
      {/if}
    </div>

    <div class="actions">
      <button
        type="button"
        class="update"
        onclick={() => { addingQuestions = !addingQuestions; error = null }}
      >{addingQuestions ? 'Cancel questions' : 'Add questions'}</button>
      <button
        type="button"
        class="update"
        onclick={() => { addingUpdate = !addingUpdate; error = null }}
      >{addingUpdate ? 'Cancel update' : 'Add update'}</button>
      <button class="delete" onclick={handleDelete} disabled={deleting}>
        {deleting ? 'Deleting…' : 'Delete'}
      </button>
    </div>
  </header>

  {#if addingQuestions}
    <form class="update-form" onsubmit={submitQuestions}>
      <label>
        Ground-truth Q&amp;A to add
        <span class="hint">Pairs appended to this article's existing {questionCount} question(s), same shape as the add form. Questions already here are skipped, so re-pasting the full set only adds what's new.</span>
        <textarea
          class="code"
          bind:value={questionsJson}
          rows="6"
          required
          placeholder={'[{ "question": "…", "answer": "…" }]'}
        ></textarea>
      </label>
      <label>
        Platform answers for them
        <span class="hint">Optional — the scraper output for the questions above, in the same order. Leave empty to add the questions now and collect answers later with Add update.</span>
        <textarea
          class="code"
          bind:value={newQuestionPlatformJson}
          rows="8"
          placeholder="[]"
        ></textarea>
      </label>
      <button type="submit" disabled={savingQuestions}>
        {savingQuestions ? 'Saving…' : 'Add questions'}
      </button>
    </form>
  {/if}

  {#if addingUpdate}
    <form class="update-form" onsubmit={submitUpdate}>
      <div class="qlist">
        <div class="qlist-head">
          <span>Questions to re-ask</span>
          <button type="button" class="mini" onclick={copyQuestions}>
            {copiedQuestions ? 'Copied' : 'Copy'}
          </button>
        </div>
        <pre class="code">{activeQuestionList}</pre>
      </div>
      <label>
        Platform answers
        <span class="hint">Paste the new scraper JSON for this article. Questions flagged as bad are left out of the list above and take no part in matching — remaining questions are matched by text, then by position in that list.</span>
        <textarea class="code" bind:value={platformJson} rows="8" required placeholder="[]"></textarea>
      </label>
      <button type="submit" disabled={savingUpdate}>
        {savingUpdate ? 'Saving…' : 'Save update'}
      </button>
    </form>
  {/if}

  {#if updateNote}
    <p class="note">{updateNote}</p>
  {/if}

  {#if error}
    <p class="error">{error}</p>
  {/if}

  {#each article.questions ?? [] as q, i (`${q.question_id}:${q.runs?.length ?? 0}`)}
    <QuestionBlock
      {q}
      index={i}
      publishedAt={article.published_at}
      articleId={article._id}
      {onCitationSaved}
      onFlagged={onUpdated}
    />
  {/each}
</article>

<style>
  .card { background: var(--card); border: 1px solid var(--line); padding: 1.1rem 1.25rem; margin-bottom: 1.25rem; }

  /* Bleed the band to the card edges by cancelling the card's own padding, so
     the header reads as a title bar rather than an inset box. */
  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    margin: -1.1rem -1.25rem 0;
    padding: 0.8rem 1.25rem;
    background: #eef1f6;
    border-bottom: 1px solid #dfe4ec;
  }
  .meta { min-width: 0; }
  .meta a { font-size: 0.8rem; font-weight: 550; color: #2b3a52; word-break: break-all; }
  .date { color: #6b7791; font-size: 0.75rem; margin: 0.3rem 0 0; }
  .actions { display: flex; flex-shrink: 0; gap: 0.4rem; }
  .update { padding: 0.3rem 0.7rem; font: inherit; font-size: 0.75rem; color: var(--text); background: var(--card); border: 1px solid #dfe4ec; cursor: pointer; }
  .update:hover { border-color: var(--muted); }
  .delete { flex-shrink: 0; padding: 0.3rem 0.7rem; font: inherit; font-size: 0.75rem; color: var(--danger); background: var(--card); border: 1px solid #dfe4ec; cursor: pointer; }

  .update-form {
    margin: 0.9rem 0 0.4rem;
    padding: 0.85rem 0.9rem;
    background: #f7f8fb;
    border: 1px solid #dfe4ec;
  }
  .update-form label { display: block; font-size: 0.8rem; font-weight: 550; }
  .update-form .hint {
    display: block;
    font-weight: 400;
    font-size: 0.72rem;
    color: var(--muted);
    font-style: italic;
  }
  .qlist { margin-bottom: 0.9rem; }
  .qlist-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.35rem;
    font-size: 0.8rem;
    font-weight: 550;
  }
  .qlist pre.code,
  .update-form textarea.code {
    display: block;
    width: 100%;
    margin: 0.4rem 0 0.7rem;
    padding: 0.5rem 0.6rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.75rem;
    line-height: 1.5;
    white-space: pre;
    resize: vertical;
    border: 1px solid #dfe4ec;
  }
  .qlist pre.code {
    margin: 0;
    max-height: 14rem;
    overflow: auto;
    white-space: pre-wrap;
    background: var(--card);
  }
  .update-form button[type='submit'] {
    padding: 0.4rem 0.9rem;
    font: inherit;
    font-size: 0.8rem;
    font-weight: 550;
    color: #fff;
    background: var(--accent);
    border: 0;
    cursor: pointer;
  }
  .update-form button[type='submit']:disabled { opacity: 0.45; cursor: default; }
  .note { margin: 0.65rem 0 0; font-size: 0.78rem; color: #0a6b3d; }
  .delete:hover:not(:disabled) { background: var(--danger); border-color: transparent; color: #fff; }
  .delete:disabled { opacity: 0.5; cursor: default; }
  .snippet { margin: 0.55rem 0 0; font-size: 0.8rem; line-height: 1.55; color: #3d4a61; max-width: 90ch; }
  .field { padding: 0; font: inherit; color: inherit; background: none; border: 0; cursor: pointer; text-align: left; }
  .field:hover { text-decoration: underline; }
  .field.empty { font-style: italic; color: #8490a8; }
  .field.warn { color: var(--danger); }

  .editor { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 0.3rem; }
  /* Both dates share one line, so their editors open in place rather than
     pushing the other one down. */
  .editor.inline { display: inline-flex; align-items: center; vertical-align: middle; }
  .sep { margin: 0 0.15rem; color: #b3bccb; }
  .editor input, .editor textarea { padding: 0.2rem 0.35rem; font: inherit; font-size: 0.78rem; border: 1px solid #dfe4ec; }
  .editor textarea { width: 100%; max-width: 60ch; resize: vertical; }
  .editor .row { display: flex; gap: 0.3rem; }

  .mini { padding: 0.15rem 0.5rem; font: inherit; font-size: 0.72rem; color: var(--text); background: var(--card); border: 1px solid #dfe4ec; cursor: pointer; }
  .mini.primary { background: var(--accent); color: #fff; border-color: transparent; }
  .mini:disabled { opacity: 0.45; cursor: default; }

  .snippet-label { margin-right: 0.4rem; font-size: 0.72rem; font-style: italic; color: #8490a8; }

  /* The checkbox rides at the top of the URL line and never wraps into it, so
     a long URL breaking over three lines leaves it where the eye expects. */
  .title-row { display: flex; align-items: flex-start; gap: 0.75rem; }
  .title-row a { min-width: 0; }

  /* A pill rather than a bare checkbox: it sits in the header band next to the
     URL, where a naked control reads as debris. Off is a bare outline, on is
     filled — legible at a glance when scanning a column of cards. */
  .excl {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    flex-shrink: 0;
    padding: 0.22rem 0.6rem 0.22rem 0.45rem;
    font-size: 0.72rem;
    font-weight: 550;
    white-space: nowrap;
    color: var(--muted);
    /* Transparent when off so it sits on the header band instead of punching a
       white hole in it; the fill is what says "on". */
    background: transparent;
    border: 1px solid #dfe4ec;
    border-radius: 999px;
    cursor: pointer;
    user-select: none;
    transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
  }

  .excl:hover { color: var(--text); border-color: var(--muted); }

  /* The real input stays in the DOM for keyboard and screen readers; the pill
     is only its appearance. */
  .excl input {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: 0;
    opacity: 0;
    pointer-events: none;
  }

  .excl .box {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 0.8rem;
    height: 0.8rem;
    border: 1px solid currentColor;
    border-radius: 50%;
    font-size: 0.55rem;
    line-height: 1;
  }

  /* Driven by the checkbox itself, not by component state, so the pill flips
     the instant it is clicked instead of waiting out the save request — and
     flips back with it if the write fails. */
  .excl:has(input:checked) {
    color: #fff;
    background: var(--accent);
    border-color: transparent;
  }

  .excl:has(input:checked) .box::after { content: '✓'; }
  .excl:has(input:checked) .box { color: var(--accent); background: #fff; border-color: #fff; }
  .excl:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
  .excl:has(input:disabled) { opacity: 0.55; cursor: default; }

  /* Reference material, not something to scroll past on every card, so it
     stays folded until asked for. */
  .md { margin-top: 0.55rem; max-width: 90ch; }
  .md summary { font-size: 0.72rem; font-style: italic; color: #8490a8; cursor: pointer; }
  .md summary:hover { color: var(--text); }
  .md .captured { margin-left: 0.4rem; font-style: normal; }
  .md pre {
    margin: 0.5rem 0 0;
    padding: 0.6rem 0.7rem;
    max-height: 22rem;
    overflow: auto;
    white-space: pre-wrap;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.73rem;
    line-height: 1.6;
    border: 1px solid #dfe4ec;
  }
  .error { margin-top: 0.8rem; color: var(--danger); font-size: 0.85rem; }
</style>
