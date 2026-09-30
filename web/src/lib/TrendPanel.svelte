<script>
 let { title, subtitle, data, labels } = $props()
 const y = p => 150-p*1.15
 function segments(side) {
   const groups=[];let current=[]
   data.forEach((d,i)=>{if(d[side].pct===null){if(current.length)groups.push(current);current=[]}else current.push(`${40+i*82},${y(d[side].pct)}`)})
   if(current.length)groups.push(current)
   return groups
 }
</script>
<section class="trend">
 <h3>{title}</h3><p>{subtitle}</p>
 <svg viewBox="0 0 410 192" role="img" aria-label={title}>
  {#each [0,50,100] as value}<line x1="40" x2="375" y1={y(value)} y2={y(value)} class="grid"/><text x="0" y={y(value)+4}>{value}%</text>{/each}
  {#each ['left','right'] as side,i}
   {#each segments(side) as segment}<polyline points={segment.join(' ')} class:other={i===1}/>{/each}
   {#each data as d,j}{#if d[side].pct!==null}<circle cx={40+j*82} cy={y(d[side].pct)} r="3.5" class:other={i===1}><title>{labels[i]} · {d.window.label}: {d[side].n}/{d[side].d} ({d[side].pct}%)</title></circle>{/if}{/each}
  {/each}
  {#each data as d,i}<text x={40+i*82} y="176" text-anchor="middle">{d.window.label}</text>{/each}
 </svg>
 <div class="legend"><span>━━ {labels[0]}</span><span>┄┄ {labels[1]}</span></div>
 <details><summary>Counts and comparison coverage</summary><table><thead><tr><th>Time</th><th>{labels[0]}</th><th>{labels[1]}</th><th>Matched groups</th></tr></thead><tbody>{#each data as d}<tr><td>{d.window.label}</td><td>{d.left.d?`${d.left.n}/${d.left.d}`:'—'}</td><td>{d.right.d?`${d.right.n}/${d.right.d}`:'—'}</td><td>{d.cohort}</td></tr>{/each}</tbody></table></details>
</section>
<style>
 .trend{background:var(--card);border:1px solid var(--line);border-radius:9px;padding:18px;min-width:0}h3{font-size:15px;margin:0}p{font-size:12px;color:var(--muted);margin:5px 0 12px}svg{display:block;width:100%;max-width:520px}text{font:11px system-ui;fill:var(--muted)}.grid{stroke:var(--line)}polyline{stroke:#326953;stroke-width:2.5;fill:none}circle{fill:#326953}.other{stroke:#677ba4}circle.other{fill:#677ba4;stroke:none}polyline.other{stroke-dasharray:5 3}.legend{display:flex;gap:20px;flex-wrap:wrap;font-size:12px}.legend span:first-child{color:#326953}.legend span:last-child{color:#677ba4}details{margin-top:12px;font-size:12px}summary{cursor:pointer;color:var(--muted)}table{width:100%;border-collapse:collapse;margin-top:10px}td,th{text-align:left;padding:5px;border-bottom:1px solid var(--line);font-weight:400}
</style>
