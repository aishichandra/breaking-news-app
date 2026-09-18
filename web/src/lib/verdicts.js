// gpt-4o/Claude are each asked both ways, so whether the model could see the
// web is the difference worth separating on within the API group.
// Perplexity's API and Google's AI Overview have no "no search" mode —
// they're always search-grounded — so both live in the search subgroup.
const API_SUBGROUPS = [
  {
    id: 'api-no-search',
    label: 'No search',
    hint: "Answered from the model's own training data alone, no web access",
    names: ['gpt4o-no-search', 'claude-sonnet4-no-search']
  },
  {
    id: 'api-search',
    label: 'With search',
    hint: 'Answered with live web search grounding it',
    names: ['gpt4o-web-search', 'claude-sonnet4-web-search', 'perplexity-api', 'google-ai-overview-api']
  }
]

// Two kinds of platform, and it matters which is which: INTERFACE answers
// come from actually driving the live consumer surface (a real browser
// session on google.com/chatgpt.com/claude.ai/perplexity.ai); API answers
// come from calling the underlying model/search API directly, which is a
// different (and sometimes differently-behaved) thing wearing a similar
// name. Keep both lists in sync with answer_worker.py's
// APP_PLATFORMS/API_PLATFORMS and api/normalize.js's PLATFORMS.
export const PLATFORM_GROUPS = [
  {
    id: 'interface',
    label: 'Live interface',
    hint: 'Asked by driving the real consumer product in a browser',
    names: ['google', 'chatgpt', 'claude', 'perplexity']
  },
  {
    id: 'api',
    label: 'Raw API',
    hint: 'Asked by calling the model/search API directly, not the consumer product',
    subgroups: API_SUBGROUPS,
    names: API_SUBGROUPS.flatMap((g) => g.names)
  }
]

export const PLATFORM_NAMES = PLATFORM_GROUPS.flatMap((g) => g.names)

export const GROUP_OF = Object.fromEntries(
  PLATFORM_GROUPS.flatMap((g) => g.names.map((name) => [name, g.id]))
)

export const PLATFORM_LABELS = {
  google: 'Google AI Overview',
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  perplexity: 'Perplexity',
  'gpt4o-no-search': 'GPT-4o (no search)',
  'gpt4o-web-search': 'GPT-4o (web search)',
  'claude-sonnet4-no-search': 'Claude Sonnet 4 (no search)',
  'claude-sonnet4-web-search': 'Claude Sonnet 4 (web search)',
  'perplexity-api': 'Perplexity',
  'google-ai-overview-api': 'Google AI Overview'
}

export const VERDICTS = [
  { value: 'correct',     symbol: '✓', title: 'Correct' },
  { value: 'partial',     symbol: '~', title: 'Partially correct' },
  { value: 'incorrect',   symbol: '✗', title: 'Incorrect' },
  { value: 'abstained',   symbol: '∅', title: 'Abstained — no answer given' },
  { value: 'speculation', symbol: '?', title: 'Speculation — unsupported claim' }
]

export const SYMBOL = Object.fromEntries(VERDICTS.map((v) => [v.value, v.symbol]))
