// Converts a Python literal (list/dict repr) into JSON text.
//
// This walks character by character rather than running a regex, because a
// blind ' -> " swap corrupts any string containing an apostrophe. Python's
// repr picks its quote character contextually: it emits
//     "How much did Colombia's GDP grow?"
// with double quotes precisely BECAUSE of the apostrophe. Tracking which
// quote opened each string is the only way to get this right.
export function pythonLiteralToJson(src) {
  let out = ''
  let i = 0

  while (i < src.length) {
    const ch = src[i]

    if (ch === '"' || ch === "'") {
      const quote = ch
      let body = ''
      i++

      while (i < src.length) {
        const c = src[i]

        if (c === '\\') {
          const next = src[i + 1]
          if (next === 'n') body += '\n'
          else if (next === 't') body += '\t'
          else if (next === 'r') body += '\r'
          else if (next === '\\') body += '\\'
          else body += next
          i += 2
          continue
        }

        if (c === quote) break
        body += c
        i++
      }

      i++ // consume the closing quote
      out += JSON.stringify(body) // re-emit as a proper JSON string
      continue
    }

    // Bare words outside of strings: True/False/None have JSON equivalents.
    if (/[A-Za-z_]/.test(ch)) {
      let word = ''
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) {
        word += src[i]
        i++
      }
      if (word === 'True') out += 'true'
      else if (word === 'False') out += 'false'
      else if (word === 'None') out += 'null'
      else out += word
      continue
    }

    out += ch
    i++
  }

  return out
}

// Text copied out of rendered documents, chat windows, terminals, or Google
// Docs picks up characters that LOOK like ordinary punctuation and whitespace
// but are not. JSON's grammar allows only space, tab, CR and LF as whitespace,
// so a single non-breaking space in the indentation breaks the whole parse.
function sanitize(text) {
  return text
    .replace(/[\u200B-\u200D\uFEFF]/g, '')      // zero-width chars + BOM
    .replace(/[\u00A0\u2007\u202F]/g, ' ')      // non-breaking spaces
    .replace(/[\u2028\u2029]/g, '\n')           // line/paragraph separators
    .replace(/[\u201C\u201D]/g, '"')            // curly double quotes
    .replace(/[\u2018\u2019]/g, "'")            // curly single quotes
}

// Describes the exact character a JSON parse error points at, so an invisible
// character reports as "U+00A0" instead of looking like a blank space.
function describeFailure(raw, message) {
  const at = message.match(/position (\d+)/)
  if (!at) return message

  const ch = raw[Number(at[1])]
  if (ch === undefined) return message

  const code = 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')
  const shown = /\s/.test(ch) || ch.codePointAt(0) > 0x7e ? code : `"${ch}" (${code})`
  return `${message} — the character there is ${shown}`
}

export function parseJsonish(text, label) {
  const raw = text.trim()
  if (!raw) return null

  const attempts = [
    () => JSON.parse(raw),                              // clean JSON, untouched
    () => JSON.parse(sanitize(raw)),                    // JSON + copy-paste damage
    () => JSON.parse(pythonLiteralToJson(sanitize(raw))) // Python literal
  ]

  let parsed
  let firstError

  for (const attempt of attempts) {
    try {
      parsed = attempt()
      break
    } catch (err) {
      firstError ??= err
    }
  }

  if (parsed === undefined) {
    throw new Error(`${label}: ${describeFailure(raw, firstError.message)}`)
  }

  return parsed
}

export function parseArrayField(text, label) {
  if (!text.trim()) return []
  const parsed = parseJsonish(text, label)

  if (!Array.isArray(parsed)) {
    throw new Error(`${label}: expected an array (text starting with "[")`)
  }
  return parsed
}

export function parseObjectField(text, label) {
  if (!text.trim()) return null
  const parsed = parseJsonish(text, label)

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label}: expected an object (text starting with "{")`)
  }
  return parsed
}
