<script>
  import { API } from './api.js'
  import { parseArrayField } from './parseData.js'

  let { onCreated } = $props()


  let url = $state('')
  let publishedAt = $state('')
  let snippet = $state('')
  let questionsJson = $state('')
  let platformJson = $state('')
  let saving = $state(false)
  let error = $state(null)

  async function handleSubmit(event) {
    event.preventDefault()
    saving = true
    error = null

    try {
      const questions = parseArrayField(questionsJson, 'Ground-truth Q&A')
      const platform_answers = parseArrayField(platformJson, 'Platform answers')

      // Required because they're what the app is for. Publish date and snippet
      // are annotations you can add later from the Answers view.
      if (questions.length === 0) {
        throw new Error('Ground-truth Q&A is required — at least one question/answer pair')
      }
      if (platform_answers.length === 0) {
        throw new Error('Platform answers are required — at least one entry')
      }

      const res = await fetch(`${API}/api/articles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, published_at: publishedAt, snippet, questions, platform_answers })
      })

      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error ?? `API returned ${res.status}`)
      }

      url = ''
      publishedAt = ''
      snippet = ''
      questionsJson = ''
      platformJson = ''
      onCreated()
    } catch (err) {
      error = err.message
    } finally {
      saving = false
    }
  }
</script>

<form onsubmit={handleSubmit}>
  <h2>Add an article</h2>

  <label>
    Article URL
    <input type="url" bind:value={url} required placeholder="https://..." />
  </label>

  <label>
    Published <span class="hint">optional — you can add this later from Answers</span>
    <input type="datetime-local" bind:value={publishedAt} />
  </label>

  <label>
    Article snippet / description
    <span class="hint">optional — you can add this later from Answers. The blurb a platform might have seen without opening the article.</span>
    <textarea bind:value={snippet} rows="3" placeholder="Paste the article's description or search snippet…"></textarea>
  </label>

  <label>
    Ground-truth Q&amp;A
    <span class="hint">A list of question/answer pairs. Paste JSON, or copy straight out of Python &mdash; both work.</span>
    <textarea class="code" bind:value={questionsJson} rows="5" required placeholder="[]"></textarea>
  </label>

  <label>
    Platform answers
    <span class="hint">Your scraper's output, unchanged. Paste JSON, or copy straight out of Python &mdash; both work.</span>
    <textarea class="code" bind:value={platformJson} rows="10" required placeholder="[]"></textarea>
  </label>

  <button type="submit" disabled={saving}>
    {saving ? 'Saving…' : 'Save article'}
  </button>

  {#if error}
    <p class="error">{error}</p>
  {/if}
</form>

<style>
  form {
    background: var(--card);
    border: 1px solid var(--line);
    padding: 1.4rem 1.5rem;
    max-width: 760px;
  }

  h2 {
    font-size: 1rem;
    font-weight: 600;
    margin: 0 0 1.2rem;
  }

  label {
    display: block;
    font-size: 0.8rem;
    font-weight: 550;
    color: var(--text);
    margin-bottom: 1rem;
  }

  .hint {
    display: block;
    font-weight: 400;
    font-size: 0.72rem;
    color: var(--muted);
    font-style: italic;
  }


  input, textarea {
    display: block;
    width: 100%;
    margin-top: 0.35rem;
    padding: 0.5rem 0.6rem;
    font: inherit;
    font-size: 0.875rem;
    font-weight: 400;
    color: var(--text);
    background: var(--card);
    border: 1px solid var(--line);
  }

  input:focus, textarea:focus {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
    border-color: transparent;
  }

  textarea.code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.75rem;
    line-height: 1.5;
    white-space: pre;
    resize: vertical;
  }

  button {
    padding: 0.55rem 1.2rem;
    font: inherit;
    font-size: 0.875rem;
    font-weight: 550;
    color: #fff;
    background: var(--accent);
    border: 0;
    cursor: pointer;
  }

  button:disabled { opacity: 0.45; cursor: default; }

  .error {
    margin: 0.9rem 0 0;
    padding: 0.6rem 0.75rem;
    font-size: 0.8rem;
    color: var(--danger);
    background: #fdf0f2;
    border: 1px solid var(--line);
    overflow-wrap: break-word;
  }
</style>
