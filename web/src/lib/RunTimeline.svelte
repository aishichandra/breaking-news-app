<script>
 let {runs=[],selectedId='',label='Run timeline',onSelect=()=>{}}=$props()
 const index=$derived(Math.max(0,runs.findIndex(r=>String(r.run_id)===selectedId)))
 const current=$derived(runs[index])
 const count=$derived(Object.keys(current?.platforms??{}).length)
 function select(i){onSelect(String(runs[i].run_id))}
</script>
<section class="timeline" aria-label={label}>
 <div class="timeline-heading"><strong>{label} · {current?.label}</strong><span>{count?`${count} captured ${count===1?'response':'responses'}`:'No responses in this window'}</span></div>
 <div class="track-scroll"><div class="track" style:min-width={`${Math.max(0,(runs.length-1)*100)}px`}>
 <input type="range" aria-label={label} min="0" max={runs.length-1} step="1" value={index} aria-valuetext={`${current?.label} after publication, ${count} captured responses`} oninput={e=>select(Number(e.currentTarget.value))}/>
 <div class="stops">{#each runs as r,i}<button class:chosen={i===index} style:left={`${i/(runs.length-1)*100}%`} aria-label={`${r.label} after publication: ${Object.keys(r.platforms).length} captured responses`} aria-pressed={i===index} onclick={()=>select(i)}><span class="dot"></span><span>{r.label}</span></button>{/each}</div>
 </div></div>
</section>
<style>

 .timeline{flex:3;min-width:260px;max-width:100%;padding:10px 14px;border:1px solid var(--line);border-radius:8px;background:var(--card)}.timeline-heading{display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;font-size:12px}.timeline-heading span{color:var(--muted)}.track-scroll{overflow-x:auto;padding:0 40px}.track{padding-top:8px}input{display:block;width:100%;margin:0;height:18px;accent-color:#326953;cursor:ew-resize}.stops{position:relative;height:27px;margin:0 8px}.stops button{position:absolute;transform:translateX(-50%);border:0;background:none;padding:0 3px;font:inherit;font-size:10px;color:var(--muted);cursor:pointer;white-space:nowrap;display:flex;flex-direction:column;align-items:center;gap:5px}.dot{width:1px;height:6px;background:var(--line)}.stops button.chosen{color:#326953;font-weight:600}.chosen .dot{background:#326953}input:focus-visible,button:focus-visible{outline:2px solid #326953;outline-offset:3px}
</style>
