<script>
 import DomainLibrary from './DomainLibrary.svelte'
 import {WINDOWS,flatten,latestPerWindow} from './study.js'
 let {articles=[]}=$props()
 let scope=$state('all'),interval=$state('all')
 const all=$derived(flatten(articles))
 function originalDomain(article){try{const url=new URL(article.url);return ['http:','https:'].includes(url.protocol)?url.hostname.toLowerCase().replace(/^www\./,''):'Unknown domain'}catch{return 'Unknown domain'}}
 const sourceDomains=$derived([...new Set(all.map(r=>originalDomain(r.article)))].sort((a,b)=>a.localeCompare(b)))
 const scoped=$derived(all.filter(r=>scope==='all'||originalDomain(r.article)===scope))
 const rows=$derived(latestPerWindow(scoped).filter(r=>interval==='all'||r.bucket===interval))
</script>
<section class="study">
 <header class="study-header"><div><span class="eyebrow">STUDY COMPARISONS</span><h2>Citation library</h2><p>Compare the most cited domains across platforms and classify their sources.</p></div><label>Original article domain<select bind:value={scope}><option value="all">All original article domains</option>{#each sourceDomains as domain}<option value={domain}>{domain}</option>{/each}</select></label></header>
 <div class="intervals" role="group" aria-label="Time since original article publication"><span>Time after publication</span><div class="toggles"><button class:active={interval==='all'} aria-pressed={interval==='all'} onclick={()=>interval='all'}>All times</button>{#each WINDOWS as window}<button class:active={interval===window.id} aria-pressed={interval===window.id} onclick={()=>interval=window.id}>{window.label}</button>{/each}</div></div>
 <p class="definition">Intervals use the response time relative to the original article’s publication. Each interval includes its start and excludes its end. The latest response per question and configuration in each interval is counted.</p>
 <DomainLibrary {rows}/>
</section>
<style>
 .study{max-width:1250px;margin:auto}.study-header{display:flex;justify-content:space-between;gap:24px;align-items:start;flex-wrap:wrap;padding:24px 0}.eyebrow{font-size:11px;letter-spacing:.1em;color:var(--muted)}h2{font:500 28px/1.3 Georgia,serif;margin:8px 0}p{font-size:13px;color:var(--muted)}label{display:block;font-size:12px;color:var(--muted)}select{display:block;margin-top:7px;max-width:100%;width:100%;padding:9px;font:inherit;color:var(--text);background:var(--card);border:1px solid var(--line);border-radius:5px}.study-header label{max-width:360px;min-width:230px}.intervals{display:flex;gap:14px;align-items:center;flex-wrap:wrap;font-size:12px;color:var(--muted)}.toggles{display:flex;gap:5px;flex-wrap:wrap}.toggles button{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--muted);border-radius:5px;padding:7px 12px;cursor:pointer}.toggles button.active{background:#e7efe9;border-color:#739c89;color:#28513e}.toggles button:focus-visible{outline:2px solid #326953;outline-offset:2px}.definition{font-size:11px;line-height:1.6;margin:10px 0 20px}
</style>
