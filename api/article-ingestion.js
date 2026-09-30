import {headlineObservations} from '../article-headlines.mjs'
import {ObjectId} from 'mongodb'
import {buildQuestions} from './normalize.js'
import {validateIngestion,validDate,questionKey,ingestionRunId,answerUpserts} from './ingestion.js'
export function registerArticleIngestion(app,{db,canonicalUrl,emptyPlatformAnswer}){
app.post('/api/articles', async (req, res) => {
  try {
    try { validateIngestion(req.body) } catch (err) { return res.status(400).json({error:err.message}) }
    const { url, published_at, updated_at, snippet, markdown, exclusive, questions, platform_answers } =
      req.body

    if (!url) {
      return res.status(400).json({ error: 'url is required' })
    }

    const built = buildQuestions(questions ?? [], platform_answers ?? [])
    for(const q of built)q.question_id=questions?.[q.question_index]?.question_id ?? platform_answers?.find(e=>e.question===q.question)?.question_id
    const urlKey = canonicalUrl(url)
    const articles = db.collection('articles')

    let article = await articles.findOne({ url_key: urlKey })
    if(article?.deleted_at)return res.status(410).json({error:'Article was deleted; stale collection discarded'})
    let created = !article

    if(created&&built.some(q=>q.question_id))return res.status(400).json({error:'Cannot attach an existing question ID to an unknown article'})
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
      try {
        const inserted = await articles.insertOne(article)
        article._id = inserted.insertedId
      } catch(err) {
        if(err.code!==11000)throw err
        article=await articles.findOne({url_key:urlKey})
        if(!article)throw err
        created=false
        if(article.deleted_at)return res.status(410).json({error:'Article was deleted'})
      }
    }

    // Match this payload's questions onto the article's existing ones. Text
    // first, because question_index shifts if questions are ever reordered.
    const byText = new Map(article.questions.map((q) => [questionKey(q.question), q]))
    // Text identity is authoritative; a subset retry starts at position zero.
    const appended = []

    const resolved = built.map((q) => {
      let match = q.question_id ? article.questions.find(item=>String(item.question_id)===String(q.question_id)) : byText.get(questionKey(q.question))
      if(q.question_id && (!match || questionKey(match.question)!==questionKey(q.question)))throw Object.assign(new Error('Question identity or text changed; refresh before retrying'),{status:400})

      if (!match) {
        match = {
          question_id: new ObjectId(),
          question_index: article.questions.length + appended.length,
          question: q.question,
          answer: q.answer || null
        }
        appended.push(match)
        byText.set(questionKey(q.question),match)
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
      const updated = await articles.updateOne(
        { _id: article._id, questions: article.questions, deleted_at: {$exists:false} },
        {
          ...(Object.keys($set).length ? { $set } : {}),
          ...(appended.length ? { $push: { questions: { $each: appended } } } : {})
        }
      )
      if (!updated.matchedCount)return res.status(409).json({error:'Article changed during ingestion; retry this payload'})
    }

    const headlines = headlineObservations(req.body)
    if (headlines.length) await articles.updateOne(
      {_id:article._id,deleted_at:{$exists:false}},
      {$addToSet:{headline_history:{$each:headlines}}}
    )

    if (await articles.countDocuments({_id:article._id,deleted_at:{$exists:true}}))return res.status(410).json({error:'Article was deleted'})
    const runAt = validDate(req.body.run_at,'run_at') ?? new Date()
    const runId = ingestionRunId(article._id,runAt,Boolean(req.body.run_at))
    if (Number.isNaN(runAt.getTime())) {
      return res.status(400).json({ error: 'run_at is not a valid date' })
    }
    const answerDocs = []

    for (const { built: q, question } of resolved) {
      if(question.flagged)continue
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

    if (answerDocs.length) await db.collection('answers').bulkWrite(answerUpserts(answerDocs))

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
    res.status(err.status??500).json({ error: err.status===400?err.message:'Failed to save article' })
  }
})
}
