import {safeHttpUrl} from '../safe-url.mjs'
export function registerSourceDates(app,{db,canonicalUrl}){
app.post('/api/sources', async (req, res) => {
  try {
    const items = Array.isArray(req.body) ? req.body : [req.body]
    if(!items.length||items.length>500||items.some(item=>!safeHttpUrl(item?.url)))return res.status(400).json({error:'Provide at most 500 valid HTTP(S) sources'})

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
}
