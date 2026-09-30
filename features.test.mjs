import test from 'node:test'
import assert from 'node:assert/strict'
import { buildQuestions, normalizeEntry, PLATFORMS } from './api/normalize.js'
import { articleIdentity, sourceCitationStatus } from './source-match.mjs'
import { PLATFORM_NAMES } from './web/src/lib/verdicts.js'

test('both prompts and answers survive ingestion under the same question', () => {
  const original = { answer: 'Original', asked_question: 'What happened?', question_variant: 'original' }
  const recent = { answer: 'Recent', asked_question: 'Based on the most recent news, answer the following question: What happened?', question_variant: 'recent_news' }
  const [question] = buildQuestions([{ question: 'What happened?', answer: 'Truth' }], [{
    question_index: 0, 'perplexity-api': original, 'perplexity-api-recent-news': recent
  }])
  assert.equal(question.question, 'What happened?')
  assert.equal(question.platforms['perplexity-api'].answer, 'Original')
  assert.equal(question.platforms['perplexity-api-recent-news'].answer, 'Recent')
  assert.equal(question.platforms['perplexity-api-recent-news'].asked_question, recent.asked_question)
  assert.deepEqual([...PLATFORMS].sort(), [...PLATFORM_NAMES].sort())
  assert.equal(new Set(PLATFORMS).size, PLATFORMS.length)
})

test('legacy records remain original and do not fabricate recent answers', () => {
  const [q] = buildQuestions([{question: 'Q'}], [{'perplexity-api': {answer: 'Old'}}])
  assert.equal(q.platforms['perplexity-api'].question_variant, 'original')
  assert.equal(q.platforms['perplexity-api-recent-news'], null)
})

test('source matching ignores tracking, fragments and URL presentation differences', () => {
  assert.equal(sourceCitationStatus('https://www.example.com/story/?utm_source=rss', [
    {url: 'http://example.com/story?utm_source=chatgpt.com&fbclid=abc#section'}
  ]), true)
  assert.equal(sourceCitationStatus('https://example.com/story', [{url: 'https://example.com/other'}]), false)
  assert.equal(sourceCitationStatus('https://example.com/?id=1', [{url: 'https://example.com/?id=2'}]), false)
  assert.equal(articleIdentity('https://example.com/?b=2&a=1'), articleIdentity('https://example.com/?a=1&b=2'))
  assert.equal(sourceCitationStatus('https://example.com/story', []), false)
  assert.equal(sourceCitationStatus(null, []), null)
  assert.equal(articleIdentity('javascript:alert(1)'), null)
  assert.equal(sourceCitationStatus('https://example.com/story', [{url: 'invalid'}, null]), false)
})

import { confidenceUpdate } from './api/confidence.js'

test('confidence is allowed only for correct or incorrect responses', () => {
  for (const verdict of ['correct', 'incorrect']) {
    for (const confidence of ['confident', 'not_confident', null]) {
      assert.deepEqual(confidenceUpdate({confidence}, verdict), {confidence})
    }
  }
  for (const verdict of ['partial', 'abstained', 'speculation', null, undefined]) {
    assert.throws(() => confidenceUpdate({confidence: 'confident'}, verdict))
    assert.deepEqual(confidenceUpdate({verdict}, 'correct'), {confidence: null})
  }
  assert.throws(() => confidenceUpdate({confidence: 'high'}, 'correct'))
  assert.deepEqual(confidenceUpdate({verdict: 'correct', confidence: 'not_confident'}, null), {confidence: 'not_confident'})
  assert.throws(() => confidenceUpdate({verdict: 'partial', confidence: 'confident'}, 'correct'))
  assert.deepEqual(confidenceUpdate({note: 'note'}, 'correct'), {})
  assert.deepEqual(confidenceUpdate({verdict: 'incorrect'}, 'correct'), {})
})

test('browser variants ingest independently and retain browser classification', async()=>{
 const {channelOf,domainRankings}=await import('./web/src/lib/study.js')
 for(const name of ['chatgpt','claude','google','perplexity']){
  const entry={[name]:{answer:'Original'},[`${name}-recent-news`]:{answer:'Recent',asked_question:'Based on the most recent news: Q'}}
  const [q]=buildQuestions([{question:'Q'}],[entry])
  assert.equal(q.platforms[`${name}-recent-news`].question_variant,'recent_news')
  assert.equal(q.platforms[name].question_variant,'original')
  assert.equal(normalizeEntry(entry).length,2)
  assert.equal(channelOf(`${name}-recent-news`),'Browser')
  const ranked=domainRankings([{id:name,platform:`${name}-recent-news`,answer:{citations:[{url:'https://example.com/a'}]}}],{channel:'Browser',variant:'Recent news'})
  assert.equal(ranked.find(r=>r.id===name).domains[0].percent,100)
 }
})
