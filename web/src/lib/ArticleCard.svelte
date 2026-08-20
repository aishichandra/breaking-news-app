<script>
  import { API } from './api.js'
  import QuestionBlock from './QuestionBlock.svelte'
  import { untrack } from 'svelte'
  import { parseArrayField } from './parseData.js'
  import { formatDateTime, toLocalInputValue } from './time.js'

  let { article, onDeleted, onCitationSaved = () => {}, onUpdated = () => {} } = $props()


  let deleting = $state(false)
  let error = $state(null)

  // Publish date and snippet are optional at creation time, so both are
  // editable here. Everything else about an article is fixed.
  let publishedAt = $state(untrack(() => article.published_at ?? null))
  let snippet = $state(untrack(() => article.snippet ?? ''))

  let editingDate = $state(false)
  let editingSnippet = $state(false)
  let draftDate = $state('')
  let draftSnippet = $state('')
  let savingField = $state(false)

  const published = $derived(publishedAt ? formatDateTime(publishedAt) : null)

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

  let addingUpdate = $state(false)
  let platformJson = $state('')
  let savingUpdate = $state(false)
  let updateNote = $state(null)
  let copiedQuestions = $state(false)

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
      <a href={article.url} target="_blank" rel="noreferrer">{article.url}</a>
      {#if editingDate}
        <p class="date editor">
          <input type="datetime-local" bind:value={draftDate} />
          <button class="mini primary" onclick={saveDate} disabled={savingField}>Save</button>
          <button class="mini" onclick={() => (editingDate = false)}>Cancel</button>
        </p>
      {:else}
        <p class="date">
          <button
            class="field"
            class:empty={!published}
            onclick={() => { draftDate = toLocalInputValue(publishedAt); editingDate = true }}
          >{published ? `Published ${published}` : 'add publish date'}</button>
          &middot; {questionCount} question(s)
        </p>
      {/if}

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
    </div>

    <div class="actions">
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
        <span class="hint">Paste the new scraper JSON for this article. Flagged questions are omitted above. Remaining questions are matched by text (then index).</span>
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

  .editor { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 0.3rem; }
  .editor input, .editor textarea { padding: 0.2rem 0.35rem; font: inherit; font-size: 0.78rem; border: 1px solid #dfe4ec; }
  .editor textarea { width: 100%; max-width: 60ch; resize: vertical; }
  .editor .row { display: flex; gap: 0.3rem; }

  .mini { padding: 0.15rem 0.5rem; font: inherit; font-size: 0.72rem; color: var(--text); background: var(--card); border: 1px solid #dfe4ec; cursor: pointer; }
  .mini.primary { background: var(--accent); color: #fff; border-color: transparent; }
  .mini:disabled { opacity: 0.45; cursor: default; }

  .snippet-label { margin-right: 0.4rem; font-size: 0.72rem; font-style: italic; color: #8490a8; }
  .error { margin-top: 0.8rem; color: var(--danger); font-size: 0.85rem; }
</style>
