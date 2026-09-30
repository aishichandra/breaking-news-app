import test from 'node:test'
import assert from 'node:assert/strict'
import {activeArticles,activeDataset} from './active-dataset.mjs'
test('bad questions and their answers are excluded without renumbering or deleting stored records',()=>{
 const articles=[{_id:'a',questions:[{question_id:'bad',flagged:true},{question_id:'good'},{question_id:'explicit',question_index:7}]},{_id:'b',questions:[{question_id:'bad2',flagged:true}]}]
 const answers=['bad','good','explicit','bad2'].map(question_id=>({question_id}))
 const result=activeDataset(articles,answers)
 assert.equal(result.articles.length,1)
 assert.deepEqual(result.articles[0].questions.map(q=>q.question_index),[1,7])
 assert.deepEqual(result.answers.map(a=>a.question_id),['good','explicit'])
 assert.equal(articles[0].questions.length,3)
 assert.equal(articles[0].questions[1].question_index,undefined)
 assert.equal(activeArticles([{questions:[{question_id:'restored',flagged:false}]}]).length,1)
})
