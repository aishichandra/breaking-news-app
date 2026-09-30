import {ObjectId} from 'mongodb'
import {randomUUID} from 'node:crypto'
import {callJudge,judgeInput,judgeFingerprint,JUDGE_VERSION} from './judge-core.mjs'
export async function registerJudge(app,db,{onUpdate=()=>{},key=process.env.OPENROUTER_API_KEY,model=process.env.JUDGE_MODEL||'deepseek/deepseek-v4.1-flash',evaluate=callJudge}={}){
 const answers=db.collection('answers'),settings=db.collection('judge_settings')
 await settings.updateOne({_id:'accuracy'},{$setOnInsert:{automatic:true}},{upsert:true})
 let automatic=(await settings.findOne({_id:'accuracy'})).automatic===true,busy=false,cooldownUntil=0
 function prepare(docs){return docs.map(doc=>({...doc,...(key&&automatic&&doc.answer?.trim()?{judge:{status:'queued',requested_at:new Date()}}:{})}))}
 async function context(id){const answer=await answers.findOne({_id:new ObjectId(id)});if(!answer||answer.deleted_at)throw Error('Answer not found');const article=await db.collection('articles').findOne({_id:answer.article_id});const input=judgeInput(answer,article);return {answer,input,fingerprint:judgeFingerprint(input)}}
 function changed(id,fields){onUpdate(String(id),fields)}
 async function processOne(){
  if(busy||!key||Date.now()<cooldownUntil)return
  busy=true
  let claimed
  const token=randomUUID()
  try{
   // Discover historical and edited answers server-side, even when no dashboard is open.
   const eligible=[{'judge.status':'retry_pending','judge.retry_at':{$lt:new Date()}},{'judge.status':'queued'},{'judge.status':'running','judge.lease_until':{$lt:new Date()}}]
   if(automatic)eligible.push({'judge.status':null,answer:{$regex:'\\S'}},{'judge.status':'stale',answer:{$regex:'\\S'}})
   claimed=await answers.findOneAndUpdate({deleted_at:null,$or:eligible},{$set:{'judge.status':'running','judge.token':token,'judge.lease_until':new Date(Date.now()+120000)}},{returnDocument:'after',sort:{_id:1}})
   if(!claimed)return
   changed(claimed._id,{'judge.status':'running'})
   const {input,fingerprint}=await context(claimed._id)
   const assessment=await evaluate(input,{key,model})
   const fresh=await context(claimed._id)
   const judge={...assessment,status:fresh.fingerprint===fingerprint?'complete':'stale',model,rubric:JUDGE_VERSION,input_fingerprint:fingerprint,judged_at:new Date(),reference_answer:input.expected_answer}
   const saved=await answers.updateOne({_id:claimed._id,'judge.token':token,'judge.status':'running',answer:claimed.answer},{$set:{judge}})
   if(saved.matchedCount)changed(claimed._id,{judge})
  }catch(error){
   if(error.retryable)cooldownUntil=Date.now()+300000
   if(claimed){const judge={status:error.retryable?'retry_pending':'error',...(error.retryable?{retry_at:new Date(cooldownUntil)}:{}),error:error.name==='TimeoutError'?'Judge timed out; try again':String(error.message).slice(0,300),model,rubric:JUDGE_VERSION};const saved=await answers.updateOne({_id:claimed._id,'judge.token':token,'judge.status':'running'},{$set:{judge}});if(saved.matchedCount)changed(claimed._id,{judge})}
   else console.error('Judge queue unavailable:',error.message)
  }finally{busy=false}
 }
 app.get('/api/judge/settings',(req,res)=>res.json({configured:!!key,automatic,model}))
 app.put('/api/judge/settings',async(req,res)=>{if(typeof req.body?.automatic!=='boolean')return res.status(400).json({error:'automatic must be true or false'});try{await settings.updateOne({_id:'accuracy'},{$set:{automatic:req.body.automatic}});automatic=req.body.automatic;res.json({configured:!!key,automatic,model})}catch{res.status(500).json({error:'Could not save judge setting'})}})
 app.post('/api/answers/:id/judge',async(req,res)=>{
  if(!ObjectId.isValid(req.params.id))return res.status(400).json({error:'Invalid answer id'})
  if(!key)return res.status(503).json({error:'Configure OPENROUTER_API_KEY on the app server to enable the judge'})
  try{const {answer,fingerprint}=await context(req.params.id);if(['queued','running'].includes(answer.judge?.status))return res.json(answer.judge);if(answer.judge?.status==='complete'&&answer.judge.input_fingerprint===fingerprint)return res.json(answer.judge)
   const judge={status:'queued',requested_at:new Date()};const saved=await answers.updateOne({_id:answer._id,'judge.status':{$nin:['queued','running']}},{$set:{judge}});if(!saved.matchedCount)return res.status(409).json({error:'Answer changed; refresh and try again'});changed(answer._id,{judge});res.status(202).json(judge);void processOne()
  }catch(error){res.status(400).json({error:error.message})}
 })
 app.get('/api/answers/:id/judge',async(req,res)=>{if(!ObjectId.isValid(req.params.id))return res.status(400).json({error:'Invalid answer id'});try{const {answer,fingerprint}=await context(req.params.id);const judge=answer.judge??null;res.json(judge?.status==='complete'&&judge.input_fingerprint!==fingerprint?{...judge,status:'stale'}:judge)}catch(error){res.status(400).json({error:error.message})}})
 app.post('/api/answers/:id/judge/accept',async(req,res)=>{
  if(!ObjectId.isValid(req.params.id))return res.status(400).json({error:'Invalid answer id'})
  try{const {answer,fingerprint}=await context(req.params.id);const judge=answer.judge;if(judge?.status!=='complete'||judge.verdict==='needs_review'||judge.input_fingerprint!==fingerprint)return res.status(409).json({error:'No current actionable suggestion; run the judge again or grade manually'})
   const fields={verdict:judge.verdict,graded_at:new Date(),confidence:null,'judge.accepted_at':new Date()}
   const saved=await answers.updateOne({_id:answer._id,verdict:null,answer:answer.answer,'judge.input_fingerprint':fingerprint,'judge.status':'complete'},{$set:fields})
   if(!saved.matchedCount)return res.status(409).json({error:'A human grade or newer edit already exists; refresh and review'})
   changed(answer._id,{verdict:judge.verdict,graded_at:fields.graded_at,confidence:null,judge:{...judge,accepted_at:fields['judge.accepted_at']}});res.json({verdict:judge.verdict})
  }catch(error){res.status(400).json({error:error.message})}
 })
 const timer=setInterval(()=>void processOne(),5000);timer.unref()
 return {prepare,processOne,stop:()=>clearInterval(timer)}
}
