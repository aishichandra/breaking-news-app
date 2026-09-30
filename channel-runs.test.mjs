import test from 'node:test'
import assert from 'node:assert/strict'
import {channelRuns,selectedWindow} from './web/src/lib/channel-runs.js'
const pub='2026-09-28T12:00:00Z'
const stamp=min=>new Date(Date.parse(pub)+min*60000).toISOString()
const run=(id,platform,min)=>({run_id:id,run_at:stamp(min),platforms:{[platform]:{_id:id,answer:id,asked_at:stamp(min)}}})
test('retries merge by platform within a window, preserving stored IDs and channel isolation',()=>{
 const runs=[run('browser','chatgpt',2),run('a','gpt4o-no-search',28),run('b','claude-sonnet4-web-search',28),run('c','gpt4o-no-search',29),run('next','gpt4o-web-search',31),run('old-browser-variant','chatgpt-recent-news',4)]
 const api=channelRuns(runs,'API',pub),browser=channelRuns(runs,'Browser',pub)
 assert.deepEqual(Object.keys(api[1].platforms),['gpt4o-no-search','claude-sonnet4-web-search'])
 assert.equal(api[1].platforms['gpt4o-no-search'].run_id,'c')
 assert.equal(api[2].platforms['gpt4o-no-search'],undefined)
 assert.deepEqual(Object.keys(browser[0].platforms),['chatgpt'])
 assert.equal(selectedWindow(browser,'').run_id,'under15')
 assert.equal(selectedWindow(api,'').run_id,'30to60')
 assert.equal(selectedWindow(api,'under15').run_id,'under15')
 assert.equal(runs[2].platforms['claude-sonnet4-web-search'].run_id,undefined)
})
test('exact interval boundaries and 24-hour rule preserve gap and unknown captures',()=>{
 const mins=[0,15,30,60,300,1440]
 const windows=channelRuns(mins.map((m,i)=>run(String(i),'chatgpt',m)),'Browser',pub)
 assert.deepEqual(windows.map(w=>w.platforms.chatgpt.run_id),['0','1','2','3','4','5'])
 assert.equal(windows.at(-1).label,'1 day')
 const unknown=channelRuns([run('bad','chatgpt',-1)],'Browser',pub)
 assert.equal(unknown.at(-1).label,'Unknown time')
 assert.equal(unknown.at(-1).platforms.chatgpt.run_id,'bad')
 assert.equal(channelRuns([],'API',pub).length,5)
})
