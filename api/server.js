import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, timingSafeEqual } from 'node:crypto'
import express from 'express'
import cors from 'cors'
import { MongoClient, ObjectId } from 'mongodb'
import { buildQuestions, normalizeEntry, PLATFORMS } from './normalize.js'
import { milestoneForRun, runAskedAt } from './reask-schedule.js'

const client = new MongoClient(process.env.MONGODB_URI)
await client.connect()
console.log('Connected to MongoDB')

const db = client.db('breaking_news')

// Platforms append their own tracking parameters, so the same article arrives
// as several distinct URLs (?utm_source=chatgpt.com, ?ampMode=1). Keying on a
// canonical form means one fetch and one source record per real page.
const TRACKING_PARAM = /^(utm_|fbclid|gclid|mc_cid|mc_eid|ampMode|_ga|igshid|ref_src)/i

function canonicalUrl(raw) {
  try {
    const u = new URL(raw)
    u.hash = ''
    u.hostname = u.hostname.toLowerCase()
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAM.test(key)) u.searchParams.delete(key)
    }
    return u.toString()
  } catch {
    return raw
  }
}

// Walks every citation in a set of articles. Citations are buried four levels
// deep (article -> question -> platform -> citation), so both the join below
// and the /pending route go through here rather than repeating the nesting.
function forEachCitation(articles, fn) {
  for (const article of articles) {
    for (const question of article.questions ?? []) {
      for (const platform of Object.values(question.platforms ?? {})) {
        for (const citation of platform?.citations ?? []) {
          if (citation?.url) fn(citation)
        }
      }
      for (const run of question.runs ?? []) {
        for (const platform of Object.values(run.platforms ?? {})) {
          for (const citation of platform?.citations ?? []) {
            if (citation?.url) fn(citation)
          }
        }
      }
    }
  }
}

// Answers live in their own collection, one document per question x platform x
// run. The UI still wants them shaped as `question.platforms.<name>`, so the
// join happens here and the components stay unchanged.
async function attachLatestRun(articles) {
  const questionIds = []
  for (const article of articles) {
    for (const question of article.questions ?? []) {
      if (question.question_id) questionIds.push(question.question_id)
    }
  }
  if (questionIds.length === 0) return articles

  const latest = await db
    .collection('answers')
    .aggregate([
      { $match: { question_id: { $in: questionIds } } },
      { $sort: { run_at: -1 } },
      {
        $group: {
          _id: { question_id: '$question_id', platform: '$platform' },
          doc: { $first: '$$ROOT' },
          run_count: { $sum: 1 }
        }
      },
      { $replaceRoot: { newRoot: { $mergeObjects: ['$doc', { run_count: '$run_count' }] } } }
    ])
    .toArray()

  const byQuestion = new Map()
  for (const doc of latest) {
    const key = String(doc.question_id)
    if (!byQuestion.has(key)) byQuestion.set(key, {})
    byQuestion.get(key)[doc.platform] = doc
  }

  for (const article of articles) {
    for (const question of article.questions ?? []) {
      const platforms = byQuestion.get(String(question.question_id))
      if (!platforms) continue

      question.platforms = platforms
      question.run_count = Math.max(...Object.values(platforms).map((p) => p.run_count ?? 1))
      // Explicit comparator: bare .sort() compares Dates as strings, which
      // orders "Wed Aug 20" before "Wed Aug 19".
      const runTimes = Object.values(platforms)
        .map((p) => p.run_at)
        .filter(Boolean)
        .sort((a, b) => new Date(a) - new Date(b))
      question.latest_run_at = runTimes.at(-1) ?? null
    }
  }

  return articles
}

// Every collection run for each question, oldest first — powers the timeline UI.
async function attachRunHistory(articles) {
  const questionIds = []
  for (const article of articles) {
    for (const question of article.questions ?? []) {
      if (question.question_id) questionIds.push(question.question_id)
    }
  }
  if (questionIds.length === 0) return articles

  const docs = await db
    .collection('answers')
    .find({ question_id: { $in: questionIds } })
    .sort({ run_at: 1, platform: 1 })
    .toArray()

  const byQuestion = new Map()
  for (const doc of docs) {
    const qKey = String(doc.question_id)
    const rKey = String(doc.run_id)
    if (!byQuestion.has(qKey)) byQuestion.set(qKey, new Map())
    const runs = byQuestion.get(qKey)
    if (!runs.has(rKey)) {
      runs.set(rKey, { run_id: doc.run_id, run_at: doc.run_at, platforms: {} })
    }
    runs.get(rKey).platforms[doc.platform] = doc
  }

  for (const article of articles) {
    const publishedAt = article.published_at
    for (const question of article.questions ?? []) {
      const runsMap = byQuestion.get(String(question.question_id))
      if (!runsMap) {
        question.runs = []
        continue
      }
      question.runs = [...runsMap.values()]
        .sort((a, b) => new Date(runAskedAt(a)) - new Date(runAskedAt(b)))
        .map((run) => ({
          ...run,
          asked_at: runAskedAt(run),
          milestone: milestoneForRun(publishedAt, runAskedAt(run))
        }))
    }
  }

  return articles
}

// Publish dates live in their own collection keyed by URL, so a source cited
// by twenty answers is fetched once. This stitches them back on at read time.
async function attachSourceDates(articles) {
  const urls = new Set()
  forEachCitation(articles, (c) => urls.add(canonicalUrl(c.url)))
  if (urls.size === 0) return articles

  const sources = await db
    .collection('sources')
    .find({ url: { $in: [...urls] }, method: 'manual' })
    .toArray()

  const byUrl = new Map(sources.map((s) => [s.url, s]))

  forEachCitation(articles, (c) => {
    const source = byUrl.get(canonicalUrl(c.url))
    c.source_published_at = source?.published_at ?? null
    c.source_precision = source?.precision ?? null
  })

  return articles
}

const app = express()
app.use(cors())
app.use(express.json({ limit: '5mb' }))

// Optional HTTP Basic Auth. Off when AUTH_PASSWORD is unset, so local dev is
// unchanged; set it in Railway and the whole app (UI and API) requires it.
const AUTH_USER = process.env.AUTH_USER || 'admin'
const AUTH_PASSWORD = process.env.AUTH_PASSWORD

// Compare digests rather than raw strings: timingSafeEqual needs equal-length
// buffers, and a plain === leaks length and prefix through timing.
const digest = (value) => createHash('sha256').update(String(value)).digest()
const matches = (a, b) => timingSafeEqual(digest(a), digest(b))

if (AUTH_PASSWORD) {
  app.use((req, res, next) => {
    const [scheme, encoded] = (req.headers.authorization ?? '').split(' ')

    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString()
      const separator = decoded.indexOf(':')
      const user = decoded.slice(0, separator)
      const password = decoded.slice(separator + 1)

      if (matches(user, AUTH_USER) && matches(password, AUTH_PASSWORD)) return next()
    }

    res.set('WWW-Authenticate', 'Basic realm="Breaking News Benchmark"')
    res.status(401).send('Authentication required')
  })
} else {
  console.log('AUTH_PASSWORD not set — running without authentication')
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true })
})

app.get('/api/articles', async (req, res) => {
  try {
    const articles = await db.collection('articles').find().toArray()
    res.json(await attachSourceDates(await attachRunHistory(await attachLatestRun(articles))))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch articles' })
  }
})

// Same payload every time: url + ground truth + platform_answers, indexed the
// way your scraper already emits them. A URL we've seen before records another
// run against the existing question_ids instead of creating a duplicate.
function questionKey(text) {
  return (text ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

app.post('/api/articles', async (req, res) => {
  try {
    const { url, published_at, snippet, questions, platform_answers } = req.body

    if (!url) {
      return res.status(400).json({ error: 'url is required' })
    }

    const built = buildQuestions(questions ?? [], platform_answers ?? [])
    const urlKey = canonicalUrl(url)
    const articles = db.collection('articles')

    let article = await articles.findOne({ url_key: urlKey })
    const created = !article

    if (created) {
      article = {
        url,
        url_key: urlKey,
        published_at: published_at ? new Date(published_at) : null,
        snippet: typeof snippet === 'string' && snippet.trim() ? snippet.trim() : null,
        questions: built.map((q) => ({
          question_id: new ObjectId(),
          question_index: q.question_index,
          question: q.question,
          answer: q.answer || null
        })),
        created_at: new Date()
      }
      const inserted = await articles.insertOne(article)
      article._id = inserted.insertedId
    }

    // Match this payload's questions onto the article's existing ones. Text
    // first, because question_index shifts if questions are ever reordered.
    const byText = new Map(article.questions.map((q) => [questionKey(q.question), q]))
    const byIndex = new Map(article.questions.map((q) => [q.question_index, q]))
    const appended = []

    const resolved = built.map((q) => {
      let match = byText.get(questionKey(q.question)) ?? byIndex.get(q.question_index)

      if (!match) {
        match = {
          question_id: new ObjectId(),
          question_index: article.questions.length + appended.length,
          question: q.question,
          answer: q.answer || null
        }
        appended.push(match)
      }
      return { built: q, question: match }
    })

    const $set = {}
    if (!created) {
      // Fill in details the first submission may have lacked, never overwrite.
      if (published_at && !article.published_at) $set.published_at = new Date(published_at)
      if (snippet?.trim() && !article.snippet) $set.snippet = snippet.trim()
    }

    if (appended.length || Object.keys($set).length) {
      await articles.updateOne(
        { _id: article._id },
        {
          ...(Object.keys($set).length ? { $set } : {}),
          ...(appended.length ? { $push: { questions: { $each: appended } } } : {})
        }
      )
    }

    const runId = new ObjectId()
    const runAt = req.body.run_at ? new Date(req.body.run_at) : new Date()
    if (Number.isNaN(runAt.getTime())) {
      return res.status(400).json({ error: 'run_at is not a valid date' })
    }
    const answerDocs = []

    for (const { built: q, question } of resolved) {
      for (const [platform, answer] of Object.entries(q.platforms ?? {})) {
        if (!answer) continue
        answerDocs.push({
          article_id: article._id,
          question_id: question.question_id,
          platform,
          run_id: runId,
          run_at: runAt,
          asked_at: answer.asked_at ?? null,
          answer: answer.answer ?? '',
          url: answer.url ?? null,
          citations: answer.citations ?? [],
          verdict: null,
          graded_at: null,
          note: null
        })
      }
    }

    if (answerDocs.length) await db.collection('answers').insertMany(answerDocs)

    const runNumber = await db
      .collection('answers')
      .distinct('run_id', { article_id: article._id })

    res.status(created ? 201 : 200).json({
      ok: true,
      article_id: article._id,
      created,
      run_id: runId,
      run_number: runNumber.length,
      questions_matched: resolved.length - appended.length,
      questions_added: appended.length,
      answers_recorded: answerDocs.length
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to save article' })
  }
})

// Article-level fields the form no longer demands up front — fill them in
// later from the Answers view. Only keys present in the body are touched.
// PATCH /api/articles/:id  { published_at, snippet }
app.patch('/api/articles/:id', async (req, res) => {
  try {
    const { id } = req.params
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Not a valid article id' })
    }

    const body = req.body ?? {}
    const $set = {}

    if ('published_at' in body) {
      if (body.published_at) {
        const when = new Date(body.published_at)
        if (Number.isNaN(when.getTime())) {
          return res.status(400).json({ error: 'published_at is not a valid date' })
        }
        $set.published_at = when
      } else {
        $set.published_at = null
      }
    }

    if ('snippet' in body) {
      const text = typeof body.snippet === 'string' ? body.snippet.trim() : ''
      $set.snippet = text || null
    }

    if (Object.keys($set).length === 0) {
      return res.status(400).json({ error: 'No recognised fields to update' })
    }

    const result = await db
      .collection('articles')
      .updateOne({ _id: new ObjectId(id) }, { $set })

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Article not found' })
    }

    res.json({ ok: true, updated: Object.keys($set) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to update article' })
  }
})

app.delete('/api/articles/:id', async (req, res) => {
  try {
    const { id } = req.params

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Not a valid article id' })
    }

    const result = await db
      .collection('articles')
      .deleteOne({ _id: new ObjectId(id) })

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Article not found' })
    }

    // Answers live in their own collection now, so they don't go with the
    // article automatically. Leaving them behind orphans every run.
    await db.collection('answers').deleteMany({ article_id: new ObjectId(id) })

    res.status(204).end()
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to delete article' })
  }
})

const VERDICTS = ['correct', 'partial', 'incorrect', 'abstained', 'speculation']
const JUDGMENTS = ['yes', 'no', 'unsure']

// Shared guard: every nested update targets one question inside one article.
function resolveTarget(req) {
  const { id, index } = req.params

  if (!ObjectId.isValid(id)) {
    return { error: 'Not a valid article id' }
  }

  const questionIndex = Number(index)
  if (!Number.isInteger(questionIndex) || questionIndex < 0) {
    return { error: 'Not a valid question index' }
  }

  return { _id: new ObjectId(id), questionIndex }
}

// Partial update of one question's annotations: the flag, the free-text notes,
// and the two judgments about whether the question was answerable without the
// article. Only fields present in the body are touched, so the UI can save one
// control at a time without clobbering the others.
// PATCH /api/articles/:id/questions/:index
app.patch('/api/articles/:id/questions/:index', async (req, res) => {
  try {
    const target = resolveTarget(req)
    if (target.error) return res.status(400).json({ error: target.error })

    const $set = {}
    const body = req.body ?? {}

    if ('flagged' in body) {
      const flagged = Boolean(body.flagged)
      $set['questions.$[q].flagged'] = flagged
      $set['questions.$[q].flagged_at'] = flagged ? new Date() : null
    }

    if ('notes' in body) {
      const notes = typeof body.notes === 'string' ? body.notes.trim() : ''
      $set['questions.$[q].notes'] = notes || null
      $set['questions.$[q].notes_at'] = notes ? new Date() : null
    }

    for (const field of ['answerable_from_snippet', 'answerable_from_history']) {
      if (!(field in body)) continue
      const value = body[field]
      if (value !== null && !JUDGMENTS.includes(value)) {
        return res
          .status(400)
          .json({ error: `${field} must be null or one of: ${JUDGMENTS.join(', ')}` })
      }
      $set[`questions.$[q].${field}`] = value
    }

    if (Object.keys($set).length === 0) {
      return res.status(400).json({ error: 'No recognised fields to update' })
    }

    const result = await db
      .collection('articles')
      .updateOne(
        { _id: target._id },
        { $set },
        { arrayFilters: [{ 'q.question_index': target.questionIndex }] }
      )

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Article not found' })
    }

    res.json({ ok: true, updated: Object.keys($set) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to save annotation' })
  }
})

// Manual citation publish dates, keyed by URL so one date applies everywhere
// that URL is cited. POST /api/sources  [{ url, published_at }]
app.post('/api/sources', async (req, res) => {
  try {
    const items = Array.isArray(req.body) ? req.body : [req.body]

    const ops = items
      .filter((s) => s?.url)
      .map((s) => ({
        updateOne: {
          filter: { url: canonicalUrl(s.url) },
          update: {
            $set: {
              url: canonicalUrl(s.url),
              published_at: s.published_at ? new Date(s.published_at) : null,
              precision: 'datetime',
              status: 'ok',
              method: 'manual',
              resolved_at: new Date()
            }
          },
          upsert: true
        }
      }))

    if (ops.length === 0) {
      return res.status(400).json({ error: 'No sources with a url provided' })
    }

    const result = await db.collection('sources').bulkWrite(ops)
    res.json({
      ok: true,
      inserted: result.upsertedCount,
      updated: result.modifiedCount
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to save sources' })
  }
})

// Flat CSV: one row per article x question x platform. That's the tidy shape
// for pandas/R — every row is one observation, no nested columns to unpack.
// GET /api/export.csv
function csvCell(value) {
  if (value === null || value === undefined) return ''
  const text = value instanceof Date ? value.toISOString() : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const EXPORT_COLUMNS = [
  'article_id', 'article_url', 'article_published_at', 'article_snippet',
  'question_index', 'question', 'ground_truth',
  'flagged', 'answerable_from_snippet', 'answerable_from_history', 'notes',
  'platform', 'answer', 'verdict', 'verdict_note', 'graded_at',
  'asked_at', 'run_at', 'lag_hours',
  'citation_count', 'citations_dated', 'oldest_citation_at', 'newest_citation_at',
  'citations_older_than_article', 'session_url'
]

app.get('/api/export.csv', async (req, res) => {
  try {
    const articles = await attachSourceDates(
      await attachLatestRun(await db.collection('articles').find().toArray())
    )

    const rows = [EXPORT_COLUMNS.join(',')]

    for (const article of articles) {
      const publishedAt = article.published_at ? new Date(article.published_at) : null

      for (const question of article.questions ?? []) {
        for (const platform of PLATFORMS) {
          const answer = question.platforms?.[platform]
          const askedAt = answer?.asked_at
            ? new Date(answer.asked_at)
            : question.asked_at
              ? new Date(question.asked_at)
              : null
          const runAt = answer?.run_at ? new Date(answer.run_at) : null

          const dated = (answer?.citations ?? [])
            .map((c) => (c.source_published_at ? new Date(c.source_published_at) : null))
            .filter(Boolean)
            .sort((a, b) => a - b)

          rows.push([
            article._id,
            article.url,
            publishedAt,
            article.snippet,
            question.question_index,
            question.question,
            question.answer,
            question.flagged ?? false,
            question.answerable_from_snippet,
            question.answerable_from_history,
            question.notes,
            platform,
            answer?.answer,
            answer?.verdict,
            answer?.note,
            answer?.graded_at ? new Date(answer.graded_at) : null,
            askedAt,
            runAt,
            publishedAt && askedAt
              ? ((askedAt - publishedAt) / 3600000).toFixed(2)
              : null,
            answer?.citations?.length ?? 0,
            dated.length,
            dated[0] ?? null,
            dated[dated.length - 1] ?? null,
            publishedAt ? dated.filter((d) => d < publishedAt).length : null,
            answer?.url
          ].map(csvCell).join(','))
        }
      }
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="benchmark-${new Date().toISOString().slice(0, 10)}.csv"`
    )
    res.send(rows.join('\n'))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to build export' })
  }
})

// Grade one answer — that is, one platform's response in one specific run.
// PATCH /api/answers/:id  { verdict, note }
app.patch('/api/answers/:id', async (req, res) => {
  try {
    const { id } = req.params
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Not a valid answer id' })
    }

    const { verdict, note } = req.body ?? {}
    if (verdict !== null && verdict !== undefined && !VERDICTS.includes(verdict)) {
      return res
        .status(400)
        .json({ error: `verdict must be null or one of: ${VERDICTS.join(', ')}` })
    }

    const $set = {}
    if ('verdict' in (req.body ?? {})) {
      $set.verdict = verdict ?? null
      $set.graded_at = verdict ? new Date() : null
    }
    if ('note' in (req.body ?? {})) {
      const text = typeof note === 'string' ? note.trim() : ''
      $set.note = text || null
    }

    if (Object.keys($set).length === 0) {
      return res.status(400).json({ error: 'No recognised fields to update' })
    }

    const result = await db.collection('answers').updateOne(
      { _id: new ObjectId(id) },
      { $set }
    )

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Answer not found' })
    }

    res.json({ ok: true, verdict })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to save verdict' })
  }
})

// In production Express also serves the built Svelte app, so the UI and the
// API share an origin. Anything that isn't an /api route falls through to
// index.html so client-side rendering can take over.
const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web/dist')

app.use(express.static(clientDir))

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: `No route for ${req.method} ${req.path}` })
  }
  res.sendFile(path.join(clientDir, 'index.html'), (err) => {
    if (err) res.status(404).send('Frontend not built — run `npm run build` in web/')
  })
})

const port = process.env.PORT || 3000
app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`)
})

