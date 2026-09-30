import {randomUUID} from 'node:crypto'
// Append-only through the app. Give the runtime Mongo role insert/find only
// on review_audit for database-enforced immutability; administrators retain
// responsibility for storage access and backup retention.
export function reviewAudit(db){
 return async(req,res,next)=>{
  if(['GET','HEAD','OPTIONS'].includes(req.method)||req.actor?.role==='collector')return next()
  if(!req.path.startsWith('/api/')||['/api/articles','/api/screenshots'].includes(req.path))return next()
  const eventId=randomUUID()
  try{
   await db.collection('review_audit').insertOne({event_id:eventId,phase:'intent',at:new Date(),actor:req.actor?.username??'local',role:req.actor?.role??'admin',method:req.method,path:req.path,changes:req.body??null})
  }catch(err){console.error('Audit write failed');return res.status(503).json({error:'Audit storage unavailable; change was not applied'})}
  res.once('finish',()=>{
   db.collection('review_audit').insertOne({event_id:eventId,phase:'outcome',at:new Date(),status:res.statusCode}).catch(()=>console.error('Audit outcome missing; inspect intent event',eventId))
  })
  next()
 }
}
