// Headlines are observations, not inferred publication-time revisions.
export function headlineObservations(body) {
  const rows = body.headline_history ?? []
  if (!Array.isArray(rows) || rows.length > 500) throw new Error('headline_history must contain at most 500 observations')
  const result = rows.map(row => {
    if (!row || typeof row.headline !== 'string' || !row.headline.trim() || row.headline.length > 2000) throw new Error('Invalid headline')
    if (row.observed_at != null && (typeof row.observed_at !== 'string' || !Number.isFinite(Date.parse(row.observed_at)))) throw new Error('Invalid headline observation date')
    return {headline: row.headline.trim(), observed_at: row.observed_at ? new Date(row.observed_at).toISOString() : null}
  })
  if (body.headline != null && (typeof body.headline !== 'string' || body.headline.length > 2000)) throw new Error('Invalid headline')
  if (!result.length && body.headline?.trim()) result.push({headline: body.headline.trim(), observed_at: null})
  return [...new Map(result.map(row => [JSON.stringify(row),row])).values()]
}

export function articleHeadlines(article) {
  const rows = headlineObservations(article).sort((a,b) => (Date.parse(a.observed_at)||0) - (Date.parse(b.observed_at)||0))
  // Collapse unchanged captures, while retaining A → B → A revisions.
  return rows.reduce((changes,row) => {
    if (changes.at(-1)?.headline !== row.headline) changes.push(row)
    return changes
  }, [])
}
