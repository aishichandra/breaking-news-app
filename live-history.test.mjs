import test from 'node:test'
import assert from 'node:assert/strict'
import {createLiveHistory} from './api/live-history.js'
test('cold requests share a read; stale reads return immediately and refresh once',async()=>{
 let now=0,calls=0,finish
 const c=createLiveHistory(()=>++calls===1?'first':new Promise(r=>finish=r),{now:()=>now,maxAge:30})
 assert.deepEqual(await Promise.all([c.get(),c.get()]),['first','first']);assert.equal(calls,1)
 now=31;assert.equal(await c.get(),'first');assert.equal(await c.get(),'first');assert.equal(calls,2);assert.equal(c.status().refreshing,true)
 finish('fresh');await new Promise(r=>setImmediate(r));assert.equal(await c.get(),'fresh');assert.equal(c.status().refreshing,false)
})
test('edits fence background reads and invalidation reloads instead of retaining stale data',async()=>{
 let now=0,finish,calls=0
 const c=createLiveHistory(()=>++calls===1?'first':calls===2?new Promise(r=>finish=r):'reloaded',{now:()=>now,maxAge:30})
 await c.get();now=31;await c.get();c.update(()=> 'edited');now=0;finish('outdated');await new Promise(r=>setImmediate(r));assert.equal(await c.get(),'edited')
 c.clear();assert.equal(await c.get(),'reloaded')
})
test('failed refresh preserves history and reports error; cold failure can retry',async()=>{
 let now=0,calls=0,errors=[]
 const c=createLiveHistory(()=>{if(++calls===2)throw Error('offline');return 'ok'},{now:()=>now,maxAge:30,onError:e=>errors.push(e.message)})
 await c.get();now=31;assert.equal(await c.get(),'ok');await new Promise(r=>setImmediate(r));assert.deepEqual(errors,['offline']);assert.equal(await c.get(),'ok')
 const cold=createLiveHistory(()=>{throw Error('offline')});await assert.rejects(cold.get(),/offline/);assert.equal(cold.status().refreshing,false)
})

test('ingestion invalidation serves cached history immediately and shares a background refresh',async()=>{
 let calls=0,finish
 const c=createLiveHistory(()=>++calls===1?'saved':new Promise(r=>finish=r))
 await c.get();c.invalidate()
 assert.equal(await c.get(),'saved');assert.equal(await c.get(),'saved');assert.equal(calls,2)
 finish('new answers');await new Promise(r=>setImmediate(r))
 assert.equal(await c.get(),'new answers')
})
test('overlapping ingestion publishes progress then refreshes again; fresh reads bypass cache',async()=>{
 let calls=0,finish
 const c=createLiveHistory(()=>++calls===1?'saved':calls===2?new Promise(r=>finish=r):'current')
 await c.get();c.invalidate();await c.get();c.invalidate();finish('outdated')
 await new Promise(r=>setImmediate(r))
 assert.equal(await c.get(),'outdated')
 await new Promise(r=>setImmediate(r))
 assert.equal(await c.get({fresh:true}),'current')
})
