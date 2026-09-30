// Shared between api/verdict-categories.js (server-side seed) and
// web/src/lib/verdicts.js (client-side fallback before the first fetch
// resolves) so the two can never drift.
export const BUILTIN_VERDICT_CATEGORIES = [
  {value: 'correct',     symbol: '✓', title: 'Correct',                         color: '#1a7f45'},
  {value: 'partial',     symbol: '~', title: 'Partially correct',               color: '#b8860b'},
  {value: 'incorrect',   symbol: '✗', title: 'Incorrect',                       color: '#b00020'},
  {value: 'abstained',   symbol: '∅', title: 'Abstained — no answer given',     color: '#55555f'},
  {value: 'speculation', symbol: '?', title: 'Speculation — unsupported claim', color: '#6b4fa8'}
]
