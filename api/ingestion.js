import {headlineObservations} from '../article-headlines.mjs'
import {createHash} from 'node:crypto'
import {ObjectId} from 'mongodb'
import {safeHttpUrl} from '../safe-url.mjs'

export const questionKey = text => (text ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
export function validDate(value, field) {
  if (value == null || value === '') return null
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) throw new Error(`${field} must be a valid date string`)
  return new Date(value)
}
export function validateIngestion(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Expected a JSON object')
  headlineObservations(body)
  if (!safeHttpUrl(body.url)) throw new Error('url must be an HTTP(S) URL without credentials')
  for (const field of ['run_at','published_at','updated_at']) validDate(body[field],field)
  for (const field of ['snippet','markdown']) if (body[field] != null && typeof body[field] !== 'string') throw new Error(`${field} must be a string`)
  for (const field of ['questions','platform_answers']) if (body[field] != null && (!Array.isArray(body[field]) || body[field].length > 100)) throw new Error(`${field} must be an array of at most 100 entries`)
  for (const question of body.questions ?? []) {
    if (!question || typeof question.question !== 'string' || !question.question.trim()) throw new Error('Every question requires non-empty text')
    if(question.question_id!=null&&!/^[a-f0-9]{24}$/i.test(question.question_id))throw new Error('Invalid question ID')
    if (question.answer != null && typeof question.answer !== 'string') throw new Error('Expected answer must be a string')
  }
}

// A supplied stable collection timestamp identifies retries of the same run.
export function ingestionRunId(articleId, runAt, supplied) {
  return supplied ? new ObjectId(createHash('sha256').update(`${articleId}:${runAt.toISOString()}`).digest('hex').slice(0,24)) : new ObjectId()
}
export function answerIdentity(doc) {
  return new ObjectId(createHash('sha256').update(`${doc.question_id}:${doc.run_id}:${doc.platform}`).digest('hex').slice(0,24))
}
export function answerUpserts(docs) {
  return docs.map(doc => ({updateOne: {
    filter: {_id: answerIdentity(doc)}, update: {$setOnInsert: doc}, upsert: true
  }}))
}

export function resolveQuestion(questions, text, position, {allowPosition=false}={}) {
  const key=questionKey(text)
  // An explicit different question must NEVER be attached by its position.
  if (key) return questions.find(q=>questionKey(q.question)===key)
  return allowPosition ? questions[position] : undefined
}
