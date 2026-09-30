// Read-only: identify candidates; never select a winner or rewrite evidence.
import {MongoClient} from '../api/node_modules/mongodb/lib/index.js'
const mongo=new MongoClient(process.env.MONGODB_URI)
try{
 await mongo.connect();const db=mongo.db(process.env.MONGODB_DB||'breaking_news')
 const duplicates=await db.collection('answers').aggregate([
  {$group:{_id:{question_id:'$question_id',run_id:'$run_id',platform:'$platform'},count:{$sum:1},answer_ids:{$push:'$_id'}}},{$match:{count:{$gt:1}}}
 ]).toArray()
 const orphaned=await db.collection('answers').aggregate([
  {$lookup:{from:'articles',localField:'article_id',foreignField:'_id',as:'article'}},
  {$match:{$or:[{article:{$size:0}},{$expr:{$not:{$in:['$question_id',{$ifNull:[{$arrayElemAt:['$article.questions.question_id',0]},[]]}]}}}]}},{$project:{_id:1,article_id:1,question_id:1}}
 ]).toArray()
 console.log(JSON.stringify({duplicate_groups:duplicates,orphaned_answers:orphaned},null,2))
}finally{await mongo.close()}
