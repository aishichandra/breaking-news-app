<script>
 import {onMount,untrack} from 'svelte'
 import {API} from './api.js'
 import {judgeSettings,loadJudgeSettings} from './judgeSettings.svelte.js'
 let {answerId,saved=null,humanVerdict=null,onAccepted=()=>{}}=$props()
 let judge=$state(untrack(()=>saved)),busy=$state(false),error=$state('')
 const automaticPending=$derived(judgeSettings.configured&&judgeSettings.automatic&&(!judge||judge.status==='stale'))
 const pending=$derived((['queued','running','retry_pending'].includes(judge?.status)||automaticPending))
 const labels={correct:'Correct',partial:'Partially correct',incorrect:'Incorrect',abstained:'Abstained',speculation:'Speculation',needs_review:'Needs review'}
 async function request(suffix='',method='GET'){const r=await fetch(`${API}/api/answers/${answerId}/judge${suffix}`,{method});const value=await r.json();if(!r.ok)throw Error(value.error||'Judge request failed');return value}
 async function refresh(){try{judge=await request();error=''}catch(e){error=e.message}}
 onMount(()=>{void loadJudgeSettings();void refresh()})
 $effect(()=>{if(!pending)return;const timer=setInterval(refresh,3000);return()=>clearInterval(timer)})
 $effect(()=>{const incoming=saved;untrack(()=>{if(incoming)judge=incoming})})
 async function run(){busy=true;error='';try{judge=await request('','POST')}catch(e){error=e.message}finally{busy=false}}
 async function accept(){busy=true;error='';try{const value=await request('/accept','POST');onAccepted(value.verdict);await refresh()}catch(e){error=e.message;await refresh()}finally{busy=false}}
</script>
<section class="judge" aria-label="LLM accuracy suggestion"><div class="heading"><strong>LLM first pass</strong>{#if !pending&&(!judge||['error','stale'].includes(judge.status))}<button onclick={run} disabled={busy||!judgeSettings.configured}>{judge?'Judge again':'Judge'}</button>{/if}</div>
{#if pending}<p role="status">{judge?.status==='retry_pending'?judge.error:judge?.status==='running'?'Judging…':'Queued for automatic judging…'}</p>{:else if judge?.status==='complete'}<p><b>{labels[judge.verdict]}</b> · Judge confidence: {judge.confidence}</p><p>{judge.rationale}</p><small>{judge.model} · {judge.rubric}</small>{#if humanVerdict}<small>{judge.accepted_at&&humanVerdict===judge.verdict?'Suggestion accepted':'Human grade recorded'}</small>{:else if judge.verdict!=='needs_review'}<button onclick={accept} disabled={busy}>Accept suggestion</button><small>Or use the grade buttons below to choose a different result.</small>{:else}<small>Use the grade buttons below after reviewing the evidence.</small>{/if}{:else if humanVerdict&&['queued','running','cancelled'].includes(judge?.status)}<small>Human grade recorded.</small>{:else if judge?.status==='stale'}<p>The answer or reference changed. Run the judge again before accepting a suggestion.</p>{:else if judge?.status==='error'}<p role="alert">{judge.error}</p>{:else}<small>{judgeSettings.configured?'No automated assessment yet.':'Judge is not configured; see LLM judge settings above.'}</small>{/if}
{#if error}<p role="alert">{error}</p>{/if}</section>
<style>.judge{border:1px solid var(--line);border-radius:6px;padding:12px;margin-top:14px;font-size:12px}.heading{display:flex;align-items:center;justify-content:space-between;gap:8px}p{line-height:1.6;margin:8px 0}small{display:block;color:var(--muted);font-size:10px;margin:7px 0}button{font:inherit;font-size:11px;background:var(--card);color:var(--text);border:1px solid var(--line);border-radius:5px;padding:6px 10px;cursor:pointer}button:disabled{opacity:.5;cursor:default}</style>
