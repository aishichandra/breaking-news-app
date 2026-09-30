import { articleIdentity, sourceCitationStatus } from '../../../source-match.mjs'
import { GROUP_OF, PLATFORM_LABELS } from './verdicts.js'
export const WINDOWS = [
  {id:'first',label:'0–30m',min:0,max:30*60000},
  {id:'30m',label:'30m–1h',min:30*60000,max:3600000},
  {id:'1h',label:'1–5h',min:3600000,max:5*3600000},
  {id:'5h',label:'5–24h',min:5*3600000,max:24*3600000},
  {id:'1d',label:'24h+',min:24*3600000,max:Infinity},
  {id:'unknown',label:'Unknown time'}
]
export const CITATION_TYPES = ['Unclassified','News reporting','Official / primary document','Research','Reference / encyclopedia','Opinion / analysis','Social / forum','Commercial / promotional','Other']
// Any non-null verdict is graded -- the server only ever saves a value from
// the current taxonomy (see api/verdict-categories.js), so there is nothing
// left to enumerate here, and this stays correct as categories are added.
const isGraded = (grade) => grade != null
export const variantOf = key => key.endsWith('-recent-news') ? 'Recent news' : 'Original'
export const baseOf = key => key.replace(/-recent-news$/, '')
export const labelOf = key => PLATFORM_LABELS[baseOf(key)] ?? key
export const channelOf = key => GROUP_OF[key] === 'interface' ? 'Browser' : 'API'
export function timestamp(value) { if(!value) return null; const n=new Date(value).getTime();return Number.isFinite(n)?n:null }
export function timeWindow(published, asked) {
  const pub=timestamp(published),stamp=timestamp(asked)
  if(pub===null||stamp===null||stamp<pub) return 'unknown'
  return WINDOWS.find(w=>stamp-pub>=w.min&&stamp-pub<w.max)?.id ?? 'unknown'
}
export function flatten(articles) {
  const rows=[]
  for(const a of articles) for(const q of a.questions??[]) {
    if(q.flagged) continue
    const qid=String(q.question_id??`${a._id}:${q.question_index}`)
    const runs=q.runs?.length?q.runs:[{run_id:'legacy',platforms:q.platforms??{}}]
    for(const run of runs) for(const [platform,answer] of Object.entries(run.platforms??{})) {
      if(!answer?.answer?.trim()&&!answer?.has_response) continue
      const asked=answer.asked_at??run.asked_at??run.run_at
      rows.push({id:String(answer._id??`${qid}:${run.run_id}:${platform}`),qid,question:q.question,
        article:a, q,run,answer,platform,asked,time:timestamp(asked),bucket:timeWindow(a.published_at,asked),
        channel:channelOf(platform),variant:variantOf(platform),grade:answer.verdict,
        cited:sourceCitationStatus(a.url,answer.citations)})
    }
  }
  return rows
}
// Repeated retries/re-asks within one interval must not overweight a question.
export function latestPerWindow(rows) {
  const map=new Map()
  for(const row of rows){const key=`${row.qid}:${row.platform}:${row.bucket}`,old=map.get(key)
    if(!old||(row.time??-Infinity)>=(old.time??-Infinity)) map.set(key,row)}
  return [...map.values()]
}
export function metric(rows,kind='accuracy') {
  const eligible=rows.filter(r=>kind==='source'?r.cited!==null:isGraded(r.grade))
  const numerator=eligible.filter(r=>kind==='source'?r.cited:r.grade==='correct').length
  return {n:numerator,d:eligible.length,total:rows.length,missing:rows.length-eligible.length,
    pct:eligible.length?Math.round(100*numerator/eligible.length):null}
}
// Restrict each interval to common question cohorts for a fair group comparison.
// For prompt comparisons, also require the same API configuration on both sides.
export function comparison(rows,kind,grouping) {
  return WINDOWS.filter(w=>w.id!=='unknown').map(w=>{
    const eligible=rows.filter(r=>r.bucket===w.id&&(kind==='source'?r.cited!==null:isGraded(r.grade)))
    let left,right,key
    if(grouping==='prompt'){
      left=eligible.filter(r=>r.channel==='API'&&r.variant==='Original')
      right=eligible.filter(r=>r.channel==='API'&&r.variant==='Recent news')
      key=r=>`${r.qid}:${baseOf(r.platform)}`
    }else{
      left=eligible.filter(r=>r.channel==='Browser')
      right=eligible.filter(r=>r.channel==='API'&&r.variant==='Original')
      key=r=>r.qid
    }
    const ls=new Set(left.map(key)),rs=new Set(right.map(key)),common=new Set([...ls].filter(k=>rs.has(k)))
    return {window:w,cohort:common.size,left:metric(left.filter(r=>common.has(key(r))),kind),right:metric(right.filter(r=>common.has(key(r))),kind)}
  })
}
export function citationInventory(rows) {
  const domains=new Map(),pages=new Map()
  for(const row of rows) for(const citation of row.answer.citations??[]) {
    const key=articleIdentity(citation.url)
    if(!key)continue
    const domain=new URL(citation.url).hostname.toLowerCase().replace(/^www\./,'')
    if(!domains.has(domain))domains.set(domain,{domain,responses:new Set(),pages:new Set()})
    const d=domains.get(domain);d.responses.add(row.id);d.pages.add(key)
    if(!pages.has(key))pages.set(key,{key,domain,url:citation.url,label:citation.label||citation.url,responses:new Map()})
    pages.get(key).responses.set(row.id,row)
  }
  return {domains:[...domains.values()].sort((a,b)=>b.responses.size-a.responses.size||a.domain.localeCompare(b.domain)),pages:[...pages.values()]}
}

export function domainComparison(rows) {
 const grouped=new Map()
 for(const row of rows){if(row.platform.includes('-no-search'))continue;if(!grouped.has(row.platform))grouped.set(row.platform,[]);grouped.get(row.platform).push(row)}
 const columns=[...grouped].map(([platform,items])=>({platform,total:new Set(items.map(r=>r.id)).size,counts:new Map(citationInventory(items).domains.map(d=>[d.domain,d.responses.size]))})).sort((a,b)=>channelOf(b.platform).localeCompare(channelOf(a.platform))||labelOf(a.platform).localeCompare(labelOf(b.platform))||variantOf(a.platform).localeCompare(variantOf(b.platform)))
 return {columns,inventory:citationInventory(rows.filter(r=>!r.platform.includes('-no-search')))}
}

export function domainRankings(rows,{channel='All',variant='All'}={}) {
 const providers=[['chatgpt','ChatGPT / OpenAI',/^(chatgpt(?:$|-)|gpt4o-)/],['claude','Claude',/^claude(?:$|-)/],['google','Google',/^google(?:$|-)/],['perplexity','Perplexity',/^perplexity(?:$|-)/]]
 return providers.map(([id,label,pattern])=>{
  const items=rows.filter(r=>pattern.test(r.platform)&&!r.platform.includes('-no-search')&&(channel==='All'||channelOf(r.platform)===channel)&&(variant==='All'||variantOf(r.platform)===variant))
  const total=new Set(items.map(r=>r.id)).size
  return {id,label,total,domains:citationInventory(items).domains.map((d,i)=>({domain:d.domain,rank:i+1,count:d.responses.size,percent:total?d.responses.size/total*100:0}))}
 })
}
