<script>
  import { API } from './api.js'
  import { answerLabel, PLATFORM_NAMES } from './verdicts.js'
  import { formatDateTime, domainOf } from './time.js'

  let imports = $state([])
  let loaded = $state(false)
  let loadError = $state(null)
  let uploading = $state(false)
  let uploadError = $state(null)
  let deletingId = $state(null)

  async function refresh() {
    try {
      const res = await fetch(`${API}/api/archive`)
      if (!res.ok) throw new Error(`API returned ${res.status}`)
      imports = await res.json()
      loadError = null
    } catch (err) {
      loadError = err
    } finally {
      loaded = true
    }
  }
  refresh()

  // Parsed client-side first -- a malformed file gives an immediate, specific
  // error instead of a vague 400 from the server round trip.
  async function handleFile(event) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return

    uploading = true
    uploadError = null
    try {
      const text = await file.text()
      let parsed
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new Error(`${file.name} is not valid JSON`)
      }
      const res = await fetch(`${API}/api/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, ...parsed })
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.error ?? `API returned ${res.status}`)
      }
      await refresh()
    } catch (err) {
      uploadError = err.message
    } finally {
      uploading = false
    }
  }

  async function removeImport(id) {
    deletingId = id
    try {
      const res = await fetch(`${API}/api/archive/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.error ?? `API returned ${res.status}`)
      }
      imports = imports.filter((i) => i.import.id !== id)
    } catch (err) {
      loadError = err
    } finally {
      deletingId = null
    }
  }

  const totalArticles = $derived(imports.reduce((n, i) => n + i.import.article_count, 0))
</script>

<section class="archive">
  <h2>Archive</h2>
  <p class="hint">
    Read-only past exports — questions and answers no longer in the live dataset, uploaded here for
    reference. Nothing here is gradeable or editable.
  </p>

  <label class="upload">
    <input type="file" accept="application/json" onchange={handleFile} disabled={uploading} />
    {uploading ? 'Uploading…' : 'Upload an export (.json)'}
  </label>
  {#if uploadError}<p class="error">{uploadError}</p>{/if}

  {#if !loaded}
    <p class="status">Loading…</p>
  {:else if loadError}
    <p class="error">Couldn't load the archive: {loadError.message}</p>
  {:else if imports.length === 0}
    <p class="status">No archived exports yet.</p>
  {:else}
    <p class="status">{imports.length} import{imports.length === 1 ? '' : 's'} · {totalArticles} article{totalArticles === 1 ? '' : 's'}</p>

    {#each imports as entry (entry.import.id)}
      <details class="import-block">
        <summary>
          {entry.import.filename} — {entry.import.article_count} article{entry.import.article_count === 1 ? '' : 's'},
          uploaded {formatDateTime(entry.import.uploaded_at)}
          <button type="button" class="remove" disabled={deletingId === entry.import.id}
            onclick={(e) => { e.preventDefault(); removeImport(entry.import.id) }}>
            {deletingId === entry.import.id ? 'Removing…' : 'Remove import'}
          </button>
        </summary>

        {#each entry.articles as article (article.url)}
          <article class="archived-article">
            <h3><a href={article.url} target="_blank" rel="noreferrer">{article.headline ?? domainOf(article.url)}</a></h3>
            {#if article.published_at}<p class="published">{formatDateTime(article.published_at)}</p>{/if}
            {#if article.snippet}<p class="snippet">{article.snippet}</p>{/if}

            {#each article.questions as question (question.question_id ?? question.question)}
              <div class="question">
                <p class="q">{question.question}</p>
                {#if question.answer}<p class="ground-truth">Ground truth: {question.answer}</p>{/if}

                {#each PLATFORM_NAMES.filter((n) => question.platforms?.[n]) as name (name)}
                  {@const answer = question.platforms[name]}
                  <div class="platform-answer">
                    <span class="platform-name">{answerLabel(name, answer)}</span>
                    <p class="answer-text">{answer.answer ?? answer.response ?? 'No answer text captured'}</p>
                    {#if answer.citations?.length}
                      <ul class="citations">
                        {#each answer.citations as c}
                          <li><a href={c.url} target="_blank" rel="noreferrer">{c.label || domainOf(c.url)}</a></li>
                        {/each}
                      </ul>
                    {/if}
                  </div>
                {/each}
              </div>
            {/each}
          </article>
        {/each}
      </details>
    {/each}
  {/if}
</section>

<style>
  .archive { max-width: 900px; }
  h2 { font-size: 1rem; margin: 0 0 0.4rem; }
  .hint { font-size: 0.8rem; color: var(--muted); line-height: 1.5; margin-bottom: 1rem; }
  .status { font-size: 0.8rem; color: var(--muted); }
  .error { font-size: 0.8rem; color: var(--danger); }

  .upload {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.9rem;
    margin-bottom: 1rem;
    font-size: 0.85rem;
    background: var(--accent);
    color: #fff;
    border-radius: 4px;
    cursor: pointer;
  }
  .upload input { display: none; }

  .import-block {
    margin: 0.9rem 0;
    padding: 0.7rem 0.9rem;
    border: 1px solid var(--line);
    border-radius: 6px;
  }
  .import-block summary {
    cursor: pointer;
    font-size: 0.85rem;
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
  }
  .remove {
    margin-left: auto;
    font: inherit;
    font-size: 0.72rem;
    color: var(--muted);
    background: none;
    border: 1px solid var(--line);
    padding: 0.15rem 0.5rem;
    cursor: pointer;
  }
  .remove:hover { color: var(--danger); border-color: var(--danger); }

  .archived-article { margin: 1rem 0 0; padding-top: 0.8rem; border-top: 1px solid var(--line); }
  .archived-article h3 { font-size: 0.9rem; margin: 0 0 0.2rem; }
  .archived-article h3 a { color: var(--text); }
  .published { font-size: 0.7rem; color: var(--muted); margin: 0 0 0.4rem; }
  .snippet { font-size: 0.8rem; color: var(--muted); margin: 0 0 0.6rem; }

  .question { margin: 0.7rem 0; padding: 0.6rem 0.7rem; background: var(--card); border-radius: 4px; }
  .q { font-weight: 600; font-size: 0.85rem; margin: 0 0 0.3rem; }
  .ground-truth { font-size: 0.78rem; color: var(--muted); margin: 0 0 0.5rem; }

  .platform-answer { margin: 0.5rem 0 0; padding-top: 0.5rem; border-top: 1px dashed var(--line); }
  .platform-name { font-size: 0.68rem; font-weight: 650; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
  .answer-text { font-size: 0.82rem; line-height: 1.5; white-space: pre-wrap; margin: 0.25rem 0; }
  .citations { margin: 0.2rem 0 0; padding: 0; list-style: none; font-size: 0.72rem; }
  .citations li { display: inline; margin-right: 0.7rem; }
</style>
