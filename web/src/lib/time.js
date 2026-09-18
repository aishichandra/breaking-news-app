export function toDate(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export function formatDateTime(value) {
  const d = toDate(value)
  if (!d) return 'unknown'
  return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

// Human-readable elapsed time. Rounds to the largest two units that matter,
// because "4h 12m" is easier to compare at a glance than "251 minutes".
export function formatDuration(ms) {
  const minutes = Math.round(Math.abs(ms) / 60000)

  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  const leftoverMin = minutes % 60
  if (hours < 24) return leftoverMin ? `${hours}h ${leftoverMin}m` : `${hours}h`

  const days = Math.floor(hours / 24)
  const leftoverHrs = hours % 24
  const parts = [`${days}d`]
  if (leftoverHrs) parts.push(`${leftoverHrs}h`)
  if (leftoverMin) parts.push(`${leftoverMin}m`)
  return parts.join(' ')
}

// Compact lag for collapsed verdict chips — nearest useful unit, not exact minutes.
export function formatApproxDuration(ms) {
  const sign = ms < 0 ? '−' : ''
  const abs = Math.abs(ms)
  const minutes = abs / 60000

  if (minutes < 12) return null
  if (minutes < 50) return `${sign}~${Math.round(minutes / 5) * 5}m`

  const hours = abs / 3600000
  if (hours < 1.75) return `${sign}~1h`
  if (hours < 20) return `${sign}~${Math.round(hours)}h`

  const days = abs / 86400000
  if (days < 1.75) return `${sign}~1d`
  if (days < 5.5) return `${sign}~${Math.round(days)}d`
  if (days < 10) return `${sign}~1w`
  return `${sign}~${Math.round(days / 7)}w`
}

// How stale was the news when the platform was asked?
// Positive = asked after publication (the normal case).
// Negative = asked before the article existed, which means either a
// mis-entered date or a platform answering from a different source.
export function describeLag(publishedAt, askedAt) {
  const from = toDate(publishedAt)
  const to = toDate(askedAt)
  if (!from || !to) return null

  const ms = to - from

  return {
    ms,
    hours: ms / 3600000,
    label: formatDuration(ms),
    text: ms >= 0
      ? `asked ${formatDuration(ms)} after publication`
      : `asked ${formatDuration(ms)} BEFORE publication`,
    negative: ms < 0
  }
}

// Matches answer_worker.py's REASK_OFFSETS / api/reask-schedule.js's
// COLLECTION_MILESTONES — the fixed publish-relative schedule questions get
// re-asked on. Keep all three in sync.
const REASK_MILESTONES = [
  { id: '15m', label: '15 minutes', ms: 15 * 60000 },
  { id: '30m', label: '30 minutes', ms: 30 * 60000 },
  { id: '1h', label: '1 hour', ms: 3600000 },
  { id: '5h', label: '5 hours', ms: 5 * 3600000 },
  { id: '1d', label: '1 day', ms: 86400000 }
]

// Where a story sits in the re-ask schedule: what's still coming, and when.
// Reads the schedule off the *last* milestone actually reached (from the
// most recent run's server-computed `milestone.id`) rather than counting
// runs, so it stays correct even if a run was skipped after a failure or a
// manual update landed out of band. `now` is injected so a live countdown
// can re-derive this on a timer without this function reading the clock
// itself. Returns null when there's no publish date to schedule against.
export function nextReask(publishedAt, runs = [], now = Date.now()) {
  const pub = toDate(publishedAt)
  if (!pub) return null

  const lastMilestoneId = runs.length > 0 ? runs.at(-1)?.milestone?.id ?? null : null
  const lastIndex = REASK_MILESTONES.findIndex((m) => m.id === lastMilestoneId)
  const next = REASK_MILESTONES[lastIndex + 1]
  if (!next) return { done: true }

  const dueAt = pub.getTime() + next.ms
  const msUntil = dueAt - now

  return {
    done: false,
    label: next.label,
    dueAt: new Date(dueAt).toISOString(),
    overdue: msUntil <= 0,
    countdown: msUntil <= 0 ? 'due now' : `in ${formatDuration(msUntil)}`
  }
}

export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

// Source-to-story gaps span minutes to years, and at the long end the exact
// figure is noise: "348d 14h 4m older" is a number to decode, "1y older" is a
// fact you can read. One rounded unit, with the precise value kept for a
// tooltip.
export function formatCoarseDuration(ms) {
  const abs = Math.abs(ms)

  const hours = abs / 3600000
  if (hours < 23.5) return `${Math.max(1, Math.round(hours))}h`

  const days = abs / 86400000
  if (days < 30) return `${Math.round(days)}d`

  // Anything from eleven months out reads as a year — nobody scanning this
  // column cares whether background material was 11 or 12 months stale.
  const months = days / 30.44
  if (months < 11) return `${Math.round(months)}mo`

  const years = days / 365.25
  return years < 1.75 ? '1y' : `${Math.round(years)}y`
}

// Compares a cited source's publish time against the article being asked about.
// "older" means the platform leaned on something that predates the story;
// "newer" means it reached for coverage published after it.
export function describeSourceAge(articleAt, sourceAt) {
  const article = toDate(articleAt)
  const source = toDate(sourceAt)
  if (!article || !source) return null

  const ms = article - source
  const DAY = 86400000

  if (Math.abs(ms) < 3600000) {
    return { ms, label: 'same hour', exact: 'within the hour', older: false, stale: false }
  }

  const side = ms > 0 ? 'older' : 'newer'

  return {
    ms,
    label: `${formatCoarseDuration(ms)} ${side}`,
    exact: `${formatDuration(ms)} ${side}`,
    older: ms > 0,
    // A source more than a month older than the story is background, not news.
    stale: ms > 30 * DAY
  }
}

// Earliest platform query time in a collection run — used for timeline ordering.
export function runAskedAt(run) {
  const times = Object.values(run.platforms ?? {})
    .map((p) => p?.asked_at)
    .filter(Boolean)
    .map((t) => new Date(t).getTime())
    .filter((t) => !Number.isNaN(t))
  if (times.length === 0) return run.run_at ?? null
  return new Date(Math.min(...times)).toISOString()
}

// datetime-local inputs want "YYYY-MM-DDTHH:mm" in LOCAL time, with no zone.
export function toLocalInputValue(value) {
  const d = toDate(value)
  if (!d) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  )
}

// The citation editor splits the stamp in two, because plenty of outlets print
// a date and no clock time. These fill the halves; the time half comes back
// empty for a date-only record so the field stays visibly unset.
export function toLocalDateValue(value) {
  return toLocalInputValue(value).slice(0, 10)
}

export function toLocalTimeValue(value, precision) {
  if (precision === 'date') return ''
  return toLocalInputValue(value).slice(11)
}

// Rebuilds a stored timestamp from those halves. A date with no time is pinned
// to local noon — the same convention the CSV importer uses for dates dug out
// of URLs — so the day renders correctly everywhere and an unknown time throws
// the lag arithmetic off by at most half a day in either direction.
export function fromLocalParts(date, time) {
  if (!date) return null
  const d = new Date(`${date}T${time || '12:00'}`)
  if (Number.isNaN(d.getTime())) return null
  return { iso: d.toISOString(), precision: time ? 'datetime' : 'date' }
}

// Full timestamp, degraded to a bare date when that's all the source gave us.
// Showing "12:00 AM" for a date-only extraction would invent precision.
export function formatSourceStamp(value, precision) {
  const d = toDate(value)
  if (!d) return null
  return d.toLocaleString('en-US',
    precision === 'date'
      ? { dateStyle: 'medium' }
      : { dateStyle: 'medium', timeStyle: 'short' }
  )
}
