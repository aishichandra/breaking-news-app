import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, timingSafeEqual } from 'node:crypto'
import express from 'express'
import cors from 'cors'
import { GridFSBucket, MongoClient, ObjectId } from 'mongodb'
import { buildQuestions, PLATFORMS } from './normalize.js'
import { milestoneForRun, runAskedAt } from './reask-schedule.js'

const MONGODB_URI = process.env.MONGODB_URI

// Name the problem in one line. Handing undefined to MongoClient throws deep
// inside the driver's URL parser instead, which reads like a library bug and
// buries the fact that a variable simply was never set.
if (!MONGODB_URI) {
  console.error(
    'MONGODB_URI is not set. Add it to api/.env for local runs, or to the service variables on your host.'
  )
  process.exit(1)
}

const client = new MongoClient(MONGODB_URI)
// Overridable so the API can be pointed at a scratch database for end-to-end
// checks without writing into the live collections.
const db = client.db(process.env.MONGODB_DB || 'breaking_news')
// Screenshots (Google AI Overview evidence, see answers.py) live in Mongo
// via GridFS rather than on disk -- Railway's container filesystem is wiped
// on every redeploy, and this reuses infrastructure already paid for and
// configured instead of standing up a separate object store.
const screenshots = new GridFSBucket(db, { bucketName: 'screenshots' })

// A cluster can be briefly unreachable during a failover or a redeploy.
// Exiting on the first refusal spends one of the host's restart attempts, and
// hosts stop retrying after a handful — so a blip lasting seconds becomes a
// service that stays down until someone redeploys by hand.
async function connectWithRetry(attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await client.connect()
      console.log('Connected to MongoDB')
      return
    } catch (err) {
      if (attempt === attempts) throw err
      const wait = Math.min(1000 * 2 ** (attempt - 1), 15000)
      console.warn(
        `MongoDB connection failed (${attempt}/${attempts}): ${err.message} — retrying in ${wait}ms`
      )
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
  }
}

// createIndex is idempotent, so declaring these on boot costs nothing on a warm
// database and means a fresh one is shaped correctly without anyone remembering
// to run migrate-runs.js. Failures are logged, not fatal: missing indexes make
// reads slow, whereas refusing to start makes them impossible.
async function ensureIndexes() {
  const wanted = [
    ['articles', { url_key: 1 }, { unique: true }],
    ['answers', { question_id: 1, run_at: -1 }, {}],
    ['answers', { article_id: 1, question_id: 1, platform: 1, run_at: -1 }, {}],
    ['sources', { url: 1, method: 1 }, {}],
    // One queued re-ask per article: a second click while one is waiting
    // is the same request, not a second run. Unique at the database level
    // so two near-simultaneous clicks can't both get in.
    ['reask_queue', { article_id: 1 }, { unique: true }]
  ]

  for (const [collection, key, options] of wanted) {
    try {
      await db.collection(collection).createIndex(key, options)
    } catch (err) {
      console.warn(
        `Index on ${collection} ${JSON.stringify(key)} not applied: ${err.message}`
      )
    }
  }
}

await connectWithRetry()
await ensureIndexes()

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
// run. The UI wants two shapes out of that: the newest answer per platform as
// `question.platforms.<name>`, and every run in order as `question.runs`. Both
// come from the same documents, so this reads them once. Fetching twice — an
// aggregation for the latest and a find for the history — pulled every answer
// across the wire twice on every page load.
async function attachAnswers(articles) {
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
    let entry = byQuestion.get(qKey)
    if (!entry) {
      entry = { runs: new Map(), latest: {}, counts: {} }
      byQuestion.set(qKey, entry)
    }

    const rKey = String(doc.run_id)
    if (!entry.runs.has(rKey)) {
      entry.runs.set(rKey, { run_id: doc.run_id, run_at: doc.run_at, platforms: {} })
    }
    entry.runs.get(rKey).platforms[doc.platform] = doc

    // Ascending sort means the last document seen for a platform is its newest.
    entry.latest[doc.platform] = doc
    entry.counts[doc.platform] = (entry.counts[doc.platform] ?? 0) + 1
  }

  for (const article of articles) {
    const publishedAt = article.published_at
    for (const question of article.questions ?? []) {
      const entry = byQuestion.get(String(question.question_id))
      if (!entry) {
        question.runs = []
        continue
      }

      const platforms = {}
      for (const [platform, doc] of Object.entries(entry.latest)) {
        platforms[platform] = { ...doc, run_count: entry.counts[platform] }
      }

      question.platforms = platforms
      question.run_count = Math.max(...Object.values(entry.counts))

      // Explicit comparator: bare .sort() compares Dates as strings, which
      // orders "Wed Aug 20" before "Wed Aug 19".
      const runTimes = Object.values(platforms)
        .map((p) => p.run_at)
        .filter(Boolean)
        .sort((a, b) => new Date(a) - new Date(b))
      question.latest_run_at = runTimes.at(-1) ?? null

      question.runs = [...entry.runs.values()]
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
    .find({ url: { $in: [...urls] }, method: { $in: ['manual', 'pagedatefinder'] } })
    .toArray()

  const byUrl = new Map()
  for (const source of sources) {
    // Manual corrections (including explicit clearing) always win.
    if (!byUrl.has(source.url) || source.method === 'manual') byUrl.set(source.url, source)
  }

  forEachCitation(articles, (c) => {
    const source = byUrl.get(canonicalUrl(c.url))
    c.source_published_at = source?.published_at ?? null
    c.source_precision = source?.precision ?? null
  })

  return articles
}

// Which articles are waiting on a manually-triggered re-ask (see the
// /reask routes below), and where in line -- position 1 is next. The queue is
// tiny (a handful of entries at most), so one read per page load is fine.
async function attachReaskQueue(articles) {
  const queued = await db.collection('reask_queue').find({}).sort({ requested_at: 1 }).toArray()
  const byArticle = new Map(queued.map((entry, i) => [String(entry.article_id), { requested_at: entry.requested_at, position: i + 1 }]))

  for (const article of articles) {
    article.reask_queued = byArticle.get(String(article._id)) ?? null
  }
  return articles
}

const app = express()
app.use(cors())
app.use(express.json({ limit: '5mb' }))

// Registered above the auth gate so uptime checks keep working once a password
// is set — a monitor that receives 401 cannot distinguish "locked" from "down".
app.get('/api/health', (req, res) => {
  res.json({ ok: true })
})

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

// Newest addition first. Ordering on when a row was *added* rather than when
// the story was published keeps whatever you just entered at the top of the
// page, which is where you go looking for it.
app.get('/api/articles', async (req, res) => {
  try {
    const articles = await db
      .collection('articles')
      .aggregate([
        // Rows written before created_at existed fall back to the timestamp
        // baked into their ObjectId, so they sort sensibly instead of sinking
        // to the bottom as nulls.
        { $addFields: { added_at: { $ifNull: ['$created_at', { $toDate: '$_id' }] } } },
        { $sort: { added_at: -1 } },
        { $unset: 'added_at' }
      ])
      .toArray()

    res.json(await attachReaskQueue(await attachSourceDates(await attachAnswers(articles))))
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
    const { url, published_at, updated_at, snippet, markdown, exclusive, questions, platform_answers } =
      req.body

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
        // The story's own "Updated on…" stamp, separate from created_at, which
        // is when this row was written. Breaking news gets rewritten in place,
        // so the two dates answer different questions.
        updated_at: updated_at ? new Date(updated_at) : null,
        snippet: typeof snippet === 'string' && snippet.trim() ? snippet.trim() : null,
        // The article's full text as it read when this run was collected. News
        // pages get rewritten under their own URLs, so the snapshot is the only
        // record of what the platforms could actually have been reading.
        markdown: typeof markdown === 'string' && markdown.trim() ? markdown.trim() : null,
        markdown_at: typeof markdown === 'string' && markdown.trim() ? new Date() : null,
        // An outlet either has a story alone or it doesn't — unlike the
        // free-text fields above, there's no "unknown yet" to preserve, so
        // this is the one field here safe to set outright on creation
        // rather than only filling in when missing.
        exclusive: typeof exclusive === 'boolean' ? exclusive : false,
        exclusive_at: exclusive ? new Date() : null,
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
      if (markdown?.trim() && !article.markdown) {
        $set.markdown = markdown.trim()
        $set.markdown_at = new Date()
      }

      // The exception to never-overwrite: a revision stamp is *expected* to
      // move. A later run reporting a newer edit is news, not a correction.
      if (updated_at) {
        const revised = new Date(updated_at)
        if (!Number.isNaN(revised.getTime())) {
          if (!article.updated_at || revised > new Date(article.updated_at)) {
            $set.updated_at = revised
          }
        }
      }
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
        // Same rule the run path uses: a slot left untouched in the pasted
        // template — no text, no citations, no session link — is a platform
        // that was never asked. Recording it fabricates an empty response.
        if (emptyPlatformAnswer(answer)) continue
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
          screenshot_id: answer.screenshot_id ?? null,
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

function emptyPlatformAnswer(answer) {
  if (!answer) return true
  const text = typeof answer.answer === 'string' ? answer.answer.trim() : ''
  const cites = answer.citations ?? []
  // A screenshot alone still counts as "asked" -- answers.py captures one on
  // a failed Google run too, specifically so there's something to look at
  // when the answer text came back empty.
  return !text && (!Array.isArray(cites) || cites.length === 0) && !answer.url && !answer.screenshot_id
}

// Matches a batch of scraper entries onto an article's stored questions and
// builds the answer documents for one run. Shared by the two endpoints that
// record answers, so the rules below hold identically for both.
//
// `positional` is the list the caller's paste is ordered against, used for the
// index fallback: the active questions for a plain update, or just the newly
// added ones when questions and answers arrive together.
function resolveRun({ article, platform_answers, runAt, positional = null }) {
  const all = [...(article.questions ?? [])].sort(
    (a, b) => (a.question_index ?? 0) - (b.question_index ?? 0)
  )

  // A question flagged as bad is out of the experiment. The update form already
  // omits them from the list you copy, so a run must not be able to record
  // answers against one — not by text, not by position, and not by inheriting
  // its ground truth when an entry arrives without question text.
  const active = all.filter((q) => !q.flagged)
  const flaggedByText = new Map(
    all.filter((q) => q.flagged).map((q) => [questionKey(q.question), q])
  )

  const order = (positional ?? active).filter((q) => !q.flagged)
  const groundTruth = order.map((q) => ({ question: q.question, answer: q.answer }))

  const built = buildQuestions(groundTruth, platform_answers)
  const byText = new Map(active.map((q) => [questionKey(q.question), q]))
  // Positional fallback counts through `order`, the trimmed list the caller
  // pasted against. Keying on the stored question_index would point at whatever
  // sits at that index in the full list — quite possibly a flagged one.
  const byPosition = new Map(order.map((q, i) => [i, q]))

  const skipped = []
  const answerDocs = []
  const runId = new ObjectId()
  let matched = 0

  for (const q of built) {
    const key = questionKey(q.question)

    // Checked before the positional fallback, not after: an entry naming a
    // flagged question would otherwise miss on text and then get absorbed by
    // whatever active question sits at its position — recording answers to the
    // wrong question instead of declining to record them at all.
    if (flaggedByText.has(key)) {
      skipped.push(`${q.question} — flagged as a bad question`)
      continue
    }

    const match = byText.get(key) ?? byPosition.get(q.question_index)
    if (!match) {
      skipped.push(q.question || `(question_index ${q.question_index})`)
      continue
    }

    matched++
    for (const [platform, answer] of Object.entries(q.platforms ?? {})) {
      if (emptyPlatformAnswer(answer)) continue
      answerDocs.push({
        article_id: article._id,
        question_id: match.question_id,
        platform,
        run_id: runId,
        run_at: runAt,
        asked_at: answer.asked_at ?? null,
        answer: answer.answer ?? '',
        url: answer.url ?? null,
        citations: answer.citations ?? [],
        screenshot_id: answer.screenshot_id ?? null,
        verdict: null,
        graded_at: null,
        note: null
      })
    }
  }

  return { skipped, answerDocs, matched, runId }
}

// Ground-truth Q&A appended to an article after it was first entered — the
// experiment grows a question, or a developing story earns one. Answers for the
// new questions can ride along in the same submission; without them the
// questions sit empty until the next update run.
// POST /api/articles/:id/questions
//   { questions: [{ question, answer }], platform_answers?, run_at? }
app.post('/api/articles/:id/questions', async (req, res) => {
  try {
    const { id } = req.params
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Not a valid article id' })
    }

    const incoming = Array.isArray(req.body) ? req.body : req.body?.questions
    if (!Array.isArray(incoming) || incoming.length === 0) {
      return res.status(400).json({ error: 'questions must be a non-empty array' })
    }

    // Validated before anything is written, so a bad run_at cannot leave the
    // questions appended and the answers dropped.
    const platform_answers = Array.isArray(req.body?.platform_answers)
      ? req.body.platform_answers
      : []

    const runAt = req.body?.run_at ? new Date(req.body.run_at) : new Date()
    if (Number.isNaN(runAt.getTime())) {
      return res.status(400).json({ error: 'run_at is not a valid date' })
    }

    const articles = db.collection('articles')
    const article = await articles.findOne({ _id: new ObjectId(id) })
    if (!article) {
      return res.status(404).json({ error: 'Article not found' })
    }

    const existing = article.questions ?? []
    // Keyed by text so a duplicate can report WHY it was skipped — telling you a
    // question is already there because you flagged it as bad is more useful
    // than telling you it is already there.
    const existingByKey = new Map(existing.map((q) => [questionKey(q.question), q]))
    const seen = new Set(existingByKey.keys())

    // Continue past the highest index in use rather than counting the array:
    // if a question is ever removed, length would hand out an index that
    // stored answers already point at.
    let nextIndex = existing.reduce(
      (max, q) => Math.max(max, (q.question_index ?? -1) + 1),
      0
    )

    const added = []
    const skipped = []

    for (const entry of incoming) {
      const question = typeof entry?.question === 'string' ? entry.question.trim() : ''
      if (!question) {
        skipped.push({ question: null, reason: 'no question text' })
        continue
      }

      const key = questionKey(question)
      if (seen.has(key)) {
        skipped.push({
          question,
          reason: existingByKey.get(key)?.flagged
            ? 'already on this article, flagged as a bad question'
            : 'already on this article'
        })
        continue
      }
      seen.add(key)

      const answer = typeof entry?.answer === 'string' ? entry.answer.trim() : ''
      added.push({
        question_id: new ObjectId(),
        question_index: nextIndex++,
        question,
        answer: answer || null
      })
    }

    if (added.length === 0) {
      return res.status(400).json({ error: 'No new questions to add', skipped })
    }

    await articles.updateOne(
      { _id: article._id },
      { $push: { questions: { $each: added } } }
    )

    if (platform_answers.length === 0) {
      return res.json({ ok: true, added: added.length, skipped })
    }

    // Answers pasted alongside new questions are ordered against those new
    // questions, so they drive the positional fallback. Text matching still
    // reaches every active question, so pasting a full scraper dump lands its
    // answers on the existing questions too.
    const run = resolveRun({
      article: { ...article, questions: [...existing, ...added] },
      platform_answers,
      runAt,
      positional: added
    })

    if (run.answerDocs.length > 0) {
      await db.collection('answers').insertMany(run.answerDocs)
    }

    res.json({
      ok: true,
      added: added.length,
      skipped,
      run_id: run.answerDocs.length ? run.runId : null,
      questions_matched: run.matched,
      questions_skipped: run.skipped,
      answers_recorded: run.answerDocs.length
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to add questions' })
  }
})

// New collection run against an existing article. Matches scraper entries onto
// stored questions by text, then by position. Questions flagged as bad are out
// of the experiment and take no part in matching. Unmatched entries are skipped
// (reported), not added.
app.post('/api/articles/:id/runs', async (req, res) => {
  try {
    const { id } = req.params
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Not a valid article id' })
    }

    const platform_answers = req.body?.platform_answers
    if (!Array.isArray(platform_answers) || platform_answers.length === 0) {
      return res.status(400).json({ error: 'platform_answers must be a non-empty array' })
    }

    const articles = db.collection('articles')
    const article = await articles.findOne({ _id: new ObjectId(id) })
    if (!article) {
      return res.status(404).json({ error: 'Article not found' })
    }

    const runAt = req.body.run_at ? new Date(req.body.run_at) : new Date()
    if (Number.isNaN(runAt.getTime())) {
      return res.status(400).json({ error: 'run_at is not a valid date' })
    }

    const { skipped, answerDocs, matched, runId } = resolveRun({
      article,
      platform_answers,
      runAt
    })

    if (answerDocs.length === 0) {
      return res.status(400).json({
        error: skipped.length
          ? `None of the pasted questions matched this article. Unmatched: ${skipped.slice(0, 3).join('; ')}`
          : 'No platform answers to record (empty slots are ignored)'
      })
    }

    await db.collection('answers').insertMany(answerDocs)
    const runNumber = await db.collection('answers').distinct('run_id', { article_id: article._id })

    res.status(201).json({
      ok: true,
      article_id: article._id,
      run_id: runId,
      run_number: runNumber.length,
      questions_matched: matched,
      questions_skipped: skipped,
      answers_recorded: answerDocs.length
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to record update' })
  }
})

// Article-level fields the form no longer demands up front — fill them in
// later from the Answers view. Only keys present in the body are touched.
// PATCH /api/articles/:id  { published_at, updated_at, snippet, markdown, exclusive }
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

    if ('updated_at' in body) {
      if (body.updated_at) {
        const when = new Date(body.updated_at)
        if (Number.isNaN(when.getTime())) {
          return res.status(400).json({ error: 'updated_at is not a valid date' })
        }
        $set.updated_at = when
      } else {
        $set.updated_at = null
      }
    }

    // An exclusive is a story only one outlet has. Worth marking because it
    // changes what a platform could possibly have been reading: no wire copy,
    // no aggregators, nothing to synthesise an answer from but the original.
    if ('exclusive' in body) {
      if (typeof body.exclusive !== 'boolean') {
        return res.status(400).json({ error: 'exclusive must be true or false' })
      }
      $set.exclusive = body.exclusive
      $set.exclusive_at = body.exclusive ? new Date() : null
    }

    if ('snippet' in body) {
      const text = typeof body.snippet === 'string' ? body.snippet.trim() : ''
      $set.snippet = text || null
    }

    if ('markdown' in body) {
      const text = typeof body.markdown === 'string' ? body.markdown.trim() : ''
      $set.markdown = text || null
      // Stamped on every write: an edited snapshot is a snapshot of a later
      // moment, and which moment it captures is the point of the field.
      $set.markdown_at = text ? new Date() : null
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
    await db.collection('reask_queue').deleteMany({ article_id: new ObjectId(id) })

    res.status(204).end()
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to delete article' })
  }
})

// Manual re-ask queue. The pipeline no longer re-asks a story's questions on
// its own schedule -- it alerts (Slack) when a 30m/1h/5h/1d mark comes due,
// and a re-ask only happens when someone asks for one here. Each entry is one
// article waiting to have its unflagged questions put to the four platforms
// again; the pipeline's answer worker polls GET /api/reask-queue, works
// through it oldest first, and DELETEs each entry once the fresh answers are
// recorded -- so an entry existing means "still waiting," and a worker that
// dies mid-re-ask simply finds the same entry on its next poll.
// POST /api/articles/:id/reask
app.post('/api/articles/:id/reask', async (req, res) => {
  try {
    const { id } = req.params
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Not a valid article id' })
    }

    const article = await db
      .collection('articles')
      .findOne({ _id: new ObjectId(id) }, { projection: { questions: 1 } })
    if (!article) {
      return res.status(404).json({ error: 'Article not found' })
    }
    if (!(article.questions ?? []).some((q) => !q.flagged)) {
      return res.status(400).json({ error: 'Every question on this article is flagged, so there is nothing to re-ask' })
    }

    // Upsert on article_id: a second click while one is waiting leaves the
    // original entry (and its place in line) alone. The unique index turns a
    // simultaneous double-click into a duplicate-key error rather than two
    // entries, which is the same outcome.
    let alreadyQueued = false
    try {
      const result = await db
        .collection('reask_queue')
        .updateOne(
          { article_id: article._id },
          { $setOnInsert: { article_id: article._id, requested_at: new Date() } },
          { upsert: true }
        )
      alreadyQueued = result.upsertedCount === 0
    } catch (err) {
      if (err.code !== 11000) throw err
      alreadyQueued = true
    }

    res.status(alreadyQueued ? 200 : 201).json({ queued: true, already_queued: alreadyQueued })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to queue re-ask' })
  }
})

// Removes an article's queued re-ask -- both "cancel" from the UI and
// "done" from the worker. The worker passes the requested_at it was handed,
// so if the entry was cancelled and queued again while its run was in flight
// (say, after editing a question, which that run wouldn't have picked up),
// the newer request survives instead of being swallowed by the older run.
// DELETE /api/articles/:id/reask[?requested_at=<iso>]
app.delete('/api/articles/:id/reask', async (req, res) => {
  try {
    const { id } = req.params
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Not a valid article id' })
    }

    const filter = { article_id: new ObjectId(id) }
    if (req.query.requested_at) {
      const requestedAt = new Date(req.query.requested_at)
      if (Number.isNaN(requestedAt.getTime())) {
        return res.status(400).json({ error: 'requested_at is not a valid date' })
      }
      filter.requested_at = requestedAt
    }

    const { deletedCount } = await db.collection('reask_queue').deleteOne(filter)
    res.json({ removed: deletedCount > 0 })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to cancel re-ask' })
  }
})

// What the answer worker needs to run the queue: oldest request first, each
// with the article's URL and its current unflagged questions -- the same
// text and ground truth shown (and possibly edited) in this UI, so an edit
// made here is what actually gets asked. The article's markdown is left out
// on purpose: nothing about asking uses it, and it is the bulky field.
// GET /api/reask-queue
app.get('/api/reask-queue', async (req, res) => {
  try {
    const entries = await db
      .collection('reask_queue')
      .aggregate([
        { $sort: { requested_at: 1 } },
        { $lookup: { from: 'articles', localField: 'article_id', foreignField: '_id', as: 'article' } },
        { $project: { requested_at: 1, article_id: 1, 'article.url': 1, 'article.published_at': 1, 'article.exclusive': 1, 'article.questions': 1 } }
      ])
      .toArray()

    res.json({
      items: entries.map((entry) => {
        const article = entry.article[0]
        return {
          article_id: entry.article_id,
          requested_at: entry.requested_at,
          // Null when the article was deleted after this was queued (the
          // DELETE route above also clears its entries, but a direct database
          // edit wouldn't) -- the worker completes such an entry as a no-op.
          url: article?.url ?? null,
          published_at: article?.published_at ?? null,
          exclusive: article?.exclusive ?? false,
          questions: (article?.questions ?? [])
            .filter((q) => !q.flagged)
            .sort((a, b) => (a.question_index ?? 0) - (b.question_index ?? 0))
            .map((q) => ({ question_index: q.question_index, question: q.question, answer: q.answer }))
        }
      })
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch re-ask queue' })
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

// Partial update of one question: its text, its ground-truth answer, the
// flag, the free-text notes, and the two judgments about whether the
// question was answerable without the article. Only fields present in the
// body are touched, so the UI can save one control at a time without
// clobbering the others.
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

    // Editing the question text or its ground-truth answer -- distinct from
    // PATCH /api/answers/:id, which corrects what a *platform* said. The
    // pipeline's answer_worker.py re-asks using whatever this app currently
    // has, so an edit here is what actually gets asked going forward, not
    // just a display change. The first edit stashes the original the same
    // way a corrected platform answer does, so nothing is silently lost.
    const editingText = 'question' in body
    const editingAnswer = 'answer' in body

    if (editingText || editingAnswer) {
      const doc = await db
        .collection('articles')
        .findOne(
          { _id: target._id, 'questions.question_index': target.questionIndex },
          { projection: { 'questions.$': 1 } }
        )
      const current = doc?.questions?.[0]
      if (!current) {
        return res.status(404).json({ error: 'Article or question not found' })
      }

      if (editingText) {
        const text = typeof body.question === 'string' ? body.question.trim() : ''
        if (!text) {
          return res.status(400).json({ error: 'question must be a non-empty string' })
        }
        $set['questions.$[q].question'] = text
        $set['questions.$[q].question_edited_at'] = new Date()
        if (current.question_original === undefined) {
          $set['questions.$[q].question_original'] = current.question
        }
      }

      if (editingAnswer) {
        const text = typeof body.answer === 'string' ? body.answer.trim() : ''
        $set['questions.$[q].answer'] = text || null
        $set['questions.$[q].answer_edited_at'] = new Date()
        if (current.answer_original === undefined) {
          $set['questions.$[q].answer_original'] = current.answer ?? null
        }
      }
    }

    if (Object.keys($set).length === 0) {
      return res.status(400).json({ error: 'No recognised fields to update' })
    }

    const result = await db
      .collection('articles')
      .updateOne(
        // Match the question too. Filtering on _id alone reports success when
        // the article exists but carries no question at that index — the
        // arrayFilter quietly matches nothing and the caller is told it saved.
        { _id: target._id, 'questions.question_index': target.questionIndex },
        { $set },
        { arrayFilters: [{ 'q.question_index': target.questionIndex }] }
      )

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Article or question not found' })
    }

    res.json({ ok: true, updated: Object.keys($set) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to save annotation' })
  }
})

// Manual citation publish dates, keyed by URL so one date applies everywhere
// that URL is cited. POST /api/sources  [{ url, published_at, precision }]
// `precision` is 'date' when the source printed a day but no clock time, so the
// UI knows not to show the placeholder hour it was stored with.
app.post('/api/sources', async (req, res) => {
  try {
    const items = Array.isArray(req.body) ? req.body : [req.body]

    const bad = items.find(
      (s) => s?.precision != null && !['date', 'datetime'].includes(s.precision)
    )
    if (bad) {
      return res.status(400).json({ error: "precision must be 'date' or 'datetime'" })
    }

    const invalid = items.find((s) =>
      (s?.method != null && !['manual', 'pagedatefinder'].includes(s.method)) ||
      (s?.published_at && Number.isNaN(new Date(s.published_at).getTime()))
    )
    if (invalid) return res.status(400).json({ error: 'Invalid source method or publication date' })

    const ops = items
      .filter((s) => s?.url)
      .map((s) => ({
        updateOne: {
          filter: { url: canonicalUrl(s.url), method: s.method ?? 'manual' },
          update: {
            $set: {
              url: canonicalUrl(s.url),
              published_at: s.published_at ? new Date(s.published_at) : null,
              // No date, no precision to describe — clearing one leaves the
              // record saying "we looked and don't know", not "midnight".
              precision: s.published_at ? s.precision ?? 'datetime' : null,
              status: 'ok',
              method: s.method ?? 'manual',
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

// Full dump of the collections as stored in MongoDB — articles, answers, and
// sources — so nothing collected is flattened away.
// GET /api/export.json
app.get('/api/export.json', async (req, res) => {
  try {
    const [articles, answers, sources] = await Promise.all([
      db.collection('articles').find().toArray(),
      db.collection('answers').find().toArray(),
      db.collection('sources').find().toArray()
    ])

    const payload = { articles, answers, sources }
    const stamp = new Date().toISOString().slice(0, 10)

    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="breaking-news-${stamp}.json"`
    )
    res.send(JSON.stringify(payload, null, 2))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to build export' })
  }
})

app.get('/api/export.csv', (req, res) => {
  res.redirect(301, '/api/export.json')
})

// Grade one answer — that is, one platform's response in one specific run.
// PATCH /api/answers/:id  { verdict, note, answer }
app.patch('/api/answers/:id', async (req, res) => {
  try {
    const { id } = req.params
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Not a valid answer id' })
    }

    const body = req.body ?? {}
    const { verdict, note, answer } = body
    if (verdict !== null && verdict !== undefined && !VERDICTS.includes(verdict)) {
      return res
        .status(400)
        .json({ error: `verdict must be null or one of: ${VERDICTS.join(', ')}` })
    }

    const $set = {}
    if ('verdict' in body) {
      $set.verdict = verdict ?? null
      $set.graded_at = verdict ? new Date() : null
    }
    if ('note' in body) {
      const text = typeof note === 'string' ? note.trim() : ''
      $set.note = text || null
    }

    // A scrape that mangled the response — truncated it, dropped a paragraph,
    // swallowed the markup — can be corrected by hand. What the platform
    // actually returned is the evidence this whole study rests on, though, so
    // the first correction stashes the scraped text under `answer_original`
    // and later ones leave that untouched. Both fields go out in the export.
    if ('answer' in body) {
      if (typeof answer !== 'string') {
        return res.status(400).json({ error: 'answer must be a string' })
      }

      const existing = await db
        .collection('answers')
        .findOne({ _id: new ObjectId(id) }, { projection: { answer: 1, answer_original: 1 } })

      if (!existing) {
        return res.status(404).json({ error: 'Answer not found' })
      }

      $set.answer = answer.trim()
      $set.answer_edited_at = new Date()
      if (existing.answer_original === undefined) {
        $set.answer_original = existing.answer ?? ''
      }
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

    res.json({
      ok: true,
      verdict,
      answer: $set.answer,
      answer_original: $set.answer_original,
      answer_edited_at: $set.answer_edited_at
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to save answer' })
  }
})

// Screenshots (Google AI Overview evidence -- see answers.py) live in
// GridFS, uploaded once by the pipeline right after capture and referenced
// from then on by id (answers.screenshot_id) rather than re-sent on every
// read. POST accepts base64 rather than a raw binary body so it fits the
// same express.json() middleware everything else here already uses.
// POST /api/screenshots  { data: "<base64 png>" }
app.post('/api/screenshots', async (req, res) => {
  try {
    const { data } = req.body ?? {}
    if (typeof data !== 'string' || !data) {
      return res.status(400).json({ error: 'data (base64-encoded image) is required' })
    }

    const buffer = Buffer.from(data, 'base64')
    if (buffer.length === 0) {
      return res.status(400).json({ error: 'data decoded to an empty file' })
    }

    const uploadStream = screenshots.openUploadStream('screenshot.png', {
      contentType: 'image/png'
    })

    uploadStream.on('finish', () => {
      res.status(201).json({ ok: true, id: uploadStream.id.toString() })
    })
    uploadStream.on('error', (err) => {
      console.error(err)
      if (!res.headersSent) res.status(500).json({ error: 'Failed to store screenshot' })
    })

    uploadStream.end(buffer)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to store screenshot' })
  }
})

// Streams the PNG back so the UI can use this directly as an <img src>.
// GET /api/screenshots/:id
app.get('/api/screenshots/:id', (req, res) => {
  const { id } = req.params
  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Not a valid screenshot id' })
  }

  const downloadStream = screenshots.openDownloadStream(new ObjectId(id))
  downloadStream.on('file', (file) => {
    res.set('Content-Type', file.contentType || 'image/png')
    // Content-addressed by id -- an id's bytes never change once uploaded.
    res.set('Cache-Control', 'private, max-age=31536000, immutable')
  })
  downloadStream.on('error', () => {
    if (!res.headersSent) res.status(404).json({ error: 'Screenshot not found' })
  })
  downloadStream.pipe(res)
})

// Manually records one platform's answer for a question that has none yet in
// a given run -- the platform genuinely wasn't recorded (a failed scrape, a
// timeout) so there's no existing document to correct with PATCH
// /api/answers/:id, only a gap to fill by hand. Marked `manual: true` so the
// export can tell a hand-entered answer apart from a scrape, the same way
// `answer_original` marks a corrected one.
// POST /api/articles/:id/questions/:index/answers
//   { run_id, platform, answer, url?, citations? }
app.post('/api/articles/:id/questions/:index/answers', async (req, res) => {
  try {
    const target = resolveTarget(req)
    if (target.error) return res.status(400).json({ error: target.error })

    const { run_id, platform, answer, url, citations } = req.body ?? {}

    if (!PLATFORMS.includes(platform)) {
      return res.status(400).json({ error: `platform must be one of: ${PLATFORMS.join(', ')}` })
    }
    if (!ObjectId.isValid(run_id)) {
      return res.status(400).json({ error: 'run_id is not valid' })
    }
    const text = typeof answer === 'string' ? answer.trim() : ''
    if (!text) {
      return res.status(400).json({ error: 'answer must be a non-empty string' })
    }

    const article = await db
      .collection('articles')
      .findOne({ _id: target._id, 'questions.question_index': target.questionIndex })
    if (!article) {
      return res.status(404).json({ error: 'Article or question not found' })
    }
    const question = article.questions.find((q) => q.question_index === target.questionIndex)

    // The run has to already exist -- found via any other platform's document
    // in it -- so a client can't invent a stray run_id that never came from
    // an actual collection pass. Its run_at rides along so the new document
    // sits in the same timeline slot as its sibling platforms.
    const runDoc = await db.collection('answers').findOne({
      question_id: question.question_id,
      run_id: new ObjectId(run_id)
    })
    if (!runDoc) {
      return res.status(404).json({ error: 'That run does not exist for this question' })
    }

    const clash = await db.collection('answers').findOne({
      question_id: question.question_id,
      run_id: new ObjectId(run_id),
      platform
    })
    if (clash) {
      return res.status(409).json({
        error: `${platform} already has an answer in this run — edit it instead of adding a new one`
      })
    }

    const doc = {
      article_id: target._id,
      question_id: question.question_id,
      platform,
      run_id: new ObjectId(run_id),
      run_at: runDoc.run_at,
      asked_at: null,
      answer: text,
      url: typeof url === 'string' && url.trim() ? url.trim() : null,
      citations: Array.isArray(citations) ? citations : [],
      verdict: null,
      graded_at: null,
      note: null,
      manual: true,
      added_at: new Date()
    }

    const inserted = await db.collection('answers').insertOne(doc)
    res.status(201).json({ ...doc, _id: inserted.insertedId })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to add answer' })
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
const server = app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`)
})

// Hosts send SIGTERM before replacing a container. Without this the process is
// killed mid-request and the Mongo connection is severed rather than closed.
let shuttingDown = false

async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`${signal} received — closing server and database connection`)
  server.close()
  try {
    await client.close()
  } catch (err) {
    console.error('Error closing MongoDB connection:', err.message)
  }
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

// A stray rejected promise should not take the process down: the driver
// reconnects on its own, and staying up keeps the rest of the API serving. An
// uncaught exception is different — state is no longer trustworthy, so log it
// and let the host restart cleanly.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason)
})

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err)
  process.exit(1)
})

