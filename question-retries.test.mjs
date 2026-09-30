import test from 'node:test'
import assert from 'node:assert/strict'
import {ObjectId} from './api/node_modules/mongodb/lib/index.js'
import {registerQuestionRetries} from './api/question-retries.js'
test('question retry rejects bad questions, deduplicates clicks and queues only the selected browser question',async()=>{
 const article={_id:new ObjectId(),url:'https://example.com/story',questions:[{question_id:new ObjectId(),question_index:0,question:'Good?'},{question_id:new ObjectId(),question_index:1,question:'Bad?',flagged:true}]}
 const entries=[];const routes={};
 const queue={
  async updateOne(filter,update){if(entries.some(e=>String(e._id)===String(filter._id)))return {upsertedCount:0};entries.push({...filter,...update.$setOnInsert});return {upsertedCount:1}},
  find(){return {sort(){return this},async toArray(){return entries}}},
  async deleteOne(filter){const i=entries.findIndex(e=>String(e._id)===String(filter._id)&&+e.requested_at===+filter.requested_at);if(i<0)return {deletedCount:0};entries.splice(i,1);return {deletedCount:1}}
 }
 const db={collection:name=>name==='articles'?{findOne:async()=>article,find:()=>({toArray:async()=>[article]})}:queue}
 const app=Object.fromEntries(['post','get','delete'].map(method=>[method,(path,fn)=>routes[method+path]=fn]))
 registerQuestionRetries(app,db)
 const call=async(key,req)=>{let code=200,body;await routes[key](req,{status(n){code=n;return this},json(b){body=b}});return {code,body}}
 const post=index=>call('post/api/articles/:id/questions/:index/retry',{params:{id:String(article._id),index:String(index)}})
 assert.equal((await post(1)).code,400)
 assert.equal((await post(0)).code,201)
 assert.equal((await post(0)).body.already_queued,true)
 const result=await call('get/api/question-retry-queue',{})
 assert.deepEqual(result.body.items[0].questions,[{question_id:article.questions[0].question_id,question:'Good?',answer:undefined}])
 assert.deepEqual(result.body.items[0].platforms,['google','chatgpt','claude','perplexity'])
 const id=String(article.questions[0].question_id)
 await call('delete/api/question-retry-queue/:id',{params:{id},query:{requested_at:new Date(0).toISOString()}})
 assert.equal(entries.length,1)
 await call('delete/api/question-retry-queue/:id',{params:{id},query:{requested_at:entries[0].requested_at.toISOString()}})
 assert.equal(entries.length,0)
})
