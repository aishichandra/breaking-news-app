import test from 'node:test'
import assert from 'node:assert/strict'
import {createReviewCache,updateCachedAnswer} from './api/review-cache.js'
test('review cache shares concurrent reads and reuses the completed history', async()=>{
 let calls=0
 const cache=createReviewCache(async()=>{calls++; return 'history'})
 assert.deepEqual(await Promise.all([cache.get(),cache.get()]),['history','history'])
 assert.equal(await cache.get(),'history'); assert.equal(calls,1)
 cache.clear(); await cache.get(); assert.equal(calls,2)
})
test('writes prevent an older in-flight read from replacing fresh history',async()=>{
 let finish; let calls=0
 const cache=createReviewCache(()=>++calls===1?new Promise(r=>finish=r):'fresh')
 const old=cache.get(); await Promise.resolve(); cache.clear()
 assert.equal(await cache.get(),'fresh'); finish('old'); await old
 assert.equal(await cache.get(),'fresh')
})
test('failed reads can be retried',async()=>{
 let calls=0; const cache=createReviewCache(()=>{if(++calls===1)throw Error('offline');return 'ok'})
 await assert.rejects(cache.get(),/offline/); assert.equal(await cache.get(),'ok')
})

import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
test('saved history survives restart, updates persist, invalidation removes disk copy',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'review-cache-test-'));const file=path.join(dir,'cache.json')
 try {
  const first=createReviewCache(async()=> 'old',file);await first.get()
  const second=createReviewCache(async()=>{throw Error('unnecessary fetch')},file)
  assert.equal(await second.get(),'old');second.update(()=> 'new')
  assert.equal(await createReviewCache(async()=> 'fallback',file).get(),'new')
  second.clear();assert.equal(await createReviewCache(async()=> 'fresh',file).get(),'fresh')
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('answer edits update latest and run copies, preserving unrelated answers',()=>{
 const body=JSON.stringify([{questions:[{platforms:{a:{_id:'1',verdict:'correct'},b:{_id:'2'}},runs:[{platforms:{a:{_id:'1',verdict:'correct'}}}]}]}])
 const q=JSON.parse(updateCachedAnswer(body,'1',{verdict:null,confidence:null}))[0].questions[0]
 assert.equal(q.platforms.a.verdict,null);assert.equal(q.runs[0].platforms.a.verdict,null);assert.deepEqual(q.platforms.b,{_id:'2'})
})
