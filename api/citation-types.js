import { articleIdentity } from '../source-match.mjs'
export const CITATION_TYPES = ['Unclassified','News reporting','Official / primary document','Research','Reference / encyclopedia','Opinion / analysis','Social / forum','Commercial / promotional','Other']
export function classificationInput(body) {
 if(typeof body?.url!=='string'||!articleIdentity(body.url))throw new Error('A valid HTTP(S) page URL is required')
 if(!CITATION_TYPES.includes(body.type))throw new Error('Unknown citation type')
 return {key:articleIdentity(body.url),url:body.url,type:body.type}
}
export function registerCitationTypes(app, db) {
 app.get('/api/citation-types',async(req,res)=>{try{const docs=await db.collection('citation_types').find().toArray();res.json(Object.fromEntries(docs.map(({_id,...row})=>[row.key,row])))}catch(e){console.error(e);res.status(500).json({error:'Could not load citation types'})}})
 app.put('/api/citation-types',async(req,res)=>{
  let value;try{value=classificationInput(req.body)}catch(e){return res.status(400).json({error:e.message})}
  try{value.updated_at=new Date();await db.collection('citation_types').updateOne({_id:value.key},{$set:value},{upsert:true});res.json(value)}catch(e){console.error(e);res.status(500).json({error:'Could not save citation type'})}
 })
}
