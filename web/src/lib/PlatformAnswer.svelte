<script>
  import { untrack } from 'svelte'
  import { API } from './api.js'
  import CitationRow from './CitationRow.svelte'
  import { highlightSegments } from './highlight.js'
  import { parsePastedAnswer } from './parseCitations.js'
  import { describeLag, domainOf, formatDateTime } from './time.js'
  import { PLATFORM_LABELS as LABELS, GROUP_OF, VERDICTS } from './verdicts.js'

  let {
    name,
    result,
    publishedAt = null,
    articleId,
    questionIndex,
    runId = null,
    onGraded = () => {},
    onCitationSaved = () => {},
    onAnswerAdded = () => {},
    terms = null
  } = $props()

  const group = $derived(GROUP_OF[name] ?? 'interface')

  // A platform with no recorded answer has no `result` at all -- once one is
  // added by hand (below), it's held here rather than waiting on the parent
  // to refetch, the same reasoning as `answerText` below.
  let addedResult = $state(null)
  const effectiveResult = $derived(result ?? addedResult)

  const askedAt = $derived(effectiveResult?.asked_at ?? null)
  const lag = $derived(
    publishedAt && askedAt ? describeLag(publishedAt, askedAt) : null
  )


  // Citations parsed from a pasted answer for a record that had none (see
  // saveAnswer) -- held here like addedResult, until the parent's own refetch
  // brings the saved set back, at which point that one wins.
  let addedCitations = $state(null)
  const citations = $derived(
    effectiveResult?.citations?.length ? effectiveResult.citations : (addedCitations ?? [])
  )
  // Google only -- a screenshot of the AI Overview page at the moment it was
  // captured (or the failure happened), evidence for verifying the
  // extraction or diagnosing a miss without reproducing the search live.
  const screenshotUrl = $derived(
    effectiveResult?.screenshot_id ? `${API}/api/screenshots/${effectiveResult.screenshot_id}` : null
  )

  // The answer text is held locally rather than read straight off the prop,
  // because a correction has to stay on screen after it is saved — the parent
  // only refetches on its own schedule.
  let answerText = $state(untrack(() => effectiveResult?.answer ?? ''))
  let originalAnswer = $state(untrack(() => effectiveResult?.answer_original ?? null))
  let editedAt = $state(untrack(() => effectiveResult?.answer_edited_at ?? null))
  let manuallyAdded = $state(untrack(() => Boolean(effectiveResult?.manual)))

  const segments = $derived(highlightSegments(answerText, terms))
  const isLong = $derived(answerText.length > 420)

  let expanded = $state(false)
  let verdict = $state(untrack(() => effectiveResult?.verdict ?? null))
  let note = $state(untrack(() => effectiveResult?.note ?? ''))
  let savedNote = $state(untrack(() => effectiveResult?.note ?? ''))
  let savingNote = $state(false)
  let saveError = $state(null)
  let commenting = $state(false)

  let editingAnswer = $state(false)
  let draftAnswer = $state('')
  let savingAnswer = $state(false)

  let addingAnswer = $state(false)
  let newAnswerDraft = $state('')
  let savingNewAnswer = $state(false)
  let addError = $state(null)

  // The links found in whatever is pasted, offered as citations. Each can be
  // dropped before saving -- a bare URL in the middle of prose isn't always a
  // source. Kept as a list, not a Set, so the derived values below re-run.
  let droppedUrls = $state([])
  const withoutDropped = (list) => list.filter((c) => !droppedUrls.includes(c.url))

  const addParsed = $derived(parsePastedAnswer(newAnswerDraft))
  const addCitations = $derived(withoutDropped(addParsed.citations))

  // Editing only offers this when the record has no citations at all: a
  // scraped set is the evidence, and isn't replaced by what's typed in later.
  const editParsed = $derived(editingAnswer && citations.length === 0 ? parsePastedAnswer(draftAnswer) : null)
  const editCitations = $derived(editParsed ? withoutDropped(editParsed.citations) : [])

  function dropCitation(url) {
    droppedUrls = [...droppedUrls, url]
  }

  // Only worth offering when there is something to go back to: an edit made to
  // fill in a blank scrape has nothing useful to restore.
  const canRestore = $derived(
    typeof originalAnswer === 'string' &&
      originalAnswer.trim() !== '' &&
      originalAnswer !== draftAnswer
  )

  // Follows the incoming prop while the editor is closed, so a refetch
  // elsewhere on the page still lands here. `editingAnswer` is read untracked:
  // as a dependency it would re-run the moment a save closes the editor and
  // paint the pre-edit prop back over the text just saved.
  $effect(() => {
    const incoming = result?.answer ?? ''
    const incomingOriginal = result?.answer_original ?? null
    const incomingEditedAt = result?.answer_edited_at ?? null

    untrack(() => {
      if (editingAnswer) return
      answerText = incoming
      originalAnswer = incomingOriginal
      editedAt = incomingEditedAt
    })
  })

  async function patchAnswer(body) {
    const res = await fetch(`${API}/api/answers/${effectiveResult._id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detail.error ?? `API returned ${res.status}`)
    }
    return res.json().catch(() => ({}))
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

  function openAnswerEdit() {
    draftAnswer = answerText
    droppedUrls = []
    editingAnswer = true
    saveError = null
  }

  function cancelAnswerEdit() {
    editingAnswer = false
    saveError = null
  }

  // Enter has to stay a newline in a body of prose, so the shortcut is the
  // usual modifier pair; Escape backs out the way the citation editor does.
  function handleAnswerKey(event) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      if (!savingAnswer) saveAnswer()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      cancelAnswerEdit()
    }
  }

  // Correcting a scrape leaves the platform's own text intact server-side, so
  // the reply carries back whichever of those fields the save established.
  async function saveAnswer() {
    const next = (editParsed ? editParsed.answer : draftAnswer).trim()
    const textChanged = next !== answerText
    if (!textChanged && editCitations.length === 0) {
      cancelAnswerEdit()
      return
    }

    savingAnswer = true
    saveError = null

    try {
      // Only what changed is sent, so adding citations to an answer whose text
      // is fine doesn't mark the text as edited.
      const body = {}
      if (textChanged) body.answer = next
      if (editCitations.length > 0) body.citations = editCitations

      const saved = await patchAnswer(body)
      if (textChanged) {
        answerText = saved.answer ?? next
        if (saved.answer_original != null) originalAnswer = saved.answer_original
        editedAt = saved.answer_edited_at ?? new Date().toISOString()
      }
      if (saved.citations?.length) addedCitations = saved.citations
      editingAnswer = false
    } catch (err) {
      saveError = err.message
    } finally {
      savingAnswer = false
    }
  }

  function openAddAnswer() {
    newAnswerDraft = ''
    droppedUrls = []
    addingAnswer = true
    addError = null
  }

  function cancelAddAnswer() {
    addingAnswer = false
    addError = null
  }

  // Unlike saveAnswer() above, there's no existing document to PATCH -- this
  // platform was never recorded for this run at all, so the server inserts a
  // fresh one. Held in addedResult afterward so the rest of the component
  // (grading, notes, further edits) treats it exactly like a scraped result.
  async function saveNewAnswer() {
    const text = addParsed.answer
    if (!text) return

    savingNewAnswer = true
    addError = null

    try {
      const res = await fetch(`${API}/api/articles/${articleId}/questions/${questionIndex}/answers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_id: runId, platform: name, answer: text, citations: addCitations })
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.error ?? `API returned ${res.status}`)
      }
      const saved = await res.json()
      addedResult = saved
      answerText = saved.answer ?? text
      manuallyAdded = true
      addingAnswer = false
      onAnswerAdded()
    } catch (err) {
      addError = err.message
    } finally {
      savingNewAnswer = false
    }
  }

  function handleNewAnswerKey(event) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      if (!savingNewAnswer) saveNewAnswer()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      cancelAddAnswer()
    }
  }

  // Puts the caret at the end rather than at character zero: a truncated answer
  // is fixed at the bottom, which is also where the textarea should be sitting.
  function focusOnOpen(node) {
    node.focus()
    node.setSelectionRange(node.value.length, node.value.length)
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

{#snippet citationPreview(list, draft)}
  {#if list.length > 0}
    <div class="parsed">
      <p class="parsed-head">{list.length} citation{list.length === 1 ? '' : 's'} found in this text</p>
      <ul>
        {#each list as c (c.url)}
          <li>
            <span class="parsed-label" title={c.url}>{c.label}</span>
            <span class="parsed-domain">{domainOf(c.url)}</span>
            <button type="button" class="link" onclick={() => dropCitation(c.url)} title="Not a source — leave it out">remove</button>
          </li>
        {/each}
      </ul>
    </div>
  {:else if draft}
    <p class="parsed-head none">No links found — paste the answer with its links (copy as markdown) to capture citations.</p>
  {/if}
{/snippet}

<div class="platform" data-verdict={verdict} data-group={group}>
  <div class="head">
    <span class="name">{LABELS[name] ?? name}</span>
    <span class="group-badge {group}" title={group === 'api' ? 'Called the model/search API directly' : 'Asked by driving the real consumer product in a browser'}>{group === 'api' ? 'API' : 'LIVE'}</span>
    {#if manuallyAdded}
      <span
        class="edited"
        title="Entered by hand — the pipeline never recorded an answer from this platform for this run"
      >added by hand</span>
    {:else if editedAt}
      <span
        class="edited"
        title="Answer corrected by hand on {formatDateTime(editedAt)} — the scraped text is kept as answer_original in the export"
      >edited</span>
    {/if}
    {#if effectiveResult?.url}
      <a class="session" href={effectiveResult.url} target="_blank" rel="noreferrer">↗</a>
    {/if}
  </div>

  {#if effectiveResult}
    {#if saveError}<p class="save-error">{saveError}</p>{/if}

    {#if lag}
      <p class="when">
        <span class="lag" class:warn={lag.negative}>{lag.text}</span>
      </p>
    {/if}

    {#if editingAnswer}
      <div class="answer-edit">
        <textarea
          bind:value={draftAnswer}
          rows="12"
          onkeydown={handleAnswerKey}
          use:focusOnOpen
          placeholder="What the platform actually said…"
        ></textarea>
        {#if editParsed}{@render citationPreview(editCitations, draftAnswer.trim())}{/if}
        <div class="answer-actions">
          <button type="button" class="save-note" onclick={saveAnswer} disabled={savingAnswer}>
            {savingAnswer ? 'Saving…' : 'Save answer'}
          </button>
          <button type="button" class="link" onclick={cancelAnswerEdit}>Cancel</button>
          {#if canRestore}
            <button
              type="button"
              class="link"
              onclick={() => (draftAnswer = originalAnswer)}
              title="Put the originally scraped text back in the box"
            >restore scraped text</button>
          {/if}
        </div>
      </div>
    {:else}
      {#if answerText}
        <p class="answer" class:clamped={isLong && !expanded}>
          {#each segments as seg}{#if seg.kind}<mark class={seg.kind}>{seg.text}</mark>{:else}{seg.text}{/if}{/each}
        </p>
      {:else}
        <p class="none">No answer text captured</p>
      {/if}

      <div class="answer-tools">
        {#if isLong}
          <button class="link" onclick={() => (expanded = !expanded)}>
            {expanded ? 'Show less' : 'Show more'}
          </button>
        {/if}
        <button class="link" onclick={openAnswerEdit}>
          {answerText ? 'edit answer' : 'add answer text'}
        </button>
      </div>
    {/if}

    {#if screenshotUrl}
      <a class="screenshot-link" href={screenshotUrl} target="_blank" rel="noreferrer">
        <img class="screenshot-thumb" src={screenshotUrl} alt="Screenshot of the Google AI Overview page for this run" loading="lazy" />
        <span class="link">View full screenshot ↗</span>
      </a>
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

  {:else if addingAnswer}
    {#if addError}<p class="save-error">{addError}</p>{/if}
    <div class="answer-edit">
      <textarea
        bind:value={newAnswerDraft}
        rows="8"
        onkeydown={handleNewAnswerKey}
        use:focusOnOpen
        placeholder="Paste what the platform said — links in it are parsed into citations"
      ></textarea>
      {@render citationPreview(addCitations, newAnswerDraft.trim())}
      <div class="answer-actions">
        <button type="button" class="save-note" onclick={saveNewAnswer} disabled={savingNewAnswer || !addParsed.answer}>
          {savingNewAnswer ? 'Saving…' : 'Save answer'}
        </button>
        <button type="button" class="link" onclick={cancelAddAnswer}>Cancel</button>
      </div>
    </div>
  {:else}
    <p class="none">No answer recorded</p>
    {#if runId}
      <button type="button" class="link" onclick={openAddAnswer}>add answer</button>
    {/if}
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

  /* Provenance, not status — deliberately quieter than the verdict colors so
     it reads at a glance without competing with them. */
  .group-badge {
    padding: 0.05rem 0.3rem;
    font-size: 0.56rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    border-radius: 2px;
  }
  .group-badge.interface { color: #1a6b4a; background: #e3f3ea; }
  .group-badge.api { color: #2a548f; background: #e5eef9; }

  /* A faint left rail on the whole card, matching the section-level accent
     in QuestionTimeline, so an API card still reads as "API" even scrolled
     out of its group header's view. */
  .platform[data-group='api'] { border-left: 2px solid #dbe6f5; }

  /* Sits with the platform name; the auto margin keeps the session link on the
     far right rather than letting three items space themselves evenly. */
  .edited {
    margin-right: auto;
    padding: 0 0.25rem;
    font-size: 0.6rem;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    border: 1px solid var(--line);
    cursor: help;
  }

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

  /* Both links share the row the Show more button used to have to itself. */
  .answer-tools { display: flex; align-items: baseline; gap: 0.9rem; }

  .screenshot-link {
    display: flex; align-items: center; gap: 0.5rem; margin-top: 0.6rem;
    text-decoration: none; color: inherit; width: fit-content;
  }
  .screenshot-thumb {
    width: 3.2rem; height: 2.1rem; object-fit: cover; object-position: top;
    border: 1px solid var(--line); background: var(--card);
  }
  .screenshot-link .link { pointer-events: none; }
  .screenshot-link:hover .link { text-decoration: underline; }

  .answer-edit textarea {
    display: block;
    width: 100%;
    padding: 0.45rem 0.5rem;
    font: inherit;
    font-size: 0.82rem;
    line-height: 1.6;
    color: var(--text);
    background: var(--card);
    border: 1px solid var(--line);
    resize: vertical;
  }

  .answer-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.65rem;
    margin-top: 0.35rem;
  }

  /* The shared .link rule adds top margin for its usual standalone use. */
  .answer-actions .link { margin-top: 0; }

  .parsed { margin-top: 0.45rem; }
  .parsed-head { margin: 0.45rem 0 0.25rem; font-size: 0.68rem; color: var(--muted); }
  .parsed ul { margin: 0; padding: 0; list-style: none; }
  .parsed li {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.15rem 0;
    font-size: 0.7rem;
    border-bottom: 1px solid var(--line);
  }
  .parsed-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .parsed-domain { color: var(--muted); white-space: nowrap; }
  .parsed li .link { margin-top: 0; }

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
