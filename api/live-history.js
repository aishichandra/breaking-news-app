// Production memory cache: stale reads refresh in the background, writes fence
// older in-flight reads, and failed refreshes retain the last usable history.
export function createLiveHistory(load,{maxAge=30000,now=Date.now,onError=console.error}={}) {
 let value,pending,updatedAt=null,generation=0,revision=0,stale=false
 function refresh(){
  if(pending)return pending
  const version=generation,startedRevision=revision
  const request=Promise.resolve().then(load).then(result=>{
   if(version===generation){value=result;updatedAt=now();stale=revision!==startedRevision}
   return result
  }).finally(()=>{if(pending===request)pending=undefined})
  pending=request;return request
 }
 return {
  clear(){generation++;value=undefined;pending=undefined;updatedAt=null},
  invalidate(){revision++;stale=true},
  update(transform){generation++;pending=undefined;if(value!==undefined)value=transform(value)},
  status(){return {updatedAt,refreshing:!!pending||stale}},
  async get({fresh=false}={}){
   if(fresh){
    if(pending)await pending
    return refresh()
   }
   if(value===undefined)return refresh()
   if(stale||updatedAt===null||now()-updatedAt>=maxAge)refresh().catch(onError)
   return value
  }
 }
}
