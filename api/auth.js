import {promisify} from 'node:util'
const derive=promisify(scrypt)
import {createHash,randomBytes,scryptSync,scrypt,timingSafeEqual} from 'node:crypto'
const digest=value=>createHash('sha256').update(String(value)).digest()
const matches=(a,b)=>timingSafeEqual(digest(a),digest(b))
export function passwordHash(password,salt=randomBytes(16).toString('hex')){
 return `scrypt:${salt}:${scryptSync(password,salt,64).toString('hex')}`
}
async function verify(password,hash){
 const [,salt]=hash.split(':')
 return matches(`scrypt:${salt}:${(await derive(password,salt,64)).toString('hex')}`,hash)
}
export function parseUsers(raw){
 if(!raw)return []
 const users=JSON.parse(raw)
 if(!Array.isArray(users)||!users.length)throw new Error('AUTH_USERS_JSON must contain accounts')
 const names=new Set()
 for(const user of users){
  if(!/^[a-zA-Z0-9_.@-]{1,100}$/.test(user.username??'')||names.has(user.username)||!['admin','reviewer','viewer','collector'].includes(user.role)||!/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(user.password_hash??''))throw new Error('Invalid or duplicate account configuration')
  names.add(user.username)
 }
 return users
}
export function permitted(role,method,path){
 if(['GET','HEAD','OPTIONS'].includes(method))return role!=='collector'||/^\/api\/(health|environment|collection-targets|reask-queue|question-retry-queue)(?:\/|$)/.test(path)
 if(role==='admin')return true
 if(role==='viewer')return false
 if(role==='collector')return (method==='POST'&&['/api/articles','/api/screenshots','/api/sources'].includes(path))||(method==='DELETE'&&/^\/api\/(question-retry-queue\/[^/]+|articles\/[^/]+\/reask)$/.test(path))
 return role==='reviewer'&&((method==='PATCH'&&/^\/api\/(answers\/[^/]+|articles\/[^/]+(?:\/questions\/\d+)?)$/.test(path))||(['POST','PUT','PATCH','DELETE'].includes(method)&&/^\/api\/(sources|citation[^/]*|domain[^/]*)(?:\/|$)/.test(path))||(method==='POST'&&/^\/api\/articles\/[^/]+\/(reask|questions\/\d+\/retry)$/.test(path)))
}
export function authentication(env=process.env){
 const users=parseUsers(env.AUTH_USERS_JSON)
 // Unknown users take the same expensive hash path, too.
 const dummy=passwordHash(randomBytes(32).toString('hex'))
 return async(req,res,next)=>{
  if(!env.AUTH_PASSWORD&&!users.length){req.actor={username:'local',role:'admin'};return next()}
  const [scheme,encoded]=(req.headers.authorization??'').split(' ')
  const decoded=scheme==='Basic'&&encoded?Buffer.from(encoded,'base64').toString():''
  const separator=decoded.indexOf(':')
  const username=decoded.slice(0,separator),password=decoded.slice(separator+1)
  const account=users.find(u=>u.username===username)
  const valid=users.length>0&&separator>=0&&password.length<=1024&&await verify(password,account?.password_hash??dummy)
  if(valid&&account)req.actor={username:account.username,role:account.role}
  else if(!account&&separator>=0&&env.AUTH_PASSWORD&&matches(username,env.AUTH_USER||'admin')&&matches(password,env.AUTH_PASSWORD))req.actor={username,role:users.length?'collector':'admin'}
  if(!req.actor){res.set('WWW-Authenticate','Basic realm="Breaking News Benchmark"');return res.status(401).send('Authentication required')}
  if(!permitted(req.actor.role,req.method,req.path))return res.status(403).json({error:'Your account does not have permission for this action'})
  next()
 }
}
