import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {randomBytes} from 'node:crypto'
import assert from 'node:assert/strict'
import {MongoClient} from '../api/node_modules/mongodb/lib/index.js'
const cwd=fileURLToPath(new URL('..',import.meta.url))
if(!process.env.TEST_MONGODB_URI)throw new Error('Set TEST_MONGODB_URI to a MongoDB cluster that permits disposable test databases')
const env={MONGODB_URI:process.env.TEST_MONGODB_URI}
const name='breaking_news_audit_'+randomBytes(6).toString('hex')
const password=randomBytes(18).toString('hex')
const mongo=new MongoClient(env.MONGODB_URI)
let child,output=''
try{
 await mongo.connect()
 child=spawn(process.execPath,['api/server.js'],{cwd,env:{PATH:process.env.PATH,NODE_ENV:'test',PORT:'13087',MONGODB_URI:env.MONGODB_URI,MONGODB_DB:name,AUTH_USER:'audit',AUTH_PASSWORD:password},stdio:['ignore','pipe','pipe']})
 child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d)
 const base='http://127.0.0.1:13087'
 for(let i=0;i<100;i++){
  if(child.exitCode!==null)throw Error('Test server exited: '+output)
  try{if((await fetch(base+'/api/health')).ok)break}catch{}
  await new Promise(r=>setTimeout(r,100))
 }
 const auth='Basic '+Buffer.from('audit:'+password).toString('base64')
 async function call(path,method='GET',body,extra={}){
  const r=await fetch(base+path,{method,headers:{Authorization:auth,'Content-Type':'application/json',...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:r.status===204?null:await r.json()}
 }
 assert.equal((await fetch(base+'/api/articles')).status,401)
 const payload={url:'https://example.com/audit',published_at:'2026-09-28T12:00:00Z',run_at:'2026-09-28T12:01:00Z',questions:[{question:'First?',answer:'A'},{question:'Second?',answer:'B'}],platform_answers:[{question:'First?',question_index:0,chatgpt:{answer:'A',timestamp:'2026-09-28T12:01:00Z',model:'test/model',search:'none'}},{question:'Second?',question_index:1,claude:{answer:'B'}}]}
 assert.equal((await call('/api/articles','POST',payload,{Origin:'https://attacker.example'})).status,403)
 assert.equal((await call('/api/articles','POST',{...payload,run_at:'invalid'})).status,400)
 assert.equal(await mongo.db(name).collection('articles').countDocuments(),0)
 const first=await call('/api/articles','POST',payload);assert.equal(first.status,201)
 const data=(await call('/api/articles?fresh=1')).body
 const answer=data[0].questions[0].runs[0].platforms.chatgpt
 assert.equal(answer.model,'test/model')
 assert.equal((await call('/api/answers/'+answer._id,'PATCH',{verdict:'correct'})).status,200)
 const replay=await Promise.all([call('/api/articles','POST',payload),call('/api/articles','POST',payload)])
 assert.ok(replay.every(r=>r.status===200))
 assert.equal(await mongo.db(name).collection('answers').countDocuments(),2)
 assert.equal((await mongo.db(name).collection('answers').findOne({_id:new (await import('../api/node_modules/mongodb/lib/index.js')).ObjectId(answer._id)})).verdict,'correct')
 const id=first.body.article_id
 assert.equal((await call(`/api/articles/${id}/questions/1`,'PATCH',{flagged:true})).status,200)
 assert.equal((await call(`/api/articles/${id}/questions/1/retry`,'POST')).status,400)
 await call('/api/articles','POST',{...payload,run_at:'2026-09-28T12:02:00Z',questions:[{question:'Second?',answer:'B'}],platform_answers:[{question:'Second?',question_index:0,chatgpt:{answer:'must not land on First'}}]})
 assert.equal(await mongo.db(name).collection('answers').countDocuments(),2)
 assert.equal((await call('/api/export.json')).body.answers.length,1)
 assert.equal((await call(`/api/articles/${id}/questions/0/retry`,'POST')).status,201)
 assert.equal((await call(`/api/articles/${id}/questions/0/retry`,'POST')).body.already_queued,true)
 assert.equal((await call('/api/question-retry-queue')).body.items[0].questions[0].question,'First?')
 const summaries=await call('/api/article-summaries?limit=1')
 assert.equal(summaries.status,200)
 assert.equal(summaries.body.items[0].questions[0].answers_loaded,false)
 assert.equal(summaries.body.items[0].questions[0].runs[0].platforms.chatgpt.answer,undefined)
 const qid=data[0].questions[0].question_id
 const history=await call(`/api/articles/${id}/questions/${qid}/history`)
 assert.equal(history.body.runs[0].platforms.chatgpt.answer,'A')
 assert.equal((await call('/api/article-summaries?limit=999')).status,400)
 const concurrent={...payload,questions:[{question:'Third?',answer:'C'}],platform_answers:[]}
 const additions=await Promise.all([call('/api/articles','POST',concurrent),call('/api/articles','POST',concurrent)])
 assert.ok(additions.every(r=>[200,409].includes(r.status)))
 const after=(await call('/api/articles?fresh=1')).body[0]
 assert.equal(after.questions.filter(q=>q.question==='Third?').length,1)
 assert.equal((await call('/api/articles','POST',{...payload,questions:[{question_id:qid,question:'Changed?',answer:'A'}],platform_answers:[]})).status,400)
 assert.ok(await mongo.db(name).collection('review_audit').countDocuments({phase:'intent'})>0)
 assert.equal((await call(`/api/articles/${id}`,'DELETE')).status,204)
 assert.equal((await call('/api/articles','POST',payload)).status,410)
 assert.equal((await call('/api/article-summaries')).body.items.length,0)
 assert.equal((await call('/api/export.json')).body.answers.length,0)
 assert.ok((await call('/api/collection-targets')).body[0].deleted_at)
 assert.equal((await call('/api/question-retry-queue')).body.items.length,0)
 console.log('PASS: pagination, lazy answers, append races, stable IDs, deletion tombstones, audit trail, authentication, cross-origin rejection, pre-write validation, replay deduplication, preserved grades/model metadata, flagged subset isolation, export and question retries')
}finally{
 if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve))}
 // Only the randomly named database created by this test is removed.
 if(!name.startsWith('breaking_news_audit_'))throw Error('Unsafe cleanup name')
 await mongo.db(name).dropDatabase();await mongo.close()
 console.log('Isolated test database removed; production records untouched')
}
