import test from 'node:test'
import assert from 'node:assert/strict'
import {flatten,latestPerWindow,metric,comparison,citationInventory,timeWindow,CITATION_TYPES as UI_TYPES} from './web/src/lib/study.js'
import {classificationInput,registerCitationTypes,CITATION_TYPES} from './api/citation-types.js'
const pub='2026-09-25T12:00:00Z'
const make=(id,platform,stamp,grade='correct',citations=[])=>({run_id:id,platforms:{[platform]:{_id:id,answer:'Answer',asked_at:stamp,verdict:grade,citations}}})
const articles=runs=>[{_id:'article',url:'https://example.com/story',published_at:pub,questions:[{question_id:'q',question:'Q?',runs}]}]

test('actual timestamps use disjoint intervals, missing and negative dates stay unknown',()=>{
 assert.equal(timeWindow(pub,'2026-09-25T12:29:59Z'),'first')
 assert.equal(timeWindow(pub,'2026-09-25T12:30:00Z'),'30m')
 assert.equal(timeWindow(pub,'2026-09-25T13:00:00Z'),'1h')
 assert.equal(timeWindow(pub,'2026-09-26T12:00:00Z'),'1d')
 assert.equal(timeWindow(null,pub),'unknown')
 assert.equal(timeWindow(pub,'bad'),'unknown')
 assert.equal(timeWindow(pub,'2026-09-25T11:59:00Z'),'unknown')
})
test('latest response per question platform interval wins, other platforms remain',()=>{
 const raw=flatten(articles([make('1','chatgpt','2026-09-25T12:01:00Z','incorrect'),make('2','chatgpt','2026-09-25T12:10:00Z'),make('3','claude','2026-09-25T12:12:00Z')]))
 const rows=latestPerWindow(raw)
 assert.deepEqual(rows.map(r=>r.id),['2','3']);assert.equal(metric(rows).pct,100)
})
test('ungraded and uncaptured answers never become incorrect results',()=>{
 const data=articles([make('1','chatgpt',pub,null),make('2','claude',pub,'partial')]);data[0].questions[0].runs.push({run_id:'failed',platforms:{google:{answer:'',verdict:'incorrect'}}})
 const rows=flatten(data);assert.equal(rows.length,2)
 assert.deepEqual(metric(rows),{n:0,d:1,total:2,missing:1,pct:0})
 assert.equal(metric([rows[0]]).pct,null)
 data[0].questions[0].flagged=true;assert.equal(flatten(data).length,0)
})
test('prompt comparisons exclude unmatched questions and configurations',()=>{
 const rs=flatten(articles([make('1','gpt4o-web-search',pub),make('2','gpt4o-web-search-recent-news',pub,'incorrect'),make('3','perplexity-api',pub)]))
 const p=comparison(rs,'accuracy','prompt')[0]
 assert.equal(p.cohort,1);assert.equal(p.left.d,1);assert.equal(p.right.d,1);assert.equal(p.left.pct,100);assert.equal(p.right.pct,0)
})
test('source rate counts each response once; domain ranks deduplicate pages',()=>{
 const rows=flatten(articles([make('1','chatgpt',pub,'correct',[{url:'https://www.example.com/story?utm_source=x'},{url:'https://example.com/story#p'},{url:'https://example.com/other'}]),make('2','claude',pub,'correct',[])]))
 assert.equal(metric(rows,'source').pct,50)
 const inv=citationInventory(rows);assert.equal(inv.domains.length,1);assert.equal(inv.domains[0].responses.size,1);assert.equal(inv.pages.length,2)
})
test('classification URL validation and shared type vocabulary',()=>{
 assert.deepEqual(UI_TYPES,CITATION_TYPES)
 assert.equal(classificationInput({url:'https://www.example.com/a?utm_source=x',type:'Research'}).key,'example.com/a')
 assert.throws(()=>classificationInput({url:'javascript:alert(1)',type:'Research'}))
 assert.throws(()=>classificationInput({url:'https://example.com',type:'Fake type'}))
})
test('classification routes persist canonical page identity and reject invalid input',async()=>{
 const routes={},saved=new Map()
 const app={get:(p,h)=>routes['GET '+p]=h,put:(p,h)=>routes['PUT '+p]=h}
 const db={collection:()=>({find:()=>({toArray:async()=>[...saved.values()]}),updateOne:async(filter,update)=>saved.set(filter._id,update.$set)})}
 registerCitationTypes(app,db)
 const res={statusCode:200,status(c){this.statusCode=c;return this},json(value){this.body=value;return this}}
 await routes['PUT /api/citation-types']({body:{url:'https://example.com/a?utm_source=x',type:'News reporting'}},res)
 assert.equal(saved.get('example.com/a').type,'News reporting')
 await routes['GET /api/citation-types']({},res);assert.equal(res.body['example.com/a'].type,'News reporting')
 await routes['PUT /api/citation-types']({body:{url:'bad',type:'News reporting'}},res);assert.equal(res.statusCode,400);assert.equal(saved.size,1)
})
