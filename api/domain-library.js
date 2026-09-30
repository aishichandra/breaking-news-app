import {DOMAIN_CATEGORIES,domainKey,categoryName,platformMetadata} from '../domain-library.mjs'
export function registerDomainLibrary(app,db){
 const categories=db.collection('citation_categories'),domains=db.collection('citation_domains'),platforms=db.collection('citation_domain_platforms')
 app.get('/api/domain-library',async(req,res)=>{try{
  const [custom,d,p]=await Promise.all([categories.find().toArray(),domains.find().toArray(),platforms.find().toArray()])
  res.json({categories:[...new Set([...DOMAIN_CATEGORIES,...custom.map(c=>categoryName(c.name))])],domains:Object.fromEntries(d.map(({_id,...v})=>[v.domain,{...v,category:v.category?categoryName(v.category):null}])),platforms:Object.fromEntries(p.map(({_id,...v})=>[`${v.domain}:${v.platform}`,v]))})
 }catch(e){console.error(e);res.status(500).json({error:'Could not load domain library'})}})
 app.post('/api/domain-library/categories',async(req,res)=>{
  let name;try{name=categoryName(req.body?.name)}catch(e){return res.status(400).json({error:e.message})}
  try{const builtin=DOMAIN_CATEGORIES.find(n=>n.toLowerCase()===name.toLowerCase());if(builtin)return res.json({name:builtin});await categories.updateOne({_id:name.toLowerCase()},{$setOnInsert:{name}},{upsert:true});const saved=await categories.findOne({_id:name.toLowerCase()});res.json({name:saved.name})}catch(e){console.error(e);res.status(500).json({error:'Could not add category'})}
 })
 app.put('/api/domain-library/domain',async(req,res)=>{
  let domain,category;try{domain=domainKey(req.body?.domain);category=req.body?.category===null?null:categoryName(req.body?.category)}catch(e){return res.status(400).json({error:e.message})}
  try{if(category&&!DOMAIN_CATEGORIES.includes(category)&&!await categories.findOne({name:category}))return res.status(400).json({error:'Add the category before assigning it'});const value={domain,category,updated_at:new Date()};await domains.updateOne({_id:domain},{$set:value},{upsert:true});res.json(value)}catch(e){console.error(e);res.status(500).json({error:'Could not save domain category'})}
 })
 app.put('/api/domain-library/platform',async(req,res)=>{
  let value;try{value=platformMetadata(req.body??{})}catch(e){return res.status(400).json({error:e.message})}
  try{value.updated_at=new Date();await platforms.updateOne({_id:`${value.domain}:${value.platform}`},{$set:value},{upsert:true});const {_id,...saved}=await platforms.findOne({_id:`${value.domain}:${value.platform}`});res.json(saved)}catch(e){console.error(e);res.status(500).json({error:'Could not save platform details'})}
 })
}
