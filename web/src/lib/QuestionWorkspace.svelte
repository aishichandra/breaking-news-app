<script>
 import {PLATFORM_GROUPS,modelLabel} from './verdicts.js'
 import PlatformAnswer from './PlatformAnswer.svelte'
 import RunTimeline from './RunTimeline.svelte'
 import {labelOf,variantOf,channelOf} from './study.js'
 import {channelRuns,selectedWindow} from './channel-runs.js'
 let {runs=[],publishedAt=null,articleId,sourceUrl=null,questionIndex,terms=null,onGraded=()=>{},onCitationSaved=()=>{}}=$props()
 let view=$state('browser'), windowId=$state(''), platformId=$state('chatgpt')
 const timeline=$derived(channelRuns(runs,'All',publishedAt))
 const currentWindow=$derived(selectedWindow(timeline,windowId))
 const browserRun=$derived(currentWindow)
 const apiRun=$derived(currentWindow)
 const browsers=$derived(Object.keys(currentWindow.platforms).filter(p=>channelOf(p)==='Browser'))
 const apiAvailable=$derived(Object.keys(apiRun?.platforms??{}))
 const showBrowsers=$derived(view==='browser'||view==='platform')
 const showApi=$derived(view==='api'||view==='platform')
 const apiGroups=$derived(PLATFORM_GROUPS.find(g=>g.id==='api').subgroups.map(g=>({...g,names:g.names.filter(p=>apiAvailable.includes(p))})).filter(g=>g.names.length))
 const families=[{id:'chatgpt',label:'ChatGPT',api:'api-gpt4o'},{id:'claude',label:'Claude',api:'api-claude'},{id:'perplexity',label:'Perplexity',api:'api-perplexity'},{id:'google',label:'Google AI Overview',api:'api-google'}]
 const allAvailable=$derived(new Set(timeline.flatMap(r=>Object.keys(r.platforms))))
 const familyOptions=$derived(families.filter(f=>allAvailable.has(f.id)||PLATFORM_GROUPS.find(g=>g.id==='api').subgroups.find(g=>g.id===f.api)?.names.some(p=>allAvailable.has(p))))
 const family=$derived(familyOptions.find(f=>f.id===platformId)??familyOptions[0])
 const apiRows=$derived(view==='platform'?apiGroups.filter(g=>g.id===family?.api):apiGroups)
 const browserNames=$derived(view==='platform'?browsers.filter(p=>p===family?.id):browsers)
 const apiColumns=[{label:'Original',recent:false},{label:'Recent',recent:true}]
 const searchRows=[{label:'Search',search:true},{label:'No search',search:false}]
 function columnKeys(group,column,row){return group.names.filter(p=>(variantOf(p)==='Recent news')===column.recent&&(!p.includes('-no-search'))===row.search)}
 function gradeBrowser(name,value){onGraded(String(browserRun.platforms[name].run_id),name,value)}
 function gradeApi(name,value){onGraded(String(apiRun.platforms[name].run_id),name,value)}
</script>
<div class="workspace">
 <nav aria-label="Question layout">{#each [{id:'browser',label:'All browser'},{id:'api',label:'All API'},{id:'platform',label:'By platform'}] as mode}<button class:active={view===mode.id} aria-pressed={view===mode.id} onclick={()=>view=mode.id}>{mode.label}</button>{/each}</nav>
 {#if !runs.length}<p class="muted">No responses recorded yet.</p>
 {:else}
 {#if view==='platform'}<div class="controls"><label class="platform-picker">Platform<select bind:value={platformId}>{#each familyOptions as f}<option value={f.id}>{f.label}</option>{/each}</select></label></div>{/if}
 <div class="controls"><RunTimeline runs={timeline} selectedId={currentWindow.run_id} label="Time since publication" onSelect={id=>windowId=id}/></div>
 <div class="reading">
 {#if showBrowsers}
 <h3>{view==='platform'?`${family?.label??'Platform'} · Browser`:'All browser responses'}</h3>
 {#if !browserNames.length}<p class="muted">No browser responses captured in this time window.</p>{:else}<div class="response-grid browser-row" style:--response-count={browserNames.length}>{#each browserNames as p (`${browserRun.platforms[p].run_id}:${p}:${browserRun.platforms[p]._id??''}`)}<PlatformAnswer name={p} displayName={`${labelOf(p)} · Browser`} compact={true} result={browserRun.platforms[p]} {publishedAt} {articleId} {sourceUrl} {questionIndex} runId={browserRun.platforms[p].run_id} {terms} onGraded={gradeBrowser} {onCitationSaved}/>{/each}</div>{/if}
 {/if}
 {#if showApi}
 <h3>{view==='platform'?`${family?.label??'Platform'} · API`:'All API responses'}</h3>
 {#if !apiRows.length}<p class="muted">No API responses captured in this time window.</p>{/if}
 {#each apiRows as api}
 <!-- Keyboard focus allows horizontal scrolling on narrow screens. -->
 <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
 <div class="api-matrix-scroll" tabindex="0" role="region" aria-label={`${api.label} API matrix`}>
 <table class="api-matrix"><caption>{api.label} · API · selected time window</caption><thead><tr><th scope="col">Search mode</th>{#each apiColumns as column}<th scope="col">{column.label}</th>{/each}</tr></thead><tbody>
 {#each searchRows as row}<tr><th scope="row">{row.label}</th>{#each apiColumns as column}<td>{#each columnKeys(api,column,row) as p (`${apiRun.platforms[p].run_id}:${p}:${apiRun.platforms[p]._id??''}`)}<PlatformAnswer name={p} displayName={`${modelLabel(p,apiRun.platforms[p])} · ${row.label} · ${column.label}`} compact={true} result={apiRun.platforms[p]} {publishedAt} {articleId} {sourceUrl} {questionIndex} runId={apiRun.platforms[p].run_id} {terms} onGraded={gradeApi} {onCitationSaved}/>{:else}<p class="muted">—<br>No captured response</p>{/each}</td>{/each}</tr>{/each}
 </tbody></table></div>{/each}
 {/if}
 </div>
 {/if}
</div>
<style>
 .platform-picker{flex:1.4;min-width:240px;padding:12px 16px;border:1px solid #abc5b6;border-radius:8px;background:#eef5ef;color:#28583e;font-size:13px;font-weight:600;box-sizing:border-box}.platform-picker select{font-size:17px;font-weight:600;min-height:48px;padding:11px 14px;border:2px solid #326953;background:var(--card);border-radius:6px;color:var(--text);cursor:pointer}.platform-picker select:focus-visible{outline:3px solid #abc5b6;outline-offset:3px}


 .api-matrix-scroll{margin-bottom:24px;overflow:auto;max-width:100%;border:1px solid var(--line);border-radius:6px}.api-matrix{border-collapse:separate;border-spacing:0;table-layout:fixed;width:100%;min-width:650px}.api-matrix caption{text-align:left;padding:14px;font-size:14px;font-weight:600}.api-matrix th,.api-matrix td{border-top:1px solid var(--line);border-right:1px solid var(--line);vertical-align:top;text-align:left}.api-matrix th{padding:14px;background:var(--card);font-size:13px}.api-matrix th:first-child{width:130px;position:sticky;left:0;z-index:1}.api-matrix td{padding:0}.api-matrix td>.muted{padding:18px}.api-matrix td :global(.platform.compact){border:0;border-radius:0;padding:16px}.api-matrix tr>:last-child{border-right:0}

 .reading h3{font-size:16px;margin:0 0 10px}
 .workspace{margin-top:22px}nav{display:flex;flex-wrap:wrap;gap:18px;border-bottom:1px solid var(--line);margin-bottom:20px}nav button{font:inherit;font-size:13px;border:0;border-bottom:2px solid transparent;background:none;color:var(--muted);padding:9px 0;cursor:pointer}nav button.active{color:var(--text);border-color:#326953}.controls{display:flex;gap:16px;flex-wrap:wrap;margin:16px 0;align-items:end}label{font-size:12px;color:var(--muted);max-width:100%;flex:1;min-width:180px}select{font:inherit;color:var(--text);background:var(--card);display:block;width:100%;margin-top:6px;border:1px solid var(--line);padding:9px;border-radius:5px}.reading{min-width:0}.response-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:20px}.response-grid.browser-row{grid-template-columns:repeat(var(--response-count),minmax(220px,1fr));overflow-x:auto;align-items:start;padding-bottom:12px;margin-bottom:24px}.muted{font-size:12px;color:var(--muted)}
</style>
