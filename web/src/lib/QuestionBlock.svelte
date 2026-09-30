<script>
  import { untrack } from 'svelte'
  import { API } from './api.js'
  import QuestionWorkspace from './QuestionWorkspace.svelte'
  import { extractKeyTerms } from './highlight.js'
  import QuestionSummary from './QuestionSummary.svelte'


  let {
    q,
    index,
    publishedAt,
    articleId,
    sourceUrl = null,
    onCitationSaved = () => {},
    // Flagging is the one edit here the card above cares about: it decides
    // which questions the update form offers to re-ask.
    onFlagged = () => {}
  } = $props()

  const questionIndex = $derived(q.question_index ?? index)

  // Local working copies, written through to the server on change.
  let questionText = $state(untrack(() => q.question))
  let groundTruth = $state(untrack(() => q.answer ?? ''))
  const terms = $derived(extractKeyTerms(groundTruth))
  let flagged = $state(untrack(() => q.flagged ?? false))
  let runVerdicts = $state({})

  function handleGraded(runId, platform, verdict) {
    runVerdicts = {
      ...runVerdicts,
      [runId]: { ...runVerdicts[runId], [platform]: verdict }
    }
    onFlagged()
    // Keep the question open so confidence can be marked after the verdict.

  }

  // Every question starts folded; open the one you're working on.
  let collapsed = $state(true)
  let detail = $state(null)
  let loadingAnswers = $state(false)
  let answersError = $state(null)
  // A new summary object arrives after polling or a saved grade. Reload only
  // while this question is open; closed cards never fetch response bodies.
  $effect(() => {
    const current=q
    if(collapsed||current.answers_loaded!==false)return
    let cancelled=false
    loadingAnswers=true
    answersError=null
    fetch(`${API}/api/articles/${articleId}/questions/${current.question_id}/history`)
      .then(async res=>{if(!res.ok)throw new Error(`Could not load answers (${res.status})`);return res.json()})
      .then(value=>{if(!cancelled)detail=value})
      .catch(err=>{if(!cancelled)answersError=err.message})
      .finally(()=>{if(!cancelled)loadingAnswers=false})
    return ()=>{cancelled=true}
  })
  let fromSnippet = $state(untrack(() => q.answerable_from_snippet ?? null))
  let fromHistory = $state(untrack(() => q.answerable_from_history ?? null))
  let notes = $state(untrack(() => q.notes ?? ''))
  let savedNotes = $state(untrack(() => q.notes ?? ''))

  let savingNotes = $state(false)
  let error = $state(null)

  let retrying = $state(false)
  let retryNotice = $state('')
  async function retryBrowser() {
    retrying = true
    error = null
    try {
      const res = await fetch(`${API}/api/articles/${articleId}/questions/${questionIndex}/retry`, {method:'POST'})
      const body = await res.json()
      if(!res.ok) throw new Error(body.error??'Could not queue retry')
      retryNotice = 'Browser retry queued for this question.'
      onFlagged()
    } catch(err) { error = err.message }
    finally { retrying = false }
  }

  async function patch(body) {
    error = null
    const res = await fetch(`${API}/api/articles/${articleId}/questions/${questionIndex}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detail.error ?? `API returned ${res.status}`)
    }
  }

  async function setJudgment(field, value) {
    const target = field === 'answerable_from_snippet' ? fromSnippet : fromHistory
    const next = target === value ? null : value
    const previous = target

    if (field === 'answerable_from_snippet') fromSnippet = next
    else fromHistory = next

    try {
      await patch({ [field]: next })
    } catch (err) {
      if (field === 'answerable_from_snippet') fromSnippet = previous
      else fromHistory = previous
      error = err.message
    }
  }

  async function saveNotes() {
    savingNotes = true
    try {
      await patch({ notes })
      savedNotes = notes
    } catch (err) {
      error = err.message
    } finally {
      savingNotes = false
    }
  }

  async function toggleFlag() {
    const next = !flagged
    try {
      await patch({ flagged: next })
      flagged = next
      collapsed = next
      onFlagged()
    } catch (err) {
      error = err.message
    }
  }

  // Editing the question text and its ground-truth answer together, since
  // they're conceptually one unit and rarely change independently. Kept
  // separate from the notes/judgment controls above: those save on every
  // click, this needs an explicit Save because a wrong question or answer
  // asked from now on is a bigger consequence than a wrong toggle.
  let editingQA = $state(false)
  let questionDraft = $state('')
  let answerDraft = $state('')
  let savingQA = $state(false)

  function openEditQA() {
    questionDraft = questionText
    answerDraft = groundTruth
    editingQA = true
    error = null
  }

  function cancelEditQA() {
    editingQA = false
    error = null
  }

  async function saveEditQA() {
    const qText = questionDraft.trim()
    const aText = answerDraft.trim()
    if (!qText) {
      error = 'Question text cannot be empty'
      return
    }

    const body = {}
    if (qText !== questionText) body.question = qText
    if (aText !== groundTruth) body.answer = aText
    if (Object.keys(body).length === 0) {
      editingQA = false
      return
    }

    savingQA = true
    try {
      await patch(body)
      questionText = qText
      groundTruth = aText
      editingQA = false
    } catch (err) {
      error = err.message
    } finally {
      savingQA = false
    }
  }

</script>

<section class="question" class:flagged class:collapsed>
  <header>
    <div class="qcol">
      <button
        type="button"
        class="expander"
        aria-expanded={!collapsed}
        onclick={() => (collapsed = !collapsed)}
      >
        <span class="chevron" aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
        <span class="expander-body">
          <span class="qtext">{questionText}</span>
          {#if collapsed}
            <QuestionSummary runs={q.runs??[]} {publishedAt} verdicts={runVerdicts}/>
          {:else if !collapsed}
            {#if groundTruth}
              <span class="answer-line"><span class="arrow">→</span><span class="truth">{groundTruth}</span></span>
            {:else}
              <span class="answer-line no-answer"><span class="arrow">→</span>no ground-truth answer recorded</span>
            {/if}
          {/if}
        </span>
      </button>
    </div>

    <div class="meta">
      <button class="toggle" disabled={retrying||q.retry_queued} onclick={retryBrowser}
        title="Retry this question on Google, ChatGPT, Claude and Perplexity in the browser">
        {retrying?'Queuing…':q.retry_queued?'Browser retry queued':'Retry browser'}
      </button>
      <button
        class="toggle"
        class:on={fromSnippet === 'yes'}
        aria-pressed={fromSnippet === 'yes'}
        onclick={() => setJudgment('answerable_from_snippet', 'yes')}
      >answerable from snippet</button>

      <button
        class="toggle"
        class:on={fromHistory === 'yes'}
        aria-pressed={fromHistory === 'yes'}
        onclick={() => setJudgment('answerable_from_history', 'yes')}
      >answerable from older reporting</button>

      {#if !collapsed && !editingQA}
        <button class="link" onclick={openEditQA}>edit question</button>
      {/if}

      {#if flagged}
        <button class="link" onclick={toggleFlag}>unflag</button>
      {:else}
        <button class="link danger" onclick={toggleFlag}>bad question</button>
      {/if}
    </div>
  </header>

  {#if flagged}
    <p class="flag-banner"><strong>Bad question</strong></p>
  {/if}

  {#if !collapsed}
    {#if editingQA}
      <div class="qa-edit">
        <span class="label">Question</span>
        <textarea bind:value={questionDraft} rows="2"></textarea>
        <span class="label">Ground-truth answer</span>
        <textarea bind:value={answerDraft} rows="2" placeholder="(none)"></textarea>
        <div class="qa-edit-actions">
          <button class="primary" onclick={saveEditQA} disabled={savingQA}>
            {savingQA ? 'Saving…' : 'Save'}
          </button>
          <button class="link" onclick={cancelEditQA}>Cancel</button>
        </div>
      </div>
    {/if}

    {#if answersError}<p class="err" role="alert">{answersError}</p>{/if}
    {#if loadingAnswers && !detail}<p role="status">Loading answers…</p>{/if}
    {#if q.answers_loaded!==false || detail}
    <QuestionWorkspace
      runs={(q.answers_loaded===false?detail?.runs:q.runs) ?? []}
      {publishedAt}
      {articleId}
      {sourceUrl}
      {questionIndex}
      {terms}
      onGraded={handleGraded}
      {onCitationSaved}
    />
    {/if}

    <div class="notes">
      <span class="label">Notes</span>
      <textarea bind:value={notes} rows="2" placeholder="Observations about this question…"></textarea>
      {#if notes !== savedNotes}
        <button class="primary" onclick={saveNotes} disabled={savingNotes}>
          {savingNotes ? 'Saving…' : 'Save notes'}
        </button>
      {/if}
    </div>
  {/if}

  {#if retryNotice && q.retry_queued}<p class="retry-notice" role="status">{retryNotice}</p>{/if}
  {#if error}<p class="err">{error}</p>{/if}
</section>

<style>
  .question { padding: 1.25rem 0; border-bottom: 1px solid var(--line); }
  /* The card's own border closes the last one, so a divider there doubles up. */
  .question:last-child { padding-bottom: 0; border-bottom: 0; }
  .question.flagged { opacity: 0.75; }

  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem 2.5rem;
    flex-wrap: wrap;
  }

  .qcol { flex: 1 1 30rem; min-width: 0; }

  .expander {
    display: flex;
    align-items: flex-start;
    gap: 0.45rem;
    width: 100%;
    margin: -0.35rem -0.5rem;
    padding: 0.4rem 0.5rem;
    font: inherit;
    color: inherit;
    text-align: left;
    background: none;
    border: 0;
    cursor: pointer;
  }
  .expander:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .chevron {
    flex-shrink: 0;
    margin-top: 0.12rem;
    width: 0.9rem;
    font-size: 0.85rem;
    line-height: 1.3;
    color: var(--muted);
  }
  .expander:hover .chevron { color: var(--text); }
  .expander-body { min-width: 0; flex: 1; }
  .qtext {
    display: block;
    font-size: 1rem;
    font-weight: 600;
    line-height: 1.5;
  }
  .question.collapsed .qtext { font-size: 0.85rem; font-weight: 550; }
  .question.flagged .qtext { text-decoration: line-through; text-decoration-color: var(--muted); }

  /* Indented to sit under the question text, clear of the Q-number. */
  .answer-line { display: block; margin: 0.15rem 0 0; font-size: 0.82rem; line-height: 1.5; }
  .arrow { margin-right: 0.4rem; color: var(--muted); }
  .truth { padding: 0.08rem 0.3rem; background: #ffe89a; font-weight: 600; }
  .no-answer { color: var(--muted); font-style: italic; }

  /* One quiet row for every secondary control, so nothing here competes with
     the question and its answer above. */
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 0.4rem 1rem;
    max-width: 42rem;
    font-size: 0.72rem;
    color: var(--muted);
    text-align: right;
  }

  .toggle {
    padding: 0.15rem 0.5rem;
    font: inherit;
    font-size: 0.72rem;
    color: var(--muted);
    background: var(--card);
    border: 1px solid var(--line);
    cursor: pointer;
  }

  .toggle:hover { color: var(--text); border-color: var(--muted); }
  .toggle.on { background: var(--accent); border-color: var(--accent); color: #fff; }


  .link { padding: 0; font: inherit; font-size: 0.72rem; color: var(--muted); background: none; border: 0; cursor: pointer; }
  .link:hover { color: var(--text); text-decoration: underline; }
  .link.danger:hover { color: var(--danger); }

  .flag-banner { margin: 0.6rem 0 0; padding: 0.45rem 0.65rem; font-size: 0.8rem; background: #fdf6f6; border: 1px solid var(--line); }
  .flag-banner strong { color: var(--danger); margin-right: 0.5rem; }


  .label { display: block; font-size: 0.62rem; font-weight: 650; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin-bottom: 0.3rem; }

  .notes { margin-top: 0.9rem; }
  .notes textarea { display: block; width: 100%; padding: 0.5rem 0.6rem; font: inherit; font-size: 0.82rem; border: 1px solid var(--line); background: var(--card); resize: vertical; }
  .primary { margin-top: 0.4rem; padding: 0.35rem 0.8rem; font: inherit; font-size: 0.78rem; background: var(--accent); color: #fff; border: 0; cursor: pointer; }
  .primary:disabled { opacity: 0.45; cursor: default; }

  .qa-edit { margin-top: 0.6rem; padding: 0.75rem; background: var(--card); border: 1px solid var(--line); }
  .qa-edit .label:not(:first-child) { margin-top: 0.6rem; }
  .qa-edit textarea { display: block; width: 100%; padding: 0.5rem 0.6rem; font: inherit; font-size: 0.85rem; border: 1px solid var(--line); background: #fff; resize: vertical; }
  .qa-edit-actions { display: flex; align-items: center; gap: 0.8rem; margin-top: 0.5rem; }
  .qa-edit-actions .primary { margin-top: 0; }

  .retry-notice { font-size:0.75rem; color:var(--muted); }
  .toggle:disabled { opacity:0.6; cursor:default; }
  .err { margin: 0.5rem 0 0; font-size: 0.78rem; color: var(--danger); }
</style>
