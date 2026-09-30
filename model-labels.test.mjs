import test from 'node:test'
import assert from 'node:assert/strict'
import {modelLabel,answerLabel,PLATFORM_GROUPS} from './web/src/lib/verdicts.js'

test('stable legacy slots display the recorded model and prompt variant',()=>{
 const slot='gpt4o-web-search-recent-news'
 assert.equal(answerLabel(slot,{model:'openai/gpt-5'}),'GPT-5 · Search · Recent')
 assert.equal(answerLabel(slot,{model:'openai/gpt-4o'}),'GPT-4o · Search · Recent')
 assert.equal(modelLabel(slot,{model:'openai/gpt-6-astra-pro'}),'GPT-6 Astra Pro')
 assert.equal(answerLabel('claude-sonnet4-no-search',{model:'anthropic/claude-opus-5.5'}),'Claude Opus 5.5 · No search · Original')
})
test('missing model metadata is explicit and unknown recorded models stay visible',()=>{
 assert.equal(modelLabel('gpt4o-web-search',{}),'OpenAI (model not recorded)')
 assert.equal(modelLabel('gpt4o-web-search',{model:'openai/future-model'}),'openai/future-model')
 assert.equal(answerLabel('chatgpt',{}),'ChatGPT')
 assert.equal(PLATFORM_GROUPS.find(g=>g.id==='api').subgroups[0].label,'OpenAI')
})
