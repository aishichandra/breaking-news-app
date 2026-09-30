import test from 'node:test'
import assert from 'node:assert/strict'
import {headlineObservations,articleHeadlines} from './article-headlines.mjs'
test('saved headlines preserve chronology, unchanged captures and reverted titles',()=>{
 const rows=[['A','2026-09-01'],['A','2026-09-02'],['B','2026-09-03'],['A','2026-09-04']].map(([headline,observed_at])=>({headline,observed_at}))
 assert.deepEqual(articleHeadlines({headline_history:rows.reverse()}).map(x=>x.headline),['A','B','A'])
 assert.equal(articleHeadlines({headline_history:rows}).at(-1).observed_at,'2026-09-04T00:00:00.000Z')
})
test('old payloads and unknown capture dates remain compatible',()=>{
 assert.deepEqual(articleHeadlines({}),[])
 assert.deepEqual(headlineObservations({headline:' Saved title '}),[{headline:'Saved title',observed_at:null}])
 assert.throws(()=>headlineObservations({headline_history:[{headline:'x',observed_at:'invalid'}]}))
 assert.throws(()=>headlineObservations({headline:{}}))
 assert.throws(()=>headlineObservations({headline_history:Array(501).fill({headline:'x'})}))
})
