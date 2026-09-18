const MINUTE = 60000
const HOUR = 3600000
const DAY = 24 * HOUR

// Publish-relative intervals for labeling timeline entries. Matches the
// pipeline's answer_worker.py REASK_OFFSETS (15m/30m/1h/5h/1d) plus a
// trailing 1w bucket for anything asked later than that.
export const COLLECTION_MILESTONES = [
  { id: '15m', label: '15 minutes', ms: 15 * MINUTE },
  { id: '30m', label: '30 minutes', ms: 30 * MINUTE },
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
