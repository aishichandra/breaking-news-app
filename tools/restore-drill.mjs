// Always restores to a randomly named disposable database, never production.
import {MongoClient,BSON} from '../api/node_modules/mongodb/lib/index.js'
import {readFile} from 'node:fs/promises'
import {createDecipheriv,randomBytes} from 'node:crypto'
import {gunzipSync} from 'node:zlib'
import assert from 'node:assert/strict'
const [file]=process.argv.slice(2)
const key=Buffer.from(process.env.BACKUP_KEY??'','base64')
if(!file||key.length!==32||!process.env.MONGODB_URI)throw Error('Supply archive path, MONGODB_URI and BACKUP_KEY')
const bytes=await readFile(file)
if(bytes.subarray(0,5).toString()!=='BNBK1')throw Error('Invalid backup format')
const decrypt=createDecipheriv('aes-256-gcm',key,bytes.subarray(5,17))
decrypt.setAuthTag(bytes.subarray(-16))
// Authenticate the complete archive BEFORE opening Mongo or writing anything.
const plaintext=gunzipSync(Buffer.concat([decrypt.update(bytes.subarray(17,-16)),decrypt.final()]))
const records=plaintext.toString().trim().split('\n').map(line=>BSON.EJSON.parse(line))
if(records[0]?.kind!=='manifest'||records[0].version!==1)throw Error('Invalid backup manifest')
const name='bn_restore_drill_'+randomBytes(8).toString('hex')
const mongo=new MongoClient(process.env.MONGODB_URI)
let count=0
try{
 await mongo.connect();const db=mongo.db(name)
 for(const record of records.slice(1)){
  if(typeof record.name!=='string'||record.name.startsWith('system.'))throw Error('Invalid collection')
  if(record.kind==='collection'){
   await db.createCollection(record.name)
   for(const index of record.indexes??[]){
    if(index.name==='_id_')continue
    const {v,ns,key,...options}=index
    await db.collection(record.name).createIndex(key,options)
   }
  }else if(record.kind==='document'){
   await db.collection(record.name).insertOne(record.document)
   const restored=await db.collection(record.name).findOne({_id:record.document._id})
   assert.deepEqual(restored,record.document);count++
  }else throw Error('Unknown record type')
 }
 console.log(JSON.stringify({ok:true,verified_documents:count,temporary_database:name}))
}finally{
 await mongo.db(name).dropDatabase();await mongo.close()
}
