// Mirrors judgeSettings.svelte.js's fetch-once-and-cache shape. The 5
// built-ins are seeded server-side (api/verdict-categories.js) so this list
// starts non-empty as soon as it loads; verdicts.js falls back to its own
// static copy of those same 5 for the one paint before the first load.
//
// Every successful load/add/delete also pushes the current list into
// verdicts.js via setVerdictCategories() -- that file is imported by
// study.js (plain-Node-tested), so it can't import this reactive store
// directly; this is the one place that bridges the two.
import {API} from './api.js'
import {setVerdictCategories} from './verdicts.js'

export const verdictCategories = $state({items: [], loaded: false, error: ''})

let loading
export function loadVerdictCategories() {
  return (loading ??= fetch(`${API}/api/verdict-categories`)
    .then(async (r) => {
      if (!r.ok) throw new Error('Could not load verdict categories')
      const items = await r.json()
      verdictCategories.items = items
      verdictCategories.loaded = true
      verdictCategories.error = ''
      setVerdictCategories(items)
    })
    .catch((e) => {
      verdictCategories.error = e.message
      loading = null
    }))
}

export async function addVerdictCategory({value, symbol, title, color}) {
  const res = await fetch(`${API}/api/verdict-categories`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({value, symbol, title, color})
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    throw new Error(detail.error ?? `API returned ${res.status}`)
  }
  const saved = await res.json()
  verdictCategories.items = [...verdictCategories.items, saved]
  setVerdictCategories(verdictCategories.items)
  return saved
}

export async function deleteVerdictCategory(value) {
  const res = await fetch(`${API}/api/verdict-categories/${encodeURIComponent(value)}`, {method: 'DELETE'})
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    throw new Error(detail.error ?? `API returned ${res.status}`)
  }
  verdictCategories.items = verdictCategories.items.filter((c) => c.value !== value)
  setVerdictCategories(verdictCategories.items)
}
