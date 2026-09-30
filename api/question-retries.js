import {ObjectId} from 'mongodb'
const BROWSERS=['google','chatgpt','claude','perplexity']
export function registerQuestionRetries(app,db){
 const queue=db.collection('question_retry_queue')
 app.post('/api/articles/:id/questions/:index/retry',async(req,res)=>{
  try{
   const {id,index}=req.params
   if(!ObjectId.isValid(id)||!/^\d+$/.test(index))return res.status(400).json({error:'Invalid question'})
   const article=await db.collection('articles').findOne({_id:new ObjectId(id),deleted_at:{$exists:false}})
   const q=article?.questions?.find((q,i)=>(q.question_index??i)===Number(index))
   if(!q)return res.status(404).json({error:'Question not found'})
   if(q.flagged)return res.status(400).json({error:'Bad questions cannot be retried'})
   let inserted=false
   try{
    const result=await queue.updateOne({_id:q.question_id},{$setOnInsert:{article_id:article._id,requested_at:new Date()}},{upsert:true})
    inserted=result.upsertedCount>0
   }catch(err){if(err.code!==11000)throw err}
   res.status(inserted?201:200).json({queued:true,already_queued:!inserted})
  }catch(err){console.error(err);res.status(500).json({error:'Could not queue question retry'})}
 })
 app.get('/api/question-retry-queue',async(req,res)=>{
  try{
   const entries=await queue.find().sort({requested_at:1}).toArray()
   const articles=await db.collection('articles').find({_id:{$in:entries.map(e=>e.article_id)},deleted_at:{$exists:false}}).toArray()
   res.json({items:entries.map(e=>{
    const a=articles.find(a=>String(a._id)===String(e.article_id))
    const q=a?.questions?.find(q=>String(q.question_id)===String(e._id)&&!q.flagged)
    return {retry_id:e._id,requested_at:e.requested_at,url:a?.url,published_at:a?.published_at,exclusive:a?.exclusive,platforms:BROWSERS,questions:q?[{question_id:q.question_id,question:q.question,answer:q.answer}]:[]}
   })})
  }catch(err){console.error(err);res.status(500).json({error:'Could not read question retries'})}
 })
 app.delete('/api/question-retry-queue/:id',async(req,res)=>{
  try{
   const date=new Date(req.query.requested_at)
   if(!ObjectId.isValid(req.params.id)||Number.isNaN(date.getTime()))return res.status(400).json({error:'Invalid retry reference'})
   const result=await queue.deleteOne({_id:new ObjectId(req.params.id),requested_at:date})
   res.json({removed:result.deletedCount>0})
  }catch(err){console.error(err);res.status(500).json({error:'Could not complete retry'})}
 })
}
export async function attachQuestionRetries(db,articles){
 const pending=await db.collection('question_retry_queue').find().toArray()
 const ids=new Set(pending.map(e=>String(e._id)))
 for(const a of articles)for(const q of a.questions??[])q.retry_queued=ids.has(String(q.question_id))
 return articles
}
