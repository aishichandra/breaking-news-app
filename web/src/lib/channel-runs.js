import {channelOf,variantOf} from './study.js'

const MINUTE=60000
export const TIMELINE_WINDOWS=[
 {id:'under15',label:'<15 min',min:0,max:15*MINUTE},
 {id:'15to30',label:'15–30 min',min:15*MINUTE,max:30*MINUTE},
 {id:'30to60',label:'30 min–1 hr',min:30*MINUTE,max:60*MINUTE},
 {id:'1to5',label:'1–5 hrs',min:60*MINUTE,max:300*MINUTE},
 {id:'day',label:'1 day',min:1440*MINUTE,max:Infinity}
]
const time=value=>value?new Date(value).getTime():NaN

export function channelRuns(runs,channel,publishedAt) {
 const windows=TIMELINE_WINDOWS.map(w=>({...w,run_id:w.id,platforms:{}}))
 const gap={run_id:'5to24',label:'5–24 hrs',min:300*MINUTE,max:1440*MINUTE,platforms:{}}
 const unknown={run_id:'unknown',label:'Unknown time',platforms:{}}
 const pub=time(publishedAt)
 for(const run of runs) for(const [key,answer] of Object.entries(run.platforms??{})) {
  if((channel!=='All'&&channelOf(key)!==channel)||(channelOf(key)==='Browser'&&variantOf(key)!=='Original'))continue
  const asked=Number.isFinite(time(answer.asked_at))?time(answer.asked_at):time(run.run_at)
  const lag=asked-pub
  const window=[...windows,gap].find(w=>lag>=w.min&&lag<w.max)??unknown
  const previous=window.platforms[key]
  // Keep the latest capture of each variant in its own interval; never carry
  // responses forward into later intervals or rewrite their stored identities.
  if(!previous||asked>=previous.timeline_at||!Number.isFinite(previous.timeline_at)) {
   window.platforms[key]={...answer,run_id:answer.run_id??run.run_id,timeline_at:asked}
  }
 }
 if(Object.keys(gap.platforms).length)windows.splice(4,0,gap)
 if(Object.keys(unknown.platforms).length)windows.push(unknown)
 return windows
}
export function selectedWindow(windows,id) {
 return windows.find(w=>String(w.run_id)===id)??windows.findLast(w=>Object.keys(w.platforms).length)??windows[0]
}
