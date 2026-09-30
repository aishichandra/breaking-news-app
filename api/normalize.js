// The four consumer-interface platforms (live browser grabs), plus the raw
// API-step matrix pushed alongside them -- gpt-4o/claude-sonnet-4 each with
// and without a web-search tool, Perplexity's API, and SerpAPI's AI
// Overview. Keep in sync with answer_worker.py's APP_PLATFORMS/API_PLATFORMS.
const BASE_PLATFORMS = [
  'google', 'chatgpt', 'claude', 'perplexity',
  'gpt4o-no-search', 'gpt4o-web-search',
  'claude-sonnet4-no-search', 'claude-sonnet4-web-search',
  'perplexity-api', 'google-ai-overview-api'
]

export const PLATFORMS = [...BASE_PLATFORMS, ...BASE_PLATFORMS
  .filter((name) => name !== 'google-ai-overview-api').map((name) => `${name}-recent-news`)]

import {safeHttpUrl} from '../safe-url.mjs'

function inputError(message) {
  return Object.assign(new Error(message),{status:400})
}
function text(value, field, limit=100000) {
  if(value==null)return ''
  if(typeof value!=='string'||value.length>limit)throw inputError(`${field} must be a string of at most ${limit} characters`)
  return value
}
function date(value) {
  if(value==null||value==='')return null
  if(typeof value!=='string'||Number.isNaN(new Date(value).getTime()))throw inputError('Invalid answer timestamp')
  return new Date(value)
}
function citations(input) {
  if(!Array.isArray(input))throw inputError('citations must be an array')
  return input.slice(0,100).filter(c=>c&&typeof c==='object'&&safeHttpUrl(c.url)).map(c=>({
    label:text(c.label,'citation label',2000),url:safeHttpUrl(c.url),
    trust:['Trusted','Untrusted',null].includes(c.trust)?c.trust:null,
    date_time:typeof c.date_time==='string'?c.date_time.slice(0,200):null
  }))
}
function normalizePlatform(raw, fallbackStamp, platform) {
  if(raw==null)return null
  if(typeof raw!=='object'||Array.isArray(raw))throw inputError('Platform answer must be an object')
  return {
    answer:text(raw.answer,'answer'),
    question_variant:platform.endsWith('-recent-news')?'recent_news':'original',
    asked_question:raw.asked_question==null?null:text(raw.asked_question,'asked_question',10000),
    url:safeHttpUrl(raw.url),asked_at:date(raw.timestamp??raw.asked_at??fallbackStamp),
    citations:citations(raw.citations??raw.sources??[]),
    screenshot_id:typeof raw.screenshot_id==='string'&&/^[a-f0-9]{24}$/i.test(raw.screenshot_id)?raw.screenshot_id:null,
    model:raw.model==null?null:text(raw.model,'model',200),
    search:raw.search==null?null:text(raw.search,'search',40)
  }
}
export function cleanManualCitations(input) {
  if(!Array.isArray(input))return []
  const byUrl=new Map()
  for(const c of input){
    const url=safeHttpUrl(c?.url)
    if(!url||byUrl.has(url))continue
    const label=typeof c.label==='string'&&c.label.trim()?c.label.trim().slice(0,200):new URL(url).hostname.replace(/^www\./,'')
    byUrl.set(url,{label,url,trust:null})
    if(byUrl.size>=100)break
  }
  return [...byUrl.values()]
}
export function normalizeEntry(entry) {
  if(!entry||typeof entry!=='object'||Array.isArray(entry))throw inputError('Invalid answer entry')
  return PLATFORMS.map(platform=>{
    const answer=normalizePlatform(entry[platform],entry.timestamp,platform)
    if(!answer||(!answer.answer.trim()&&!answer.citations.length&&!answer.url&&!answer.screenshot_id))return null
    return {platform,...answer}
  }).filter(Boolean)
}

// Merges the two arrays you paste in:
//   groundTruth    [{ question, answer }]                     — position = question_index
//   platformAnswers[{ question_index, timestamp, question, google, chatgpt, ... }]
// One scraper entry -> one normalized record per platform that answered.
// Shared by POST /api/articles when normalizing platform answer payloads.
export function buildQuestions(groundTruth = [], platformAnswers = []) {
  if(!Array.isArray(groundTruth)||!Array.isArray(platformAnswers)||groundTruth.length>100||platformAnswers.length>100)throw inputError('Question and answer lists must contain at most 100 entries')
  if (platformAnswers.length === 0) {
    return groundTruth.map((g, i) => ({
      question_index: i,
      question: text(g?.question,'question',10000),
      answer: text(g?.answer,'expected answer',10000),
      asked_at: null,
      platforms: {}
    }))
  }

  return platformAnswers.map((entry, i) => {
    if(!entry||typeof entry!=='object'||Array.isArray(entry))throw inputError('Invalid answer entry')
    const index = entry.question_index ?? i
    if(!Number.isInteger(index)||index<0)throw inputError('Invalid question_index')
    const truth = groundTruth[index] ?? {}

    return {
      question_index: index,
      question: text(entry.question ?? truth.question,'question',10000),
      answer: text(truth.answer,'expected answer',10000),
      asked_at: date(entry.timestamp),
      platforms: Object.fromEntries(
        PLATFORMS.map((name) => [name, normalizePlatform(entry[name], entry.timestamp, name)])
      )
    }
  })
}
