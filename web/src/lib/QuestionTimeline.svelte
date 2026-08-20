<script>
  import PlatformAnswer from './PlatformAnswer.svelte'
  import { describeLag, formatDateTime, runAskedAt } from './time.js'
  import { PLATFORM_NAMES } from './verdicts.js'

  let {
    runs = [],
    publishedAt = null,
    articleId,
    questionIndex,
    terms = null,
    onGraded = () => {},
    onCitationSaved = () => {}
  } = $props()

  function lagForRun(run) {
    return describeLag(publishedAt, runAskedAt(run))
  }
</script>

{#if runs.length === 0}
  <p class="empty">No platform answers recorded yet.</p>
{:else}
  <ol class="timeline">
    {#each runs as run, i (run.run_id)}
      {@const lag = lagForRun(run)}
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
              {#if lag}
                <span class="lag" class:warn={lag.negative}>{lag.text}</span>
              {:else if !publishedAt}
                <span class="lag muted">set publish date to see lag</span>
              {/if}
            </div>
            <span class="run-num">{i + 1} of {runs.length}</span>
          </header>

          <div class="grid">
            {#each PLATFORM_NAMES as name}
              <PlatformAnswer
                {name}
                {publishedAt}
                {articleId}
                {questionIndex}
                {terms}
                result={run.platforms?.[name]}
                onGraded={(platform, verdict) => onGraded(String(run.run_id), platform, verdict)}
                {onCitationSaved}
              />
            {/each}
          </div>
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

  .lag.warn { color: var(--danger); }
  .lag.muted { font-style: italic; }

  .run-num {
    font-size: 0.68rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.6rem;
    align-items: stretch;
  }

  @media (max-width: 1200px) {
    .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }

  @media (max-width: 700px) {
    .grid { grid-template-columns: minmax(0, 1fr); }
  }
</style>
