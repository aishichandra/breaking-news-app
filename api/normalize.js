// The four consumer-interface platforms (live browser grabs), plus the raw
// API-step matrix pushed alongside them -- gpt-4o/claude-sonnet-4 each with
// and without a web-search tool, Perplexity's API, and SerpAPI's AI
// Overview. Keep in sync with answer_worker.py's APP_PLATFORMS/API_PLATFORMS.
export const PLATFORMS = [
  'google', 'chatgpt', 'claude', 'perplexity',
  'gpt4o-no-search', 'gpt4o-web-search',
  'claude-sonnet4-no-search', 'claude-sonnet4-web-search',
  'perplexity-api', 'google-ai-overview-api'
]

// Your scraper emits `sources` for Google and `citations` for everyone else.
// Same concept, two names — collapse them here so nothing downstream has to care.
// `fallbackStamp` is the question-level timestamp. A platform that reports its
// own `timestamp` wins, so per-platform precision works as soon as the scraper
// emits it — without breaking data that only has the shared one.
function normalizePlatform(raw, fallbackStamp) {
  if (!raw || typeof raw !== 'object') return null

  const cites = raw.citations ?? raw.sources ?? []
  const stamp = raw.timestamp ?? raw.asked_at ?? fallbackStamp

  return {
    answer: raw.answer ?? '',
    url: raw.url ?? null,
    asked_at: stamp ? new Date(stamp) : null,
    citations: (Array.isArray(cites) ? cites : []).map((c) => ({
      label: c.label ?? '',
      url: c.url ?? null,
      trust: c.trust ?? null,
      date_time: typeof c.date_time === 'string' ? c.date_time : null
    })),
    // Google only, and only when answers.py managed to capture one --
    // GridFS id of the AI Overview page screenshot, uploaded by the
    // pipeline via POST /api/screenshots before this payload is sent.
    screenshot_id: raw.screenshot_id ?? null
  }
}

// Merges the two arrays you paste in:
//   groundTruth    [{ question, answer }]                     — position = question_index
//   platformAnswers[{ question_index, timestamp, question, google, chatgpt, ... }]
// One scraper entry -> one normalized record per platform that answered.
// Shared by POST /api/articles when normalizing platform answer payloads.
export function normalizeEntry(entry) {
  return PLATFORMS.map((platform) => {
    const raw = entry[platform]
    if (!raw || typeof raw !== 'object') return null

    const cites = raw.citations ?? raw.sources ?? []
    const stamp = raw.timestamp ?? raw.asked_at ?? entry.timestamp
    const answer = raw.answer ?? ''

    // An untouched slot from the copied template — no answer, no citations, no
    // session link. Recording it would fabricate an empty response for a
    // platform that was never asked.
    const empty =
      !answer.trim() && (!Array.isArray(cites) || cites.length === 0) && !raw.url
    if (empty) return null

    return {
      platform,
      asked_at: stamp ? new Date(stamp) : null,
      answer: raw.answer ?? '',
      url: raw.url ?? null,
      citations: (Array.isArray(cites) ? cites : []).map((c) => ({
        label: c.label ?? '',
        url: c.url ?? null,
        trust: c.trust ?? null,
        date_time: typeof c.date_time === 'string' ? c.date_time : null
      }))
    }
  }).filter(Boolean)
}

export function buildQuestions(groundTruth = [], platformAnswers = []) {
  if (platformAnswers.length === 0) {
    return groundTruth.map((g, i) => ({
      question_index: i,
      question: g.question ?? '',
      answer: g.answer ?? '',
      asked_at: null,
      platforms: {}
    }))
  }

  return platformAnswers.map((entry, i) => {
    const index = entry.question_index ?? i
    const truth = groundTruth[index] ?? {}

    return {
      question_index: index,
      question: entry.question ?? truth.question ?? '',
      answer: truth.answer ?? '',
      asked_at: entry.timestamp ? new Date(entry.timestamp) : null,
      platforms: Object.fromEntries(
        PLATFORMS.map((name) => [name, normalizePlatform(entry[name], entry.timestamp)])
      )
    }
  })
}
