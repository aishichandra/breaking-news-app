// Encrypted logical snapshot. Requires MongoDB snapshot reads (MongoDB 5+).
// No passwords/URIs/keys are embedded in the archive or command arguments.
import {MongoClient,BSON} from '../api/node_modules/mongodb/lib/index.js'
import {randomBytes,createCipheriv} from 'node:crypto'
import {createWriteStream} from 'node:fs'
import {link,unlink} from 'node:fs/promises'
import {Readable} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import {createGzip} from 'node:zlib'
const [file]=process.argv.slice(2)
const key=Buffer.from(process.env.BACKUP_KEY??'','base64')
if(!file||key.length!==32||!process.env.MONGODB_URI)throw Error('Supply output path, MONGODB_URI, MONGODB_DB and a 32-byte base64 BACKUP_KEY')
const mongo=new MongoClient(process.env.MONGODB_URI)
const temp=file+'.partial-'+randomBytes(4).toString('hex')
let session
try{
 await mongo.connect()
 const db=mongo.db(process.env.MONGODB_DB||'breaking_news')
 session=mongo.startSession({snapshot:true})
 const collections=await db.listCollections({type:'collection'}).toArray()
 // Include nonce in the authenticated envelope header.
 // A distinct cipher is used below so its exact nonce can be stored.
 const iv=randomBytes(12),encrypt=createCipheriv('aes-256-gcm',key,iv)
 const output=createWriteStream(temp,{flags:'wx',mode:0o600})
 output.write(Buffer.concat([Buffer.from('BNBK1'),iv]))
 let count=0
 async function* records(){
  yield BSON.EJSON.stringify({kind:'manifest',version:1,created_at:new Date(),database:db.databaseName,consistency:'snapshot'})+'\n'
  for(const {name} of collections){
   if(name.startsWith('system.'))continue
   const indexes=await db.collection(name).listIndexes().toArray()
   yield BSON.EJSON.stringify({kind:'collection',name,indexes})+'\n'
   for await(const document of db.collection(name).find({}, {session})){
    yield BSON.EJSON.stringify({kind:'document',name,document})+'\n';count++
   }
  }
 }
 // Keep output open until the authentication tag is appended.
 await pipeline(Readable.from(records()),createGzip(),encrypt,output,{end:false})
 output.end(encrypt.getAuthTag())
 await new Promise((resolve,reject)=>{output.once('finish',resolve);output.once('error',reject)})
 await link(temp,file) // Fail rather than overwrite an existing backup.
 await unlink(temp)
 console.log(JSON.stringify({ok:true,documents:count,collections:collections.length}))
}finally{
 await session?.endSession();await mongo.close();await unlink(temp).catch(()=>{})
}
