import {ObjectId} from 'mongodb'
import {confidenceUpdate} from './confidence.js'
import {cleanManualCitations} from './normalize.js'
import {updateCachedAnswer} from './review-cache.js'
export function registerAnswerReview(app,{db,validVerdicts,reviewHistory}){
app.patch('/api/answers/:id', async (req, res) => {
  try {
    const { id } = req.params
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Not a valid answer id' })
    }

    const body = req.body ?? {}
    const { verdict, note, answer } = body
    if (verdict !== null && verdict !== undefined && !validVerdicts().includes(verdict)) {
      return res
        .status(400)
        .json({ error: `verdict must be null or one of: ${validVerdicts().join(', ')}` })
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

    if ('answer' in body && typeof answer !== 'string') {
      return res.status(400).json({ error: 'answer must be a string' })
    }
    if ('citations' in body && !Array.isArray(body.citations)) {
      return res.status(400).json({ error: 'citations must be an array' })
    }

    let existing = null
    if ('answer' in body || 'citations' in body || 'confidence' in body || 'verdict' in body) {
      existing = await db
        .collection('answers')
        .findOne({ _id: new ObjectId(id), deleted_at: {$exists:false} }, { projection: { answer: 1, answer_original: 1, citations: 1, verdict: 1, judge: 1 } })

      if (!existing) {
        return res.status(404).json({ error: 'Answer not found' })
      }
    }

    // Model assessments remain separate from human grades.

    try {
      Object.assign($set, confidenceUpdate(body, existing?.verdict))
    } catch (err) {
      return res.status(400).json({ error: err.message })
    }

    // A scrape that mangled the response — truncated it, dropped a paragraph,
    // swallowed the markup — can be corrected by hand. What the platform
    // actually returned is the evidence this whole study rests on, though, so
    // the first correction stashes the scraped text under `answer_original`
    // and later ones leave that untouched. Both fields go out in the export.
    if ('answer' in body) {
      $set.answer = answer.trim()
      $set.answer_edited_at = new Date()
      $set['judge.status'] = 'stale'
      if (existing.answer_original === undefined) {
        $set.answer_original = existing.answer ?? ''
      }
    }

    // Filling in citations the scrape missed (parsed from a pasted answer).
    // Only ever into an empty list: a scraped set is the evidence the study
    // rests on, so it isn't replaced by anything typed in later.
    if ('citations' in body) {
      if ((existing.citations ?? []).length > 0) {
        return res.status(409).json({ error: 'This answer already has citations — they are not overwritten' })
      }
      $set.citations = cleanManualCitations(body.citations)
    }

    if (Object.keys($set).length === 0) {
      return res.status(400).json({ error: 'No recognised fields to update' })
    }

    // A confidence-only edit must not race a change to an ineligible verdict.
    const filter = { _id: new ObjectId(id), deleted_at: {$exists:false} }
    if ('confidence' in body && !('verdict' in body)) filter.verdict = existing.verdict ?? null
    if ('answer' in body) {
      filter.answer=existing.answer
      if(existing.answer_original===undefined)filter.answer_original={$exists:false}
    }
    if ('citations' in body)filter.$or=[{citations:{$exists:false}},{citations:{$size:0}}]
    const result = await db.collection('answers').updateOne(
      filter,
      { $set }
    )

    if (result.matchedCount === 0) {
      return res.status(existing ? 409 : 404).json({ error: existing ? 'Answer changed; refresh and try again' : 'Answer not found' })
    }

    if (!('citations' in body)) {
      reviewHistory.update(cached => updateCachedAnswer(cached,id,$set))
    }

    res.json({
      ok: true,
      confidence: $set.confidence,
      verdict,
      answer: $set.answer,
      answer_original: $set.answer_original,
      answer_edited_at: $set.answer_edited_at,
      citations: $set.citations
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to save answer' })
  }
})
}
