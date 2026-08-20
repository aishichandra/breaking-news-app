// Pulls the checkable claims out of a ground-truth answer so they can be
// highlighted inside each platform's response. The point is to make
// "did it get the number right?" a glance instead of a read.

const STOPWORDS = new Set([
  'about', 'above', 'after', 'again', 'against', 'all', 'also', 'and', 'any',
  'are', 'because', 'been', 'before', 'being', 'below', 'between', 'both',
  'but', 'can', 'did', 'does', 'doing', 'during', 'each', 'for', 'from',
  'further', 'had', 'has', 'have', 'having', 'her', 'here', 'hers', 'herself',
  'him', 'himself', 'his', 'how', 'into', 'its', 'itself', 'may', 'more',
  'most', 'not', 'now', 'off', 'one', 'only', 'other', 'ought', 'our', 'ours',
  'ourselves', 'out', 'over', 'own', 'per', 'said', 'same', 'says', 'she',
  'should', 'some', 'such', 'than', 'that', 'the', 'their', 'theirs', 'them',
  'themselves', 'then', 'there', 'these', 'they', 'this', 'those', 'through',
  'too', 'under', 'until', 'very', 'was', 'were', 'what', 'when', 'where',
  'which', 'while', 'who', 'why', 'with', 'would', 'yet', 'you', 'your', 'yours'
])

// Numbers, percentages, and money carry the factual weight in these answers,
// so they get their own tier and a stronger highlight.
const NUMERIC = /\$?\d[\d,]*(?:\.\d+)?\s?(?:%|percent|percentage points|bps|billion|million|trillion|pp)?/gi

const WORD = /\b[A-Za-z][A-Za-z-]{2,}\b/g

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function extractKeyTerms(groundTruth) {
  const numbers = new Set()
  const words = new Set()
  if (!groundTruth) return { numbers: [], words: [] }

  for (const match of groundTruth.matchAll(NUMERIC)) {
    const term = match[0].trim()
    if (/\d/.test(term)) numbers.add(term)
  }

  for (const match of groundTruth.matchAll(WORD)) {
    const term = match[0]
    if (!STOPWORDS.has(term.toLowerCase())) words.add(term)
  }

  // Longest first, so "3.5%" wins over "3" and "labor market" over "labor".
  const byLength = (a, b) => b.length - a.length
  return { numbers: [...numbers].sort(byLength), words: [...words].sort(byLength) }
}

// Returns plain segments rather than an HTML string, so the caller renders with
// real elements and never has to reach for {@html} on model-generated text.
export function highlightSegments(text, terms) {
  if (!text) return []

  const numbers = terms?.numbers ?? []
  const words = terms?.words ?? []
  if (numbers.length === 0 && words.length === 0) {
    return [{ text, kind: null }]
  }

  const isNumber = new Set(numbers.map((t) => t.toLowerCase()))

  // Numeric terms keep their own delimiters ($ and % aren't word characters),
  // but word terms need boundaries or "and" matches inside "expanded".
  const patterns = [
    ...numbers.map(escapeRe),
    ...words.map((t) => `\\b${escapeRe(t)}\\b`)
  ]
  const re = new RegExp(`(${patterns.join('|')})`, 'gi')

  const segments = []
  let cursor = 0

  for (const match of text.matchAll(re)) {
    if (match.index > cursor) {
      segments.push({ text: text.slice(cursor, match.index), kind: null })
    }
    segments.push({
      text: match[0],
      kind: isNumber.has(match[0].trim().toLowerCase()) ? 'number' : 'word'
    })
    cursor = match.index + match[0].length
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), kind: null })
  }

  return segments
}
