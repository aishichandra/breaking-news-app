import {registerSourceDates} from './source-dates.js'
import {registerAnswerReview} from './answer-review.js'
import {registerVerdictCategories} from './verdict-categories.js'
import {registerArchive} from './archive.js'
import {registerArticleIngestion} from './article-ingestion.js'
import {authentication} from './auth.js'
import {reviewAudit} from './review-audit.js'
import {registerArticleReads} from './article-reads.js'
import {assertAuthentication,productionEnvironment,allowedOrigin,requestSecurity} from './security.js'
import {validateIngestion,validDate,questionKey,ingestionRunId,answerUpserts,resolveQuestion} from './ingestion.js'
import {safeHttpUrl} from '../safe-url.mjs'
import {registerQuestionRetries,attachQuestionRetries} from './question-retries.js'
import { activeDataset } from '../active-dataset.mjs'
import { registerDomainLibrary } from './domain-library.js'
import { createLiveHistory } from './live-history.js'
import { tmpdir } from 'node:os'
import { gzip } from 'node:zlib'
import { promisify } from 'node:util'
const gzipHistory = promisify(gzip)
import { createReviewCache, updateCachedAnswer } from './review-cache.js'
import { registerCitationTypes } from './citation-types.js'
import { confidenceUpdate } from './confidence.js'
import { sourceCitationStatus } from '../source-match.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, timingSafeEqual } from 'node:crypto'
import express from 'express'
import cors from 'cors'
import { GridFSBucket, MongoClient, ObjectId } from 'mongodb'
import { buildQuestions, cleanManualCitations, PLATFORMS } from './normalize.js'
import { milestoneForRun, runAskedAt } from './reask-schedule.js'

assertAuthentication(process.env)
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

if (process.env.LOCAL_REVIEW === '1' && process.env.MONGODB_DB !== 'breaking_news_local_review') {
  throw new Error('Local review requires the isolated breaking_news_local_review database')
}
const client = new MongoClient(MONGODB_URI, { compressors: ['zlib'] })
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
async function attachAnswers(articles, {summary = false, study = false} = {}) {
  const questionIds = []
  for (const article of articles) {
    for (const question of article.questions ?? []) {
      if (question.question_id) questionIds.push(question.question_id)
    }
  }
  if (questionIds.length === 0) return articles

  const docs = await db
    .collection('answers')
    .find({ question_id: { $in: questionIds } }, summary ? {projection: {_id:1, article_id:1, question_id:1, platform:1, run_id:1, run_at:1, asked_at:1, verdict:1, confidence:1, question_variant:1,model:1,has_response:{$ne:[{$trim:{input:{$ifNull:['$answer','']}}},'']},...(study?{citations:1}: {})}} : {})
    .sort({ run_at: 1, platform: 1 })
    .toArray()

  const sourceUrls = new Map(articles.map((article) => [String(article._id), article.url]))
  const byQuestion = new Map()
  for (const doc of docs) {
    doc.original_source_cited = sourceCitationStatus(sourceUrls.get(String(doc.article_id)), doc.citations)
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
app.disable('x-powered-by')
app.use(requestSecurity())
app.use(cors((req, done) => done(null, {origin: allowedOrigin(req) ? req.get('Origin') || false : false})))
app.use(express.json({ limit: '5mb' }))

// Registered above the auth gate so uptime checks keep working once a password
// is set — a monitor that receives 401 cannot distinguish "locked" from "down".
app.get('/api/health', (req, res) => {
  res.json({ ok: true })
})

app.use(authentication())
app.use(reviewAudit(db))

app.get('/api/environment', async (req, res) => {
  const snapshot = process.env.LOCAL_REVIEW === '1' ? await db.collection('_local_meta').findOne({_id:'snapshot'}) : null
  res.json({local:process.env.LOCAL_REVIEW === '1', snapshot_at:snapshot?.created_at??null})
})
registerCitationTypes(app, db)
registerDomainLibrary(app, db)

// Newest addition first. Ordering on when a row was *added* rather than when
// the story was published keeps whatever you just entered at the top of the
// page, which is where you go looking for it.
async function loadArticleHistory() {
    const articles = await db
      .collection('articles')
      .aggregate([
        // Rows written before created_at existed fall back to the timestamp
        // baked into their ObjectId, so they sort sensibly instead of sinking
        // to the bottom as nulls.
        { $match: {deleted_at: {$exists:false}} },
        { $addFields: { added_at: { $ifNull: ['$created_at', { $toDate: '$_id' }] } } },
        { $sort: { added_at: -1 } },
        { $unset: 'added_at' }
      ])
      .toArray()

    return JSON.stringify(await attachReaskQueue(await attachSourceDates(await attachAnswers(await attachQuestionRetries(db,articles)))))
}
const snapshotIdentity = process.env.LOCAL_REVIEW === '1'
  ? await db.collection('_local_meta').findOne({_id:'snapshot'}) : null
const cacheFile = process.env.LOCAL_REVIEW === '1' ? path.join(tmpdir(),
  `news-review-${createHash('sha256').update(`${MONGODB_URI}:${db.databaseName}:${snapshotIdentity?.created_at?.toISOString()}`).digest('hex').slice(0,20)}.json`) : null
const reviewHistory = process.env.LOCAL_REVIEW === '1'
  ? createReviewCache(loadArticleHistory, cacheFile)
  : createLiveHistory(loadArticleHistory)
// Invalidate before and after writes so concurrent reads cannot retain old data.
// Citation classifications are loaded separately and don't change answer history.
app.use('/api', (req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)
    && !(req.method === 'PATCH' && /^\/answers\/[^/]+$/.test(req.path) && !('citations' in (req.body??{})))) {
    // Ingestion is append-only: keep the last history visible while rebuilding.
    // Screenshots alone do not change the article history.
    if(req.method === 'POST' && req.path === '/screenshots')return next()
    const automatedDates = req.path === '/sources' &&
      (Array.isArray(req.body) ? req.body : [req.body]).every(item => item?.method === 'pagedatefinder')
    const invalidate = req.method === 'POST' && (req.path === '/articles' || automatedDates) && reviewHistory.invalidate
      ? () => reviewHistory.invalidate() : () => reviewHistory.clear()
    invalidate()
    res.on('finish', () => {
      invalidate()
    })
  }
  next()
})
registerQuestionRetries(app,db)

// Narrow authoritative intake projection: workers do not need full answer history.
app.get('/api/collection-targets',async(req,res)=>{
  try {
    const articles=await db.collection('articles').find({}, {projection:{url:1,published_at:1,exclusive:1,questions:1,deleted_at:1}}).toArray()
    res.json(articles)
  } catch(err) { console.error(err);res.status(500).json({error:'Could not load collection targets'}) }
})

registerArticleReads(app,db,{attachAnswers,attachSourceDates,attachReaskQueue,attachQuestionRetries})

app.get('/api/articles', async (req, res) => {
  try {
    const body = await reviewHistory.get({fresh:req.query.fresh === '1'})
    const historyStatus = reviewHistory.status?.()
    if(historyStatus?.updatedAt)res.set('X-History-Updated-At',new Date(historyStatus.updatedAt).toISOString())
    res.set('X-History-Refreshing',String(historyStatus?.refreshing??false))
    res.set('Cache-Control','no-store')
    res.vary('Accept-Encoding')
    res.type('json')
    if (req.acceptsEncodings('gzip')) {
      res.set('Content-Encoding', 'gzip')
      return res.send(await gzipHistory(body))
    }
    res.send(body)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch articles' })
  }
})

// Same payload every time: url + ground truth + platform_answers, indexed the
// way your scraper already emits them. A URL we've seen before records another
// run against the existing question_ids instead of creating a duplicate.

registerArticleIngestion(app,{db,canonicalUrl,emptyPlatformAnswer})

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
  // Positional fallback counts through `order`, the trimmed list the caller
  // pasted against. Keying on the stored question_index would point at whatever
  // sits at that index in the full list — quite possibly a flagged one.

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

    const match = resolveQuestion(active,q.question,q.question_index,{allowPosition:true})
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
        question_variant: answer.question_variant ?? 'original',
        asked_question: answer.asked_question ?? null,
        model: answer.model ?? null,
        search: answer.search ?? null,
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
    const article = await articles.findOne({ _id: new ObjectId(id), deleted_at: {$exists:false} })
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

    const updated = await articles.updateOne(
      { _id: article._id, questions: existing, deleted_at: {$exists:false} },
      { $push: { questions: { $each: added } } }
    )
    if(!updated.matchedCount)return res.status(409).json({error:'Questions changed; reload and retry'})

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
    res.status(err.status??500).json({ error: err.status===400?err.message:'Failed to add questions' })
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
    const article = await articles.findOne({ _id: new ObjectId(id), deleted_at: {$exists:false} })
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
      .updateOne({ _id: new ObjectId(id), deleted_at: {$exists:false} }, { $set })

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

    // Retain a durable tombstone in the canonical URL's unique row. An old
    // delivery can never recreate it, including after a process crash.
    const result = await db.collection('articles').updateOne(
      {_id:new ObjectId(id),deleted_at:{$exists:false}}, {$set:{deleted_at:new Date()}})
    if(!result.matchedCount)return res.status(404).json({error:'Article not found'})
    await db.collection('reask_queue').deleteMany({article_id:new ObjectId(id)})
    await db.collection('question_retry_queue').deleteMany({article_id:new ObjectId(id)})

    res.status(204).end()
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to delete article' })
  }
})

// Manual article re-ask queue, separate from automatic milestone collection
// and question-scoped browser retries. Each entry is one
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
      .findOne({ _id: new ObjectId(id), deleted_at: {$exists:false} }, { projection: { questions: 1 } })
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
        { $project: { requested_at: 1, article_id: 1, 'article.url': 1, 'article.published_at': 1, 'article.exclusive': 1, 'article.questions': 1, 'article.deleted_at':1 } }
      ])
      .toArray()

    res.json({
      items: entries.map((entry) => {
        const article = entry.article[0]?.deleted_at ? null : entry.article[0]
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
            .map((q) => ({ question_id:q.question_id, question_index: q.question_index, question: q.question, answer: q.answer }))
        }
      })
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch re-ask queue' })
  }
})

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
registerSourceDates(app,{db,canonicalUrl})

// Active study dataset. Bad questions and their responses are excluded;
// stored records remain available for recovery.
// GET /api/export.json
app.get('/api/export.json', async (req, res) => {
  try {
    const [articles, answers, sources, citationTypes, citationDomains, citationCategories, citationDomainPlatforms] = await Promise.all([
      db.collection('articles').find({deleted_at:{$exists:false}}).toArray(),
      db.collection('answers').find().toArray(),
      db.collection('sources').find().toArray(),
      db.collection('citation_types').find().toArray(),
      db.collection('citation_domains').find().toArray(),
      db.collection('citation_categories').find().toArray(),
      db.collection('citation_domain_platforms').find().toArray()
    ])

    const payload = { ...activeDataset(articles, answers), sources, citation_types: citationTypes, citation_domains: citationDomains, citation_categories: citationCategories, citation_domain_platforms: citationDomainPlatforms }
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

// The verdict taxonomy manual grading uses -- editable from the app's
// Settings tab rather than hardcoded, so validVerdicts() is read fresh on
// every grade.
// GET/POST /api/verdict-categories, DELETE /api/verdict-categories/:value
const {validVerdicts} = await registerVerdictCategories(app,{db})

// Read-only archive of past {articles, answers, sources} exports -- separate
// from the live collections, see archive.js's module comment.
// GET/POST /api/archive, DELETE /api/archive/:id
registerArchive(app,{db})

// Grade one answer — that is, one platform's response in one specific run.
// PATCH /api/answers/:id  { verdict, confidence, note, answer, citations }
registerAnswerReview(app,{db,validVerdicts,reviewHistory})

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
    if(!buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return res.status(400).json({error:'Only PNG screenshots are supported'})
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
      url: safeHttpUrl(url),
      citations: cleanManualCitations(citations),
      verdict: null,
      graded_at: null,
      note: null,
      manual: true,
      added_at: new Date()
    }

    const prepared = doc
    const inserted = await db.collection('answers').insertOne(prepared)
    res.status(201).json({ ...prepared, _id: inserted.insertedId })
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
// Full legacy history is read on demand; paginated review does not need it.
const server = app.listen(port, productionEnvironment(process.env) && process.env.LOCAL_REVIEW !== '1' ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`API listening on http://localhost:${port}`)
})

// Hosts send SIGTERM before replacing a container. Without this the process is
// killed mid-request and the Mongo connection is severed rather than closed.
let shuttingDown = false

async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`${signal} received — closing server and database connection`)
  const deadline=setTimeout(()=>process.exit(1),15000)
  deadline.unref()
  await new Promise(resolve=>server.close(resolve))
  try {
    await client.close()
  } catch (err) {
    console.error('Error closing MongoDB connection:', err.message)
  }
  clearTimeout(deadline)
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

