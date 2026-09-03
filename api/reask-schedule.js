const HOUR = 3600000
const DAY = 24 * HOUR

// Publish-relative intervals for labeling timeline entries.
export const COLLECTION_MILESTONES = [
  { id: '1h', label: '1 hour', ms: 1 * HOUR },
  { id: '5h', label: '5 hours', ms: 5 * HOUR },
  { id: '1d', label: '1 day', ms: 1 * DAY },
  { id: '1w', label: '1 week', ms: 7 * DAY }
]

export function milestoneWindows(publishedAt) {
  const pub = new Date(publishedAt).getTime()
  if (Number.isNaN(pub)) return null

  return COLLECTION_MILESTONES.map((m, i) => {
    const next = COLLECTION_MILESTONES[i + 1]
    return {
      ...m,
      start: pub + m.ms,
      end: next ? pub + next.ms : Infinity,
      due_at: new Date(pub + m.ms).toISOString()
    }
  })
}

function runInWindow(runMs, window) {
  return runMs >= window.start && runMs < window.end
}

export function milestoneForRun(publishedAt, runAt) {
  const windows = milestoneWindows(publishedAt)
  if (!windows) return null

  const t = new Date(runAt).getTime()
  if (Number.isNaN(t)) return null

  for (const w of windows) {
    if (runInWindow(t, w)) return { id: w.id, label: w.label }
  }
  if (t < windows[0].start) return null
  return { id: 'late', label: 'after 1 week' }
}

export function runAskedAt(run) {
  const times = Object.values(run.platforms ?? {})
    .map((p) => p?.asked_at)
    .filter(Boolean)
    .map((t) => new Date(t).getTime())
    .filter((t) => !Number.isNaN(t))
  if (times.length === 0) return run.run_at ?? null
  return new Date(Math.min(...times))
}
