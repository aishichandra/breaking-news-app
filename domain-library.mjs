export const DOMAIN_CATEGORIES=['Newsroom','Social Media']
export const DOMAIN_PLATFORMS=[{id:'chatgpt',label:'ChatGPT / OpenAI'},{id:'claude',label:'Claude / Anthropic'},{id:'perplexity',label:'Perplexity'},{id:'google',label:'Google'}]
export const RELATIONSHIPS=['Partner publication','Deal','Lawsuit','Grant','Other']
export const ROBOTS=['Not checked','Allowed','Blocked','Mixed / depends on bot','No robots.txt','Unable to verify']
export function domainKey(value){
 if(typeof value!=='string'||value.length>253||/[\s/?#@:]/.test(value))throw Error('Enter a domain without a URL path')
 const host=new URL(`https://${value}`).hostname.toLowerCase().replace(/^www\./,'')
 if(!host.includes('.')||!host.split('.').every(part=>/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(part)))throw Error('Invalid domain')
 return host
}
export function categoryName(value){if(typeof value!=='string'||!value.trim()||value.trim().length>80)throw Error('Category must contain 1–80 characters');const name=value.trim();return /^social media(?: \(of newsroom\)| \(reposted\)| \(other\))?$/i.test(name)?'Social Media':name}
export function platformMetadata(body){
 const domain=domainKey(body.domain)
 if(!DOMAIN_PLATFORMS.some(p=>p.id===body.platform))throw Error('Unknown platform')
 if(!Array.isArray(body.relationships)||body.relationships.some(v=>!RELATIONSHIPS.includes(v)))throw Error('Invalid relationship')
 if(!ROBOTS.includes(body.robots))throw Error('Invalid robots.txt status')
 if(typeof body.notes!=='string'||body.notes.length>2000)throw Error('Notes must be 2000 characters or fewer')
 return {domain,platform:body.platform,relationships:[...new Set(body.relationships)],robots:body.robots,notes:body.notes.trim()}
}
