<script>
  import { API } from './lib/api.js'
  import ArticleCard from './lib/ArticleCard.svelte'
  import NewArticleForm from './lib/NewArticleForm.svelte'
  import { platformView, toggleShowApi } from './lib/platformView.svelte.js'

  let tab = $state('view')

  async function loadArticles() {
    const res = await fetch(`${API}/api/articles`)
    if (!res.ok) throw new Error(`API returned ${res.status}`)
    return res.json()
  }

  // Held as data rather than a promise the markup awaits. Re-awaiting a fresh
  // promise unmounts every card back to "Loading…", so saving one citation date
  // looked like a page reload — expanded answers collapsed, scroll position
  // gone. The list stays on screen now while new data is fetched underneath it.
  let articles = $state([])
  let loaded = $state(false)
  let refreshing = $state(false)
  let loadError = $state(null)

  async function refresh() {
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
      <button class:active={tab === 'add'} onclick={() => (tab = 'add')}>
        Add data
      </button>
      <label class="api-switch" title="The 6 raw-API columns, off by default to keep the page from feeling overwhelming">
        <input type="checkbox" checked={platformView.showApi} onchange={toggleShowApi} />
        Show API answers
      </label>
      <a class="export" href="{API}/api/export.json">Export JSON</a>
    </nav>
  </div>
</header>

<main>
  {#if tab === 'add'}
    <NewArticleForm onCreated={handleCreated} />
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
      {/if}
    {/if}
  {/if}
</main>

<style>
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
