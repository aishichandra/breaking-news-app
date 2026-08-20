<script>
  import { API } from './api.js'
  import { parseArrayField, parseObjectField } from './parseData.js'
  import { toLocalInputValue } from './time.js'

  let { onCreated } = $props()


  let url = $state('')
  let publishedAt = $state('')
  let updatedAt = $state('')
  let snippet = $state('')
  let questionsJson = $state('')
  // A scraped capture — { date_time, snippet, markdown } — pasted whole. It
  // fills the fields below rather than bypassing them, so what it read stays
  // visible and correctable before saving.
  let captureJson = $state('')
  let captureNote = $state(null)
  let markdown = $state('')
  // Kept verbatim so an untouched capture saves to the second, which the
  // minute-granularity datetime-local input would otherwise round away.
  let capturedDateIso = $state(null)
  let platformJson = $state('')
  let saving = $state(false)
  let error = $state(null)

  // A datetime-local input yields a zone-less "YYYY-MM-DDTHH:mm", and the
  // server reading that with `new Date()` would resolve it in ITS timezone —
  // UTC on Railway — not the browser's. Convert here, where the offset is known.
  function localToIso(value) {
    if (!value) return null
    const when = new Date(value)
    return Number.isNaN(when.getTime()) ? null : when.toISOString()
  }

  // Runs on every keystroke in the capture box, so a failed parse stays quiet:
  // half-pasted JSON is not an error, it's a paste in progress. Submitting with
  // an unparseable capture is what actually complains.
  function applyCapture() {
    captureNote = null

    if (!captureJson.trim()) {
      markdown = ''
      return
    }

    let parsed
    try {
      parsed = parseObjectField(captureJson, 'Article capture')
    } catch {
      return
    }
    if (!parsed) return

    const filled = []

    if (parsed.date_time) {
      const local = toLocalInputValue(parsed.date_time)
      if (!local) {
        captureNote = `Couldn't read date_time: ${parsed.date_time}`
        return
      }
      publishedAt = local
      capturedDateIso = new Date(parsed.date_time).toISOString()
      filled.push('publish date')
    }

    if (typeof parsed.snippet === 'string') {
      snippet = parsed.snippet
      filled.push('snippet')
    }

    if (typeof parsed.markdown === 'string') {
      markdown = parsed.markdown
      filled.push(`markdown (${parsed.markdown.length.toLocaleString()} chars)`)
    }

    captureNote = filled.length
      ? `Filled ${filled.join(', ')}.`
      : 'No date_time, snippet or markdown in that object.'
  }

  async function handleSubmit(event) {
    event.preventDefault()
    saving = true
    error = null

    try {
      // Quiet while typing, loud on submit — otherwise a typo'd capture would
      // save an article missing everything the paste was meant to carry.
      if (captureJson.trim()) parseObjectField(captureJson, 'Article capture')

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

      // An untouched capture keeps its original precision; an edited field is
      // whatever the user typed.
      const untouched =
        capturedDateIso && publishedAt === toLocalInputValue(capturedDateIso)

      const res = await fetch(`${API}/api/articles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          published_at: untouched ? capturedDateIso : localToIso(publishedAt),
          updated_at: localToIso(updatedAt),
          snippet,
          markdown,
          questions,
          platform_answers
        })
      })

      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error ?? `API returned ${res.status}`)
      }

      url = ''
      publishedAt = ''
      updatedAt = ''
      snippet = ''
      captureJson = ''
      captureNote = null
      markdown = ''
      capturedDateIso = null
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
    Article capture
    <span class="hint">optional — paste the scraper's <code>{'{ date_time, snippet, markdown }'}</code> object and it fills the fields below.</span>
    <textarea
      class="code"
      bind:value={captureJson}
      oninput={applyCapture}
      rows="4"
      placeholder={'{ "date_time": "…", "snippet": "…", "markdown": "…" }'}
    ></textarea>
  </label>

  {#if captureNote}
    <p class="capture-note">{captureNote}</p>
  {/if}

  {#if markdown}
    <details class="md">
      <summary>markdown captured — {markdown.length.toLocaleString()} characters</summary>
      <pre>{markdown}</pre>
    </details>
  {/if}

  <label>
    Published <span class="hint">optional — you can add this later from Answers</span>
    <input type="datetime-local" bind:value={publishedAt} />
  </label>

  <label>
    Last updated <span class="hint">optional &mdash; the story's own &ldquo;Updated on&hellip;&rdquo; stamp, if it carries one</span>
    <input type="datetime-local" bind:value={updatedAt} />
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

  .capture-note {
    margin: -0.6rem 0 1rem;
    font-size: 0.75rem;
    color: #0a6b3d;
  }

  .md { margin: -0.6rem 0 1rem; font-size: 0.75rem; }
  .md summary { color: var(--muted); cursor: pointer; }
  .md summary:hover { color: var(--text); }
  .md pre {
    margin: 0.5rem 0 0;
    padding: 0.6rem 0.7rem;
    max-height: 18rem;
    overflow: auto;
    white-space: pre-wrap;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.72rem;
    line-height: 1.55;
    border: 1px solid var(--line);
  }

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
