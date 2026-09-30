import test from 'node:test'
import assert from 'node:assert/strict'
import {domainComparison,domainRankings} from './web/src/lib/study.js'
test('domain matrix counts unique responses per configuration and excludes no-search',()=>{
 const row=(id,platform,urls)=>({id,platform,answer:{citations:urls.map(url=>({url}))}})
 const {columns,inventory}=domainComparison([row('a','chatgpt',['https://www.example.com/one','https://example.com/two']),row('b','chatgpt',[]),row('c','gpt4o-web-search-recent-news',['https://example.com/one']),row('d','gpt4o-no-search',['https://hidden.com'])])
 assert.equal(columns.length,2);assert.equal(columns.find(c=>c.platform==='chatgpt').counts.get('example.com'),1);assert.equal(columns.find(c=>c.platform==='chatgpt').total,2);assert.deepEqual(inventory.domains.map(d=>d.domain),['example.com']);assert.equal(inventory.domains[0].responses.size,2)
})

test('provider rankings deduplicate citations, rank independently and respect channel and prompt filters',()=>{
 const row=(id,platform,hosts)=>({id,platform,answer:{citations:hosts.map(h=>({url:`https://${h}/article`}))}})
 const rows=[row('a','chatgpt',['a.com','a.com']),row('b','gpt4o-web-search-recent-news',['b.com']),row('c','gpt4o-web-search',[]),row('d','claude',['b.com']),row('e','gpt4o-no-search',['hidden.com'])]
 const ranked=domainRankings(rows)
 assert.equal(ranked.length,4)
 assert.equal(ranked[0].total,3)
 assert.deepEqual(ranked[0].domains.map(d=>[d.domain,d.count]),[['a.com',1],['b.com',1]])
 assert.equal(ranked[1].domains[0].percent,100)
 assert.equal(ranked[2].total,0)
 assert.equal(domainRankings(rows,{channel:'Browser'})[0].domains[0].percent,100)
 const recent=domainRankings(rows,{channel:'API',variant:'Recent news'})[0]
 assert.equal(recent.total,1)
 assert.equal(recent.domains[0].domain,'b.com')
})
