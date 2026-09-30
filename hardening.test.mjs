import test from 'node:test'
import assert from 'node:assert/strict'
import {pageOptions} from './api/article-reads.js'
import {parseUsers,passwordHash,permitted,authentication} from './api/auth.js'
import {reviewAudit} from './api/review-audit.js'
test('pagination rejects unbounded and malformed cursors',()=>{
 assert.equal(pageOptions({}).limit,12)
 for(const query of [{limit:0},{limit:51},{limit:'NaN'},{before:'bad'}])assert.throws(()=>pageOptions(query))
})
test('roles reject viewer writes and collector review actions',()=>{
 assert.equal(permitted('viewer','PATCH','/api/answers/123'),false)
 assert.equal(permitted('collector','PATCH','/api/answers/123'),false)
 assert.equal(permitted('collector','POST','/api/articles'),true)
 assert.equal(permitted('reviewer','PATCH','/api/answers/123'),true)
 assert.equal(permitted('reviewer','DELETE','/api/articles/123'),false)
 assert.equal(permitted('admin','DELETE','/api/articles/123'),true)
})
test('individual hashed accounts authenticate and legacy key becomes collection-only',async()=>{
 const user={username:'reviewer',role:'reviewer',password_hash:passwordHash('long test password')}
 assert.throws(()=>parseUsers(JSON.stringify([user,user])))
 const middleware=authentication({AUTH_USERS_JSON:JSON.stringify([user]),AUTH_PASSWORD:'legacy'})
 async function check(credentials,method,path){let status=200,next=false;const req={headers:{authorization:'Basic '+Buffer.from(credentials).toString('base64')},method,path};await middleware(req,{set(){},status(n){status=n;return this},send(){},json(){}},()=>next=true);return {status,next,actor:req.actor}}
 assert.equal((await check('reviewer:long test password','PATCH','/api/answers/id')).next,true)
 assert.equal((await check('reviewer:wrong','GET','/api/articles')).status,401)
 assert.equal((await check('admin:legacy','PATCH','/api/answers/id')).status,403)
 assert.equal((await check('admin:legacy','POST','/api/articles')).next,true)
})
test('failed durable audit intent prevents a human mutation',async()=>{
 let changed=false,status
 const middleware=reviewAudit({collection:()=>({insertOne:async()=>{throw Error('offline')}})})
 await middleware({method:'PATCH',path:'/api/answers/123',actor:{username:'person',role:'reviewer'},body:{verdict:'correct'}},{status(n){status=n;return this},json(){}},()=>changed=true)
 assert.equal(status,503);assert.equal(changed,false)
})
