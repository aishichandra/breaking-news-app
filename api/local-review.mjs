// Start with: node --env-file=.env local-review.mjs (from api/).
// Source database is read only here; the app runs against a separate snapshot.
import {MongoClient} from 'mongodb'
import {spawn} from 'node:child_process'
const targetName='breaking_news_local_review'
const client=new MongoClient(process.env.MONGODB_URI)
await client.connect()
const source=client.db(process.env.MONGODB_DB||'breaking_news'),target=client.db(targetName)
if(source.databaseName===targetName)throw new Error('Source and local snapshot must differ')
const initialized=await target.collection('_local_meta').findOne({_id:'snapshot'})
if(!initialized){
 for(const name of ['articles','answers','sources','screenshots.files','screenshots.chunks']){
  // Copy inside MongoDB rather than downloading and re-uploading screenshots.
  // keepExisting makes an interrupted initial snapshot safe to resume.
  await source.collection(name).aggregate([
   {$match:{}},
   {$merge:{into:{db:targetName,coll:name},on:'_id',whenMatched:'keepExisting',whenNotMatched:'insert'}}
  ]).toArray()
  console.log(`Local snapshot: ${name}: ${await target.collection(name).countDocuments()}`)
 }
 await target.collection('_local_meta').insertOne({_id:'snapshot',created_at:new Date(),source:source.databaseName})
}
await client.close()
const child=spawn(process.execPath,['server.js'],{cwd:import.meta.dirname,env:{...process.env,MONGODB_DB:targetName,LOCAL_REVIEW:'1',PORT:process.env.PORT||'3000'},stdio:'inherit'})
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal))
child.on('exit',code=>process.exit(code??0))
