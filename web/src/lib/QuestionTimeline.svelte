<script>
  import PlatformAnswer from './PlatformAnswer.svelte'
  import { formatDateTime, runAskedAt } from './time.js'
  import { PLATFORM_GROUPS } from './verdicts.js'
  import { platformView, toggleShowApi } from './platformView.svelte.js'

  let {
    runs = [],
    publishedAt = null,
    articleId,
    questionIndex,
    terms = null,
    onGraded = () => {},
    onCitationSaved = () => {}
  } = $props()

  const interfaceGroup = PLATFORM_GROUPS.find((g) => g.id === 'interface')
  const apiGroup = PLATFORM_GROUPS.find((g) => g.id === 'api')

  const comparisons = [
    { label: 'ChatGPT / GPT-4o', browser: 'chatgpt', api: ['gpt4o-no-search', 'gpt4o-web-search'] },
    { label: 'Claude Sonnet 4', browser: 'claude', api: ['claude-sonnet4-no-search', 'claude-sonnet4-web-search'] },
    { label: 'Perplexity', browser: 'perplexity', api: ['perplexity-api'] },
    { label: 'Google AI Overview', browser: 'google', api: ['google-ai-overview-api'] }
  ]

  function apiAnsweredCount(run) {
    return apiGroup.names.filter((n) => run.platforms?.[n]?.answer).length
  }
</script>

{#if runs.length === 0}
  <p class="empty">No platform answers recorded yet.</p>
{:else}
  <ol class="timeline">
    {#each runs as run, i (run.run_id)}
      {@const askedAt = runAskedAt(run)}
      <li class="moment">
        <div class="rail">
          <span class="dot"></span>
          {#if i < runs.length - 1}
            <span class="line"></span>
          {/if}
        </div>

        <div class="panel">
          <header class="moment-head">
            <div class="when">
              {#if run.milestone?.label}
                <span class="milestone">{run.milestone.label}</span>
              {/if}
              {#if askedAt}
                <time datetime={askedAt}>{formatDateTime(askedAt)}</time>
              {/if}
              {#if !publishedAt}
                <span class="lag muted">set publish date to see timing</span>
              {/if}
            </div>
            <span class="run-num">{i + 1} of {runs.length}</span>
          </header>

          <button type="button" class="group-label toggle" aria-expanded={platformView.showApi} onclick={toggleShowApi}>
            <span class="chevron" aria-hidden="true">{platformView.showApi ? '▾' : '▸'}</span>
            Compare browser + API
            <span class="count">{apiAnsweredCount(run)}/{apiGroup.names.length} API answers</span>
          </button>
          {#if platformView.showApi}
            {#each comparisons as platform}
              <section class="comparison">
                <h3>{platform.label}</h3>
                <div class="comparison-grid" class:pair={platform.api.length === 1}>
                  {#each [platform.browser, ...platform.api] as name}
                    <PlatformAnswer
                      {name}
                      comparison={true}
                      displayName={name === platform.browser ? 'Browser' : name.endsWith('no-search') ? 'API · No search' : 'API · Web search'}
                      {publishedAt}
                      {articleId}
                      {questionIndex}
                      {terms}
                      result={run.platforms?.[name]}
                      runId={run.run_id}
                      onGraded={(platform, verdict) => onGraded(String(run.run_id), platform, verdict)}
                      {onCitationSaved}
                    />
                  {/each}
                </div>
              </section>
            {/each}
          {:else}
            <div class="group-label">{interfaceGroup.label}</div>
            <div class="grid">
              {#each interfaceGroup.names as name}
                <PlatformAnswer
                  {name}
                  {publishedAt}
                  {articleId}
                  {questionIndex}
                  {terms}
                  result={run.platforms?.[name]}
                  runId={run.run_id}
                  onGraded={(platform, verdict) => onGraded(String(run.run_id), platform, verdict)}
                  {onCitationSaved}
                />
              {/each}
            </div>
          {/if}
        </div>
      </li>
    {/each}
  </ol>
{/if}

<style>
  .empty {
    margin: 0.9rem 0 0;
    font-size: 0.8rem;
    color: var(--muted);
    font-style: italic;
  }

  .timeline {
    list-style: none;
    margin: 0.9rem 0 0;
    padding: 0;
  }

  .moment {
    display: flex;
    gap: 0.85rem;
    align-items: stretch;
  }

  .rail {
    flex-shrink: 0;
    width: 0.75rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-top: 0.35rem;
  }

  .dot {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    background: var(--accent);
    border: 2px solid var(--card);
    box-shadow: 0 0 0 1px var(--line);
  }

  .line {
    flex: 1;
    width: 2px;
    min-height: 1rem;
    margin: 0.2rem 0;
    background: var(--line);
  }

  .panel {
    flex: 1;
    min-width: 0;
    margin-bottom: 1.1rem;
  }

  .moment-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 0.55rem;
  }

  .when {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.35rem 0.65rem;
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
  }

  .when time {
    font-weight: 550;
    color: var(--text);
  }

  .milestone {
    font-weight: 650;
    color: var(--text);
  }

  .lag {
    color: var(--muted);
  }

  .lag.muted { font-style: italic; }

  .run-num {
    font-size: 0.68rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 0.6rem;
    align-items: stretch;
  }

  @media (max-width: 700px) {
    .grid { grid-template-columns: minmax(0, 1fr); }
  }

  .comparison { margin-top: 1.25rem; }
  .comparison h3 {
    margin: 0 0 0.65rem;
    font-size: 0.95rem;
    font-weight: 650;
    color: var(--text);
  }
  .comparison-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.85rem;
    align-items: stretch;
  }
  .comparison-grid.pair { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  @media (max-width: 850px) {
    .comparison-grid, .comparison-grid.pair { grid-template-columns: minmax(0, 1fr); }
  }

  .group-label {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    margin: 0 0 0.4rem;
    font-size: 0.66rem;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }

  /* Raw-API is the group most people want folded away most of the time, so
     its label doubles as the expand/collapse control — no separate button
     competing for attention next to it. */
  button.group-label.toggle {
    padding: 0.2rem 0;
    font: inherit;
    font-size: 0.66rem;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    background: none;
    border: 0;
    cursor: pointer;
  }
  button.group-label.toggle:hover { color: var(--text); }
  .chevron { width: 0.7rem; font-size: 0.8rem; }
  .count { font-weight: 400; text-transform: none; letter-spacing: 0; color: var(--muted); }


</style>
