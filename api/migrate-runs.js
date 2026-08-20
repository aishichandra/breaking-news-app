// Additive migration: give every question a permanent question_id, and copy the
// embedded platform answers into a flat `answers` collection as "run 1".
//
//   npm run migrate            dry run — reports what it would do
//   npm run migrate -- --yes   apply
//
// Nothing is deleted. articles.questions[].platforms stays on disk untouched,
// so the old read path keeps working and this is reversible until you
// explicitly drop it later.
import { MongoClient, ObjectId } from 'mongodb'
import { PLATFORMS } from './normalize.js'

const apply = process.argv.includes('--yes')

const client = new MongoClient(process.env.MONGODB_URI)
await client.connect()

const db = client.db('breaking_news')
const articles = db.collection('articles')
const answers = db.collection('answers')

const all = await articles.find().toArray()
let newIds = 0
let answerDocs = []
const articleUpdates = []

for (const article of all) {
  const questions = article.questions ?? []
  let changed = false

  // One synthetic run per article — everything embedded was collected together.
  const runId = new ObjectId()
  const runAt =
    questions.find((q) => q.asked_at)?.asked_at ?? article.created_at ?? new Date()

  for (const question of questions) {
    if (!question.question_id) {
      question.question_id = new ObjectId()
      newIds++
      changed = true
    }

    for (const platform of PLATFORMS) {
      const p = question.platforms?.[platform]
      if (!p) continue

      answerDocs.push({
        article_id: article._id,
        question_id: question.question_id,
        platform,
        run_id: runId,
        run_at: runAt,
        asked_at: p.asked_at ?? question.asked_at ?? null,
        answer: p.answer ?? '',
        url: p.url ?? null,
        citations: p.citations ?? [],
        verdict: p.verdict ?? null,
        graded_at: p.graded_at ?? null,
        note: p.note ?? null,
        migrated: true
      })
    }
  }

  if (changed) articleUpdates.push({ _id: article._id, questions })
}

const existing = await answers.countDocuments()

console.log(`articles          ${all.length}`)
console.log(`question_ids new  ${newIds}`)
console.log(`answer docs       ${answerDocs.length}`)
console.log(`already in answers ${existing}`)

if (existing > 0) {
  console.log('\n`answers` is not empty — refusing to double-migrate.')
  console.log('Drop it first if you really mean to re-run:  db.answers.drop()')
  await client.close()
  process.exit(1)
}

if (!apply) {
  console.log('\nDry run. Nothing written. Re-run with:  npm run migrate -- --yes')
  for (const doc of answerDocs.slice(0, 4)) {
    console.log(
      `  ${doc.platform.padEnd(11)} q=${doc.question_id} verdict=${doc.verdict ?? '—'} citations=${doc.citations.length}`
    )
  }
  await client.close()
  process.exit(0)
}

for (const update of articleUpdates) {
  await articles.updateOne({ _id: update._id }, { $set: { questions: update.questions } })
}

if (answerDocs.length) await answers.insertMany(answerDocs)

// The two indexes every read path below depends on.
await answers.createIndex({ article_id: 1, question_id: 1, platform: 1, run_at: -1 })
await answers.createIndex({ question_id: 1, run_at: -1 })

console.log(`\nApplied. ${articleUpdates.length} articles updated, ${answerDocs.length} answers written.`)
console.log('Embedded platforms left in place — nothing was deleted.')
await client.close()
