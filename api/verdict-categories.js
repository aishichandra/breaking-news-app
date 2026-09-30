// The verdict taxonomy manual review grades against. Used to be a hardcoded
// array shared by the API and the frontend; now it's a Mongo collection so
// new categories (Outdated, Unverifiable, ...) can be added from the app
// itself without a deploy. The LLM auto-judge (judge-core.mjs) keeps its own
// separate, fixed list -- this collection only governs manual grading.
import {BUILTIN_VERDICT_CATEGORIES} from '../verdict-defaults.mjs'

const VALUE_RE = /^[a-z][a-z0-9_]{0,29}$/
const COLOR_RE = /^#[0-9a-fA-F]{6}$/

export async function registerVerdictCategories(app, {db}) {
  const categories = db.collection('verdict_categories')
  const answers = db.collection('answers')

  if (await categories.countDocuments() === 0) {
    const now = new Date()
    await categories.insertMany(
      BUILTIN_VERDICT_CATEGORIES.map(({value, ...c}, order) => ({...c, _id: value, builtin: true, order, created_at: now}))
    )
  }

  // Kept in memory and refreshed on every write so answer-review.js's
  // per-grade validation (the hottest path here, one call per button click)
  // never pays a DB round trip -- only listing/adding/deleting categories
  // does.
  let cache = null
  async function refresh() {
    cache = await categories.find().sort({order: 1}).toArray()
    return cache
  }
  function validVerdicts() {
    return (cache ?? []).map((c) => c._id)
  }

  await refresh()

  app.get('/api/verdict-categories', async (req, res) => {
    try {
      res.json((cache ?? await refresh()).map(({_id, symbol, title, color, builtin}) => ({value: _id, symbol, title, color, builtin})))
    } catch (err) {
      console.error(err)
      res.status(500).json({error: 'Could not load verdict categories'})
    }
  })

  app.post('/api/verdict-categories', async (req, res) => {
    try {
      const {value, symbol, title, color} = req.body ?? {}
      if (!VALUE_RE.test(value ?? '')) {
        return res.status(400).json({error: 'value must be lowercase letters, digits or underscores, starting with a letter'})
      }
      if (typeof symbol !== 'string' || !symbol.trim() || [...symbol.trim()].length > 2) {
        return res.status(400).json({error: 'symbol must be 1-2 characters'})
      }
      if (typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({error: 'title is required'})
      }
      if (!COLOR_RE.test(color ?? '')) {
        return res.status(400).json({error: 'color must be a hex value like #6b4fa8'})
      }

      const doc = {
        _id: value,
        symbol: symbol.trim(),
        title: title.trim(),
        color,
        builtin: false,
        order: (cache?.length ?? 0),
        created_at: new Date()
      }
      try {
        await categories.insertOne(doc)
      } catch (err) {
        if (err.code === 11000) return res.status(409).json({error: `A category named "${value}" already exists`})
        throw err
      }
      await refresh()
      res.status(201).json({value: doc._id, symbol: doc.symbol, title: doc.title, color: doc.color, builtin: false})
    } catch (err) {
      console.error(err)
      res.status(500).json({error: 'Could not add verdict category'})
    }
  })

  app.delete('/api/verdict-categories/:value', async (req, res) => {
    try {
      const existing = (cache ?? await refresh()).find((c) => c._id === req.params.value)
      if (!existing) return res.status(404).json({error: 'No such verdict category'})
      if (existing.builtin) return res.status(400).json({error: 'Built-in categories cannot be deleted'})

      const inUse = await answers.countDocuments({verdict: existing._id})
      if (inUse > 0) {
        return res.status(409).json({error: `${inUse} answer(s) are graded "${existing.title}" — reassign or clear those verdicts before deleting this category`})
      }

      await categories.deleteOne({_id: existing._id})
      await refresh()
      res.json({ok: true})
    } catch (err) {
      console.error(err)
      res.status(500).json({error: 'Could not delete verdict category'})
    }
  })

  return {validVerdicts}
}
