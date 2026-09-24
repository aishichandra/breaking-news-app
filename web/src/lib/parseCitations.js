// Pulls citations out of an answer pasted in by hand, for a platform the
// pipeline never managed to record. Copying an answer out of ChatGPT,
// Perplexity, Claude or Google yields a few different shapes, so this reads
// all of them:
//   - markdown links               [reuters.com](https://reuters.com/...)
//   - footnote definitions         [1]: https://... "Title"
//   - source-list lines            1. Some headline - https://...
//   - bare URLs anywhere in the text
// Each becomes { label, url, trust } -- the same shape a scraped citation has.

// One level of balanced parentheses is enough for the URLs that matter
// (Wikipedia titles like /wiki/Foo_(bar)).
const URL_BODY = String.raw`https?:\/\/(?:[^\s()<>]|\([^\s()<>]*\))+`
const MARKDOWN_LINK = new RegExp(String.raw`\[([^\]\n]*)\]\((${URL_BODY})(?:\s+"[^"]*")?\)`, 'g')
const BARE_URL = new RegExp(URL_BODY, 'g')

// A link whose text is only a footnote number ("1", "[1]") carries no label
// of its own; a later source-list line for that URL might.
const FOOTNOTE_LABEL = /^\[?\d{1,3}\]?$/

function cleanUrl(raw) {
  // Sentence punctuation sticks to a bare URL ("...story.") and isn't part of it.
  return raw.replace(/[.,;:!?'"*_]+$/, '')
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function tidyLabel(text) {
  return text
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}

const SEPARATOR_END = /\s*[-–—:|(]\s*$/
// "Sources: https://..." -- the word before the colon names the list, not the source.
const LIST_HEADING = /^(?:sources?|references?|citations?|links?|see(?: also)?|via)$/i

// The text before a URL on a source-list line ("2. Headline - https://...") is
// its label, once the list marker ("1.", "-", "[2]") and the separator before
// the URL are removed. A URL dropped into the middle of a sentence has no such
// separator and gets no label from its surroundings -- a sentence fragment
// would be worse than the domain it falls back to.
function labelFromPrefix(prefix) {
  if (!SEPARATOR_END.test(prefix)) return ''

  const label = tidyLabel(
    prefix
      .replace(/^\s*(?:[-*•]|\d{1,3}[.)]|\[\d{1,3}\]:?)\s*/, '')
      .replace(SEPARATOR_END, '')
  )
  return label.length > 150 || LIST_HEADING.test(label) ? '' : label
}

export function parsePastedAnswer(raw) {
  const found = new Map() // url -> { label, real }

  function add(url, label) {
    const clean = cleanUrl(url)
    if (!/^https?:\/\/[^\s/]+/.test(clean)) return
    const real = Boolean(label) && !FOOTNOTE_LABEL.test(label)
    const existing = found.get(clean)
    // The same URL often shows up twice -- once as a bare footnote number,
    // once with its headline. Keep whichever labelled it.
    if (!existing || (real && !existing.real)) {
      found.set(clean, { label: real ? label : domainOf(clean), real })
    }
  }

  let text = String(raw ?? '').replace(/\r\n?/g, '\n')

  // Markdown links first: their URLs are captured with the link's own text as
  // the label, then the syntax collapses to that text so the URL doesn't get
  // counted a second time as a bare one -- and doesn't clutter the answer.
  text = text.replace(MARKDOWN_LINK, (_match, linkText, url) => {
    const label = tidyLabel(linkText)
    add(url, label)
    return FOOTNOTE_LABEL.test(label) ? `[${label.replace(/[[\]]/g, '')}]` : linkText
  })

  // Whatever URLs remain are footnote definitions, source-list lines or bare
  // mentions. A line's own text before the URL is its label.
  for (const line of text.split('\n')) {
    const urls = line.match(BARE_URL)
    if (!urls) continue

    const titled = line.match(/"([^"]+)"\s*$/) // [1]: https://... "Title"
    const prefix = line.slice(0, line.indexOf(urls[0]))
    const label = titled ? tidyLabel(titled[1]) : urls.length === 1 ? labelFromPrefix(prefix) : ''
    for (const url of urls) add(url, label)
  }

  return {
    answer: text.trim(),
    citations: [...found].map(([url, { label }]) => ({ label, url, trust: null }))
  }
}
