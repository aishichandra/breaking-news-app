// Read-only archive of past database exports (the {articles, answers,
// sources} shape produced by hand from the live app, distinct from the
// encrypted tools/backup-database.mjs format). Old Q&A data does not persist
// indefinitely in the live `articles`/`answers` collections; this is the one
// place such an export can still be browsed once it's no longer live.
//
// Deliberately its own collection, never merged into `articles`/`answers` --
// an archived article must never be picked up by live ingestion, the judge,
// reask scheduling, or citation-date lookups.
import {ObjectId} from 'mongodb'

function validateImport(body) {
  const {articles, answers, sources} = body ?? {}
  if (!Array.isArray(articles) || !articles.length) throw new Error('articles must be a non-empty array')
  if (!Array.isArray(answers)) throw new Error('answers must be an array')
  if (sources !== undefined && !Array.isArray(sources)) throw new Error('sources must be an array if present')
  for (const article of articles) {
    if (typeof article?.url !== 'string' || !article.url) throw new Error('Every article needs a url')
    if (!Array.isArray(article.questions)) throw new Error(`Article ${article.url} is missing a questions array`)
  }
  for (const answer of answers) {
    if (answer?.question_id === undefined || answer?.question_id === null) throw new Error('Every answer needs a question_id')
    if (typeof answer?.platform !== 'string' || !answer.platform) throw new Error('Every answer needs a platform')
  }
}

// Mirrors the live shape closely enough for the frontend to reuse
// answerLabel()/PLATFORM_LABELS, without pulling in the live attachAnswers()
// in server.js -- that also merges judge/citation-date/reask state that
// doesn't apply to a frozen snapshot.
function joinAnswers(articles, answers) {
  const byQuestion = new Map()
  for (const answer of answers) {
    const key = String(answer.question_id)
    if (!byQuestion.has(key)) byQuestion.set(key, [])
    byQuestion.get(key).push(answer)
  }
  return articles.map((article) => ({
    ...article,
    questions: (article.questions ?? []).map((question) => ({
      ...question,
      platforms: Object.fromEntries(
        (byQuestion.get(String(question.question_id)) ?? []).map((a) => [a.platform, a])
      )
    }))
  }))
}

export function registerArchive(app, {db}) {
  const imports = db.collection('archive_imports')

  app.get('/api/archive', async (req, res) => {
    try {
      const rows = await imports.find().sort({uploaded_at: -1}).toArray()
      res.json(rows.map((row) => ({
        import: {id: row._id.toString(), filename: row.filename, uploaded_at: row.uploaded_at, article_count: row.articles.length},
        articles: joinAnswers(row.articles, row.answers)
      })))
    } catch (err) {
      console.error(err)
      res.status(500).json({error: 'Could not load the archive'})
    }
  })

  app.post('/api/archive', async (req, res) => {
    try {
      validateImport(req.body)
    } catch (err) {
      return res.status(400).json({error: err.message})
    }
    try {
      const {filename, articles, answers, sources} = req.body
      const doc = {
        filename: typeof filename === 'string' && filename.trim() ? filename.trim() : 'import.json',
        uploaded_at: new Date(),
        uploaded_by: req.actor?.username ?? null,
        articles,
        answers,
        sources: sources ?? []
      }
      const {insertedId} = await imports.insertOne(doc)
      res.status(201).json({id: insertedId.toString(), filename: doc.filename, uploaded_at: doc.uploaded_at, article_count: articles.length})
    } catch (err) {
      console.error(err)
      res.status(500).json({error: 'Could not store the import'})
    }
  })

  app.delete('/api/archive/:id', async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({error: 'Not a valid import id'})
    try {
      const {deletedCount} = await imports.deleteOne({_id: new ObjectId(req.params.id)})
      if (!deletedCount) return res.status(404).json({error: 'No such import'})
      res.json({ok: true})
    } catch (err) {
      console.error(err)
      res.status(500).json({error: 'Could not delete the import'})
    }
  })
}
