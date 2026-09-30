import test from 'node:test'
import assert from 'node:assert/strict'
import {ObjectId} from './api/node_modules/mongodb/lib/index.js'
import {judgeInput,judgeFingerprint,validateJudgment,judgeRequest,callJudge} from './api/judge-core.mjs'
import {registerJudge} from './api/judge.js'
import {updateCachedAnswer} from './api/review-cache.js'
const article={_id:new ObjectId(),snippet:'Revenue reached $1 billion.',questions:[{question_id:new ObjectId(),question:'What was revenue?',answer:'$1 billion'}]}
const answer={_id:new ObjectId(),article_id:article._id,question_id:article.questions[0].question_id,answer:'$1 billion',verdict:null}
const assessment={verdict:'correct',confidence:'high',rationale:'The answer matches the reference amount.'}
test('judge uses reference evidence, excludes provider identity and validates output',async()=>{
 const input=judgeInput({...answer,platform:'chatgpt',note:'human note'},article)
 assert.equal(input.expected_answer,'$1 billion');assert.equal(input.platform,undefined);assert.equal(input.note,undefined)
 const payload=judgeRequest(input,'test/model');assert.equal(payload.tools,undefined);assert.equal(payload.response_format.type,'json_schema')
 assert.match(payload.messages[0].content,/untrusted evidence/)
 assert.throws(()=>validateJudgment({...assessment,verdict:'maybe'}));assert.throws(()=>judgeInput({...answer,answer:''},article));assert.throws(()=>judgeInput(answer,{...article,deleted_at:new Date()}))
 assert.notEqual(judgeFingerprint(input),judgeFingerprint({...input,expected_answer:'$2 billion'}))
 assert.deepEqual(await callJudge(input,{key:'fake',model:'test/model',fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(assessment)}}]})})}),assessment)
 await assert.rejects(callJudge(input,{key:'fake',model:'test/model',fetchImpl:async()=>({ok:false,status:429,json:async()=>({})})}),/429/)
})
function path(obj,key){return key.split('.').reduce((o,k)=>o?.[k],obj)}
function equal(a,b){return a===b||(a instanceof ObjectId&&b instanceof ObjectId&&String(a)===String(b))}
function matches(doc,q){return Object.entries(q).every(([k,v])=>k==='$or'?v.some(x=>matches(doc,x)):v&&typeof v==='object'&&!(v instanceof ObjectId)?Object.entries(v).every(([op,x])=>op==='$nin'?!x.includes(path(doc,k)):op==='$lt'?path(doc,k)<x:op==='$regex'?typeof path(doc,k)==='string'&&new RegExp(x).test(path(doc,k)):false):v===null?path(doc,k)==null:equal(path(doc,k),v))}
function set(doc,fields){for(const [key,value] of Object.entries(fields)){const p=key.split('.');let o=doc;for(const k of p.slice(0,-1))o=o[k]??={};o[p.at(-1)]=value}}
async function setup(evaluate=async()=>assessment){
 const docs={answers:[{...answer}],articles:[structuredClone(article)],judge_settings:[]};docs.articles=[{...article,questions:article.questions.map(q=>({...q}))}]
 const db={collection:name=>({findOne:async q=>docs[name].find(d=>matches(d,q))??null,updateOne:async(q,u,options)=>{let d=docs[name].find(d=>matches(d,q));const existed=!!d;if(!d&&options?.upsert){d={...q};docs[name].push(d);set(d,u.$setOnInsert??{})}if(d){set(d,u.$set??{});return {matchedCount:existed?1:0}}return {matchedCount:0}},findOneAndUpdate:async(q,u)=>{const d=docs[name].find(d=>matches(d,q));if(!d)return null;set(d,u.$set);return {...d}}})}
 const routes=new Map(),app=Object.fromEntries(['get','post','put'].map(method=>[method,(url,fn)=>routes.set(method+url,fn)]))
 const service=await registerJudge(app,db,{key:'fake',model:'test/model',evaluate})
 async function invoke(method,url,body={}){let status=200,value;await routes.get(method+url)({params:{id:String(answer._id)},body},{status(n){status=n;return this},json(v){value=v;return this}});return {status,value}}
 return {docs,service,invoke}
}
test('automatic suggestions never set verdict; accepting requires an unchanged ungraded answer',async()=>{
 const {docs,service,invoke}=await setup()
 try{
  docs.answers=service.prepare(docs.answers);assert.equal(docs.answers[0].judge.status,'queued')
  await service.processOne();assert.equal(docs.answers[0].judge.status,'complete');assert.equal(docs.answers[0].verdict,null)
  docs.articles[0].questions[0].answer='$2 billion'
  assert.equal((await invoke('post','/api/answers/:id/judge/accept')).status,409)
  docs.articles[0].questions[0].answer='$1 billion';docs.answers[0].verdict='incorrect'
  assert.equal((await invoke('post','/api/answers/:id/judge/accept')).status,409)
  docs.answers[0].verdict=null
  assert.equal((await invoke('post','/api/answers/:id/judge/accept')).status,200)
  assert.equal(docs.answers[0].verdict,'correct');assert.equal(docs.answers[0].confidence,null)
  assert.equal(service.prepare([{...answer,verdict:'incorrect'}])[0].judge.status,'queued')
  await invoke('put','/api/judge/settings',{automatic:false});assert.equal(service.prepare([answer])[0].judge,undefined)
 }finally{service.stop()}
})
test('changed references and provider failures cannot produce a current actionable grade',async()=>{
 let fixture=await setup(async()=>{fixture.docs.articles[0].questions[0].answer='$3 billion';return assessment})
 try{fixture.docs.answers=fixture.service.prepare(fixture.docs.answers);await fixture.service.processOne();assert.equal(fixture.docs.answers[0].judge.status,'stale');assert.equal(fixture.docs.answers[0].verdict,null)}finally{fixture.service.stop()}
 const failed=await setup(async()=>{throw Error('Provider unavailable')})
 try{failed.docs.answers=failed.service.prepare(failed.docs.answers);await failed.service.processOne();assert.equal(failed.docs.answers[0].judge.status,'error');assert.equal(failed.docs.answers[0].verdict,null)}finally{failed.service.stop()}
})
test('cached suggestions invalidate nested status after an answer edit',()=>{
 const body=JSON.stringify([{questions:[{platforms:{chatgpt:{_id:'a',judge:{status:'complete',verdict:'correct'}}}}]}])
 const result=JSON.parse(updateCachedAnswer(body,'a',{'judge.status':'stale'}))
 assert.equal(result[0].questions[0].platforms.chatgpt.judge.status,'stale')
})

test('background discovery judges historical answers without clicks and preserves existing grades and suggestions',async()=>{
 let calls=0
 const {docs,service,invoke}=await setup(async()=>{calls++;return assessment})
 try{
  const oldSuggestion={status:'complete',verdict:'incorrect',model:'previous/model'}
  docs.answers.push({...answer,_id:new ObjectId(),verdict:'incorrect'}, {...answer,_id:new ObjectId(),judge:oldSuggestion}, {...answer,_id:new ObjectId(),answer:'   '})
  await invoke('put','/api/judge/settings',{automatic:false})
  await service.processOne();assert.equal(calls,0)
  await invoke('put','/api/judge/settings',{automatic:true})
  await service.processOne();assert.equal(calls,1)
  assert.equal(docs.answers[0].judge.status,'complete');assert.equal(docs.answers[0].verdict,null)
  await service.processOne();assert.equal(calls,2)
  assert.equal(docs.answers[1].judge.status,'complete')
  assert.equal(docs.answers[1].verdict,'incorrect');assert.deepEqual(docs.answers[2].judge,oldSuggestion)
  docs.answers[0].judge.status='stale'
  await service.processOne();assert.equal(calls,3);assert.equal(docs.answers[0].judge.status,'complete')
 }finally{service.stop()}
})

import {permitted} from './api/auth.js'
test('disabled judge actions are not available to reviewers',()=>{
 assert.equal(permitted('reviewer','POST','/api/answers/123/judge/accept'),false)
 assert.equal(permitted('reviewer','POST','/api/answers/123/judge'),false)
 assert.equal(permitted('viewer','POST','/api/answers/123/judge/accept'),false)
 assert.equal(permitted('collector','POST','/api/answers/123/judge'),false)
 assert.equal(permitted('reviewer','PUT','/api/judge/settings'),false)
})

test('provider spending limits retain pending work with cooldown and no human grade changes',async()=>{
 await assert.rejects(callJudge({}, {key:'fake',model:'test/model',fetchImpl:async()=>({ok:false,status:403,json:async()=>({error:{message:'Key limit exceeded (total limit).'}})})}), e=>e.retryable && /spending limit/.test(e.message))
 let calls=0
 const {service,docs}=await setup(async()=>{calls++;throw Object.assign(new Error('spending limit'),{retryable:true})})
 try{
  await service.processOne();assert.equal(docs.answers[0].judge.status,'retry_pending')
  await service.processOne();assert.equal(calls,1);assert.equal(docs.answers[0].verdict,null)
 }finally{service.stop()}
})
