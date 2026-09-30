import test from 'node:test'
import assert from 'node:assert/strict'
import {allowedOrigin,requestSecurity,assertAuthentication} from './api/security.js'
import {validateIngestion,resolveQuestion,ingestionRunId,answerUpserts} from './api/ingestion.js'
import {normalizeEntry,buildQuestions} from './api/normalize.js'
import {safeHttpUrl} from './safe-url.mjs'
const req=(headers,method='POST')=>({method,get:name=>headers[name]})
test('production requires credentials and rejects cross-site writes while allowing the collection client',()=>{
 assert.throws(()=>assertAuthentication({RAILWAY_ENVIRONMENT_ID:'production'}))
 assert.doesNotThrow(()=>assertAuthentication({NODE_ENV:'production',AUTH_PASSWORD:'test-only'}))
 assert.equal(allowedOrigin(req({Host:'app.example',Origin:'https://evil.example'}),{NODE_ENV:'production'}),false)
 assert.equal(allowedOrigin(req({Host:'app.example',Origin:'https://app.example'}),{NODE_ENV:'production'}),true)
 assert.equal(allowedOrigin(req({Host:'app.example',Origin:'http://localhost:3000'}),{NODE_ENV:'production'}),false)
 for(const [headers,expected] of [[{Host:'app.example',Origin:'https://evil.example'},403],[{Host:'app.example','Sec-Fetch-Site':'cross-site'},403],[{Host:'app.example'},200]]){
  let status=200,passed=false;const res={set(){},status(n){status=n;return this},json(){}}
  requestSecurity({NODE_ENV:'production'})(req(headers),res,()=>passed=true)
  assert.equal(status,expected);assert.equal(passed,expected===200)
 }
})
test('explicit mismatched question text never falls back to positional identity',()=>{
 const stored=[{question:'ProPublica question',question_id:'right'}]
 assert.equal(resolveQuestion(stored,'Bloomberg question',0,{allowPosition:true}),undefined)
 assert.equal(resolveQuestion(stored,'  propublica   question ',0)?.question_id,'right')
 assert.equal(resolveQuestion(stored,'',0,{allowPosition:true})?.question_id,'right')
})
test('replayed ingestion keeps stable identities and never overwrites human edits',()=>{
 const at=new Date('2026-09-28T12:00:00Z')
 const a=ingestionRunId('article',at,true),b=ingestionRunId('article',at,true)
 assert.equal(String(a),String(b))
 assert.notEqual(String(a),String(ingestionRunId('other',at,true)))
 const doc={question_id:'q',run_id:a,platform:'chatgpt',answer:'captured',verdict:null}
 const [first]=answerUpserts([doc]),[retry]=answerUpserts([{...doc,answer:'changed'}])
 assert.equal(String(first.updateOne.filter._id),String(retry.updateOne.filter._id))
 assert.equal(retry.updateOne.update.$set,undefined)
 assert.ok(retry.updateOne.update.$setOnInsert)
})
test('normalization preserves evidence metadata and rejects malformed or executable content',()=>{
 assert.throws(()=>validateIngestion({url:{$ne:null}}))
 assert.throws(()=>validateIngestion({url:'https://example.com',run_at:'not-a-date'}))
 assert.equal(safeHttpUrl('javascript:alert(1)'),null)
 assert.equal(safeHttpUrl('https://user:password@example.com'),null)
 assert.throws(()=>normalizeEntry({chatgpt:{answer:{bad:'type'}}}))
 assert.throws(()=>buildQuestions([],[{question_index:-1,question:'Q'}]))
 const [row]=normalizeEntry({'gpt4o-web-search':{answer:'test',model:'openai/current-model',search:'tool',url:'javascript:alert(1)',citations:[null,{url:'data:text/html,bad'},{url:'https://example.com',label:'Source'}]}})
 assert.equal(row.model,'openai/current-model');assert.equal(row.search,'tool');assert.equal(row.url,null);assert.equal(row.citations.length,1)
 const screenshot=normalizeEntry({google:{screenshot_id:'123456789012345678901234'}})
 assert.equal(screenshot.length,1)
})
