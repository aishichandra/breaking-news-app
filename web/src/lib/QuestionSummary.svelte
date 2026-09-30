<script>
  import {PLATFORM_NAMES,answerLabel,SYMBOL,VERDICTS} from './verdicts.js'
  import {channelRuns} from './channel-runs.js'
  let {runs=[],publishedAt=null,verdicts={}}=$props()
  const progression = $derived([
    {label:'Browser',channel:'Browser'},
    {label:'API',channel:'API'}
  ].map(group=>({
    channel:group.label,
    steps:channelRuns(runs,group.channel,publishedAt)
      .map(window=>({
        id:window.run_id,
        label:window.label,
        answers:PLATFORM_NAMES.filter(name=>(window.platforms[name]?.answer || window.platforms[name]?.has_response)).map(name=>{
          const answer=window.platforms[name]
          const marks=verdicts[String(answer.run_id)]
          const verdict=marks&&Object.hasOwn(marks,name)?marks[name]:answer.verdict
          return {name,verdict,label:answerLabel(name,answer)}
        })
      })).filter(step=>step.answers.length)
  })))

</script>

{#snippet gradeChip(answer,label)}
  <span class="chip" class:ungraded={!answer.verdict}
    style={answer.verdict ? `--chip-color: ${VERDICTS().find((v) => v.value === answer.verdict)?.color ?? 'var(--muted)'}` : ''}
    title="{answer.label} — {label} — {answer.verdict ?? 'ungraded'}"
    aria-label="{answer.label} — {label} — {answer.verdict ?? 'ungraded'}"
  >{answer.verdict ? SYMBOL()[answer.verdict] : '·'}</span>
{/snippet}

            <span class="channel-summaries">
              {#each progression as group (group.channel)}
                <span class="channel-summary">
                  <span class="channel-label">{group.channel}</span>
                  <span class="progress">
                    {#each group.steps as step (step.id)}
                      <span class="step">
                        <span class="when">{step.label}</span>
                        {#if group.channel==='API'}
                          <span class="api-summary-matrix">
                            <span></span><span class="matrix-heading">Original</span><span class="matrix-heading">Recent</span>
                            {#each [{label:'Search',search:true},{label:'No search',search:false}] as row}
                              <span class="matrix-heading row-heading">{row.label}</span>
                              {#each [false,true] as recent}
                                <span class="grades matrix-cell">
                                  {#each step.answers.filter(a=>(!a.name.includes('-no-search'))===row.search&&a.name.endsWith('-recent-news')===recent) as answer (answer.name)}
                                    {@render gradeChip(answer,step.label)}
                                  {:else}<span class="empty-channel" title="No captured response">—</span>{/each}
                                </span>
                              {/each}
                            {/each}
                          </span>
                        {:else}
                          <span class="grades">{#each step.answers as answer (answer.name)}{@render gradeChip(answer,step.label)}{/each}</span>
                        {/if}
                      </span>
                    {:else}<span class="empty-channel">No responses yet</span>{/each}
                  </span>
                </span>
              {/each}
            </span>
<style>
  .channel-summaries { display:grid; gap:0.4rem; margin-top:0.55rem; }
  .channel-summary { display:flex; align-items:flex-start; gap:0.7rem; border:1px solid var(--line); border-radius:5px; padding:0.5rem 0.65rem; background:var(--card); }
  .channel-label { flex:0 0 3.5rem; font-size:0.7rem; font-weight:650; color:var(--muted); padding-top:0.12rem; }
  .progress { display:flex; flex-wrap:wrap; align-items:flex-start; gap:0.45rem 0.9rem; min-width:0; }
  .step { display:flex; flex-direction:column; gap:0.25rem; }
  .when { font-size:0.65rem; color:var(--muted); font-variant-numeric:tabular-nums; }
  .grades { display:flex; flex-wrap:wrap; gap:3px; }
  .api-summary-matrix { display:grid; grid-template-columns:auto minmax(3.7rem,1fr) minmax(3.7rem,1fr); border:1px solid var(--line); border-radius:3px; }
  .matrix-heading { padding:0.25rem 0.35rem; font-size:0.61rem; color:var(--muted); font-weight:500; }
  .row-heading { border-top:1px solid var(--line); }
  .matrix-cell { padding:0.3rem; border-left:1px solid var(--line); border-top:1px solid var(--line); min-height:1.6rem; align-items:center; }
  .empty-channel { font-size:0.7rem; color:var(--muted); }

  .chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.05rem;
    height: 1.05rem;
    font-size: 0.68rem;
    line-height: 1;
    color: #fff;
    background: var(--muted);
  }

  .chip.ungraded { color: var(--muted); background: var(--line); }
  .chip:not(.ungraded) { background: var(--chip-color); }

</style>
