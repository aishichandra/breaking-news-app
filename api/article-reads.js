import {ObjectId} from 'mongodb'
export function pageOptions(query) {
  const limit=Number(query.limit??12)
  if(!Number.isInteger(limit)||limit<1||limit>50)throw new Error('limit must be 1–50')
  if(query.before&&!/^[a-f0-9]{24}$/i.test(query.before))throw new Error('Invalid cursor')
  return {limit, before:query.before?new ObjectId(query.before):null}
}
export function registerArticleReads(app,db,deps){
 const {attachAnswers,attachSourceDates,attachReaskQueue,attachQuestionRetries}=deps
 app.get('/api/article-summaries',async(req,res)=>{
  let options
  try{options=pageOptions(req.query)}catch(err){return res.status(400).json({error:err.message})}
  try{
   const filter={deleted_at:{$exists:false},questions:{$elemMatch:{flagged:{$ne:true}}},...(options.before?{_id:{$lt:options.before}}:{})}
   const docs=await db.collection('articles').find(filter).sort({_id:-1}).limit(options.limit+1).toArray()
   const more=docs.length>options.limit
   const articles=docs.slice(0,options.limit)
   await attachQuestionRetries(db,articles)
   await attachAnswers(articles,{summary:true,study:req.query.study==='1'})
   if(req.query.study==='1')await attachSourceDates(articles)
   await attachReaskQueue(articles)
   for(const a of articles)for(const q of a.questions??[])q.answers_loaded=false
   res.json({items:articles,next_cursor:more?String(articles.at(-1)._id):null})
  }catch(err){console.error(err);res.status(500).json({error:'Could not load article summaries'})}
 })
 app.get('/api/articles/:id/questions/:questionId/history',async(req,res)=>{
  if(![req.params.id,req.params.questionId].every(x=>/^[a-f0-9]{24}$/i.test(x)))return res.status(400).json({error:'Invalid identity'})
  try{
   const article=await db.collection('articles').findOne({_id:new ObjectId(req.params.id),deleted_at:{$exists:false}})
   const question=article?.questions?.find(q=>String(q.question_id)===req.params.questionId&&!q.flagged)
   if(!question)return res.status(404).json({error:'Question not found'})
   article.questions=[question]
   await attachSourceDates(await attachAnswers([article]))
   res.json({...article.questions[0],answers_loaded:true})
  }catch(err){console.error(err);res.status(500).json({error:'Could not load question history'})}
 })
}
