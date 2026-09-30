import {readFileSync,writeFileSync,renameSync,rmSync} from 'node:fs'
// Optional persistence is used only by the isolated local review server.
export function createReviewCache(load, file=null) {
  let value, pending, generation = 0
  if(file) { try { value=JSON.parse(readFileSync(file,'utf8')).value } catch {} }
  function persist() {
    if(!file)return
    try {
      if(value===undefined)rmSync(file,{force:true})
      else { writeFileSync(`${file}.tmp`,JSON.stringify({value}),{mode:0o600});renameSync(`${file}.tmp`,file) }
    } catch(error) { console.warn('Local cache persistence unavailable:',error.code) }
  }
  return {
    clear() { generation++; value = undefined; pending = undefined; persist() },
    update(transform) {
      generation++; pending=undefined
      if(value!==undefined)value=transform(value)
      persist()
    },
    async get() {
      if (value !== undefined) return value
      if (pending) return pending
      const version = generation
      const request = Promise.resolve().then(load).then(result => {
        if (version === generation) {value = result; persist()}
        return result
      }).finally(() => { if (pending === request) pending = undefined })
      pending = request
      return request
    }
  }
}
export function updateCachedAnswer(body,id,fields) {
  const articles=JSON.parse(body)
  for(const article of articles)for(const question of article.questions??[]) {
    for(const platforms of [question.platforms,...(question.runs??[]).map(r=>r.platforms)])
      for(const answer of Object.values(platforms??{}))if(String(answer._id)===String(id)){for(const [key,value] of Object.entries(fields)){const parts=key.split('.');let target=answer;for(const part of parts.slice(0,-1)){if(!target[part]||typeof target[part]!=='object')target[part]={};target=target[part]}target[parts.at(-1)]=value}}
  }
  return JSON.stringify(articles)
}
