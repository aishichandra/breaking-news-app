<script>
  import { activeArticles } from '../../active-dataset.mjs'
  import StudyExplorer from './lib/StudyExplorer.svelte'
  import { API } from './lib/api.js'
  import ArticleCard from './lib/ArticleCard.svelte'
  import NewArticleForm from './lib/NewArticleForm.svelte'
  import VerdictCategorySettings from './lib/VerdictCategorySettings.svelte'
  import ArchiveExplorer from './lib/ArchiveExplorer.svelte'
  import { platformView, toggleShowApi } from './lib/platformView.svelte.js'
  import { loadVerdictCategories } from './lib/verdictCategories.svelte.js'

  let tab = $state('view')
  let environment = $state(null)
  let historyRefreshing = $state(false)
  let historyUpdatedAt = $state(null)
  fetch(`${API}/api/environment`).then(r=>r.ok?r.json():null).then(value=>environment=value).catch(()=>{})
  void loadVerdictCategories()

  let nextCursor = $state(null)
  let pagesLoaded = $state(1)
  let studyArticles = $state([])
  let studyLoaded = $state(false)
  let studyError = $state(null)
  async function loadArticles() {
    let cursor = null
    const items = []
    for(let page=0;page<pagesLoaded;page++){
      const res=await fetch(`${API}/api/article-summaries?limit=12${cursor?`&before=${cursor}`:''}`)
      if(!res.ok)throw new Error(`API returned ${res.status}`)
      const result=await res.json()
      items.push(...result.items)
      cursor=result.next_cursor
      if(!cursor)break
    }
    nextCursor=cursor
    return activeArticles(items)
  }
  let studyLoading=false
  async function loadStudy(){
    if(studyLoading)return
    studyLoading=true
    try{
      const items=[]
      let cursor=null
      do{
        const res=await fetch(`${API}/api/article-summaries?study=1&limit=50${cursor?`&before=${cursor}`:''}`)
        if(!res.ok)throw new Error(`API returned ${res.status}`)
        const result=await res.json();items.push(...result.items);cursor=result.next_cursor
      }while(cursor)
      studyArticles=activeArticles(items)
      studyLoaded=true
      studyError=null
    }catch(err){studyError=err}finally{studyLoading=false}
  }
  function openStudy(){tab='study';void loadStudy()}
  async function moreArticles(){pagesLoaded++;await refresh()}

  // Held as data rather than a promise the markup awaits. Re-awaiting a fresh
  // promise unmounts every card back to "Loading…", so saving one citation date
  // looked like a page reload — expanded answers collapsed, scroll position
  // gone. The list stays on screen now while new data is fetched underneath it.
  let articles = $state([])
  let loaded = $state(false)
  let refreshing = $state(false)
  let loadError = $state(null)

  async function refresh() {
    if (refreshing) return
    refreshing = true
    try {
      articles = await loadArticles()
      loadError = null
    } catch (err) {
      loadError = err
    } finally {
      refreshing = false
      loaded = true
    }
  }

  refresh()

  // New stories arrive independently of manual re-asks. Keep visible dashboards current.
  $effect(() => {
    const check = () => { if (!document.hidden) { if(tab==='view')void refresh(); else if(tab==='study')void loadStudy() } }
    const id = setInterval(check, 15000)
    document.addEventListener('visibilitychange', check)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', check) }
  })

  function handleCreated() {
    refresh()
    tab = 'view'
  }
</script>

<header class="topbar">
  <div class="inner">
    <h1>Breaking News Experiment</h1>

    <nav class="tabs">
      <button class:active={tab === 'view'} onclick={() => (tab = 'view')}>
        Answers
      </button>
      <button class:active={tab === 'study'} onclick={openStudy}>Study comparisons</button>
      <button class:active={tab === 'add'} onclick={() => (tab = 'add')}>
        Add data
      </button>
      <button class:active={tab === 'settings'} onclick={() => (tab = 'settings')}>
        Settings
      </button>
      <button class:active={tab === 'archive'} onclick={() => (tab = 'archive')}>
        Archive
      </button>
      <label class="api-switch" title="Show model answers from direct API calls">
        <input type="checkbox" checked={platformView.showApi} onchange={toggleShowApi} />
        Show API answers
      </label>
      <a class="export" href="{API}/api/export.json">Export JSON</a>
    </nav>
  </div>
</header>

<main>
  {#if historyRefreshing}<p class="status" role="status">Updating response history… Showing data loaded{historyUpdatedAt?` at ${new Date(historyUpdatedAt).toLocaleTimeString()}`:''} while the latest responses arrive.</p>{/if}
  {#if environment?.local}<p class="local-banner">Local review · isolated data snapshot{environment.snapshot_at ? ` from ${new Date(environment.snapshot_at).toLocaleString()}` : ''}. Changes here do not affect production.</p>{/if}
  {#if tab === 'add'}
    <NewArticleForm onCreated={handleCreated} />
  {:else if tab === 'settings'}
    <VerdictCategorySettings />
  {:else if tab === 'archive'}
    <ArchiveExplorer />
  {:else if tab === 'study'}
    {#if studyError}<p class="status error">Could not load responses: {studyError.message}</p>{:else if !studyLoaded}<p class="status">Loading response history…</p>{:else}<StudyExplorer articles={studyArticles} onUpdated={loadStudy}/>{/if}
  {:else}
    {#if !loaded}
      <p class="status">Loading…</p>
    {:else}
      {#if loadError}
        <p class="status error">Couldn't load articles: {loadError.message}</p>
      {/if}

      {#if articles.length === 0 && !loadError}
        <div class="empty">
          <p>No articles yet.</p>
          <button class="primary" onclick={() => (tab = 'add')}>Add your first one</button>
        </div>
      {:else}
        <p class="status">
          {articles.length} article{articles.length === 1 ? '' : 's'}
          {#if refreshing}<span class="refreshing">refreshing…</span>{/if}
        </p>
        {#each articles as article (article._id)}
          <ArticleCard {article} onDeleted={refresh} onCitationSaved={refresh} onUpdated={refresh} />
        {/each}
        {#if nextCursor}<button class="primary" disabled={refreshing} onclick={moreArticles}>Load more articles</button>{/if}
      {/if}
    {/if}
  {/if}
</main>

<style>
  .local-banner {padding:10px 14px;background:#e4eee5;color:#2f5c43;border-radius:6px;font-size:12px;}

  .topbar {
    background: var(--card);
    border-bottom: 1px solid var(--line);
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .inner {
    max-width: 1600px;
    margin: 0 auto;
    padding: 0 1.5rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.5rem;
    flex-wrap: wrap;
  }

  h1 {
    font-size: 1.05rem;
    font-weight: 600;
    letter-spacing: -0.01em;
    margin: 1rem 0;
  }

  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    align-items: center;
  }

  .tabs button {
    padding: 0.85rem 0.9rem;
    font: inherit;
    font-size: 0.875rem;
    color: var(--muted);
    background: none;
    border: 0;
    border-bottom: 2px solid transparent;
    cursor: pointer;
  }

  .tabs button:hover {
    color: var(--text);
  }

  .tabs button.active {
    color: var(--text);
    font-weight: 550;
    border-bottom-color: var(--accent);
  }

  main {
    max-width: 1600px;
    margin: 0 auto;
    padding: 1.5rem 1.5rem 4rem;
  }

  .status {
    color: var(--muted);
    font-size: 0.8rem;
    margin: 0 0 1rem;
  }

  /* Deliberately quiet: a background refresh should be noticeable if you look
     for it and invisible if you don't. */
  .refreshing { margin-left: 0.4rem; font-style: italic; opacity: 0.7; }

  .empty {
    text-align: center;
    padding: 4rem 1rem;
    color: var(--muted);
  }

  .primary {
    padding: 0.5rem 1rem;
    font: inherit;
    font-size: 0.875rem;
    background: var(--accent);
    color: #fff;
    border: 0;
    cursor: pointer;
  }

  .api-switch {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    margin-left: 0.5rem;
    font-size: 0.78rem;
    color: var(--muted);
    cursor: pointer;
    user-select: none;
  }
  .api-switch:hover { color: var(--text); }
  .api-switch input { accent-color: var(--accent); cursor: pointer; }

  .export {
    align-self: center;
    margin-left: 0.75rem;
    padding: 0.3rem 0.7rem;
    font-size: 0.78rem;
    color: var(--text);
    text-decoration: none;
    border: 1px solid var(--line);
  }

  .export:hover { border-color: var(--muted); }

  .error {
    color: var(--danger);
  }
</style>
