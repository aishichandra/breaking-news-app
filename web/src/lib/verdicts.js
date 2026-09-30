// Keep search and no-search answers together for each API platform.
const API_SUBGROUPS = [
  {
    id: 'api-gpt4o',
    label: 'OpenAI',
    hint: 'Compare recorded OpenAI models with and without web search',
    names: ['gpt4o-no-search', 'gpt4o-web-search']
  },
  {
    id: 'api-claude',
    label: 'Claude',
    hint: 'Compare Claude with and without web search',
    names: ['claude-sonnet4-no-search', 'claude-sonnet4-web-search']
  },
  {
    id: 'api-perplexity',
    label: 'Perplexity',
    hint: 'Search-grounded API response',
    names: ['perplexity-api']
  },
  {
    id: 'api-google',
    label: 'Google AI Overview',
    hint: 'Search-grounded API response',
    names: ['google-ai-overview-api']
  }
]

for (const group of API_SUBGROUPS) {
  if (group.id !== 'api-google') {
    group.names = group.names.flatMap((name) => [name, `${name}-recent-news`])
  }
}

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
    names: ['google', 'chatgpt', 'claude', 'perplexity'].flatMap(name=>[name, `${name}-recent-news`])
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
  'gpt4o-no-search': 'OpenAI (no search)',
  'gpt4o-web-search': 'OpenAI (web search)',
  'claude-sonnet4-no-search': 'Claude (no search)',
  'claude-sonnet4-web-search': 'Claude (web search)',
  'perplexity-api': 'Perplexity',
  'google-ai-overview-api': 'Google AI Overview'
}

for (const name of PLATFORM_NAMES) {
  if (name.endsWith('-recent-news')) {
    PLATFORM_LABELS[name] = `${PLATFORM_LABELS[name.replace(/-recent-news$/, '')]} · Most recent news`
  }
}

// The taxonomy itself now lives in the app (Settings tab, backed by
// GET/POST/DELETE /api/verdict-categories) rather than being hardcoded here.
// Deliberately NOT importing the reactive verdictCategories.svelte.js store
// from this file: study.js (pure logic, exercised by the plain-Node
// study.test.mjs) imports from here too, and a $state rune or api.js's
// import.meta.env would break under plain `node --test`. Instead,
// verdictCategories.svelte.js pushes loaded/added/deleted categories in via
// setVerdictCategories() below, so this file stays a plain, dependency-free
// module everywhere except the one call site that updates it.
import {BUILTIN_VERDICT_CATEGORIES} from '../../../verdict-defaults.mjs'

let current = BUILTIN_VERDICT_CATEGORIES

export function setVerdictCategories(list) {
  current = list?.length ? list : BUILTIN_VERDICT_CATEGORIES
}

// Not fine-grained reactive on its own (current is a plain variable, not
// $state) -- components re-read it fresh on every render, which is enough
// given the article list's own 15s poll (App.svelte) already re-renders
// every PlatformAnswer/QuestionSummary instance on that cadence.
export function VERDICTS() {
  return current
}

export function SYMBOL() {
  return Object.fromEntries(VERDICTS().map((v) => [v.value, v.symbol]))
}

// Platform keys identify stable experiment slots; the saved model identifies
// the model actually used for a capture. Never infer a version from the slot.
const MODEL_LABELS = {
  'openai/gpt-5': 'GPT-5',
  'openai/gpt-4o': 'GPT-4o',
  'openai/gpt-6-astra-pro': 'GPT-6 Astra Pro',
  'anthropic/claude-opus-5.5': 'Claude Opus 5.5',
  'anthropic/claude-sonnet-4': 'Claude Sonnet 4',
  'perplexity/sonar-pro-search': 'Sonar Pro Search'
}
export function modelLabel(platform, result) {
  const base = platform.replace(/-recent-news$/, '')
  if (GROUP_OF[platform] !== 'api') return PLATFORM_LABELS[base] ?? platform
  const model = typeof result?.model === 'string' ? result.model.trim() : ''
  if (model) return MODEL_LABELS[model] ?? model
  const group = API_SUBGROUPS.find(group => group.names.includes(platform))
  return `${group?.label ?? platform} (model not recorded)`
}
export function answerLabel(platform, result) {
  if (GROUP_OF[platform] !== 'api') return PLATFORM_LABELS[platform] ?? platform
  const search = platform.includes('-no-search') ? 'No search' : 'Search'
  const variant = platform.endsWith('-recent-news') ? 'Recent' : 'Original'
  return `${modelLabel(platform, result)} · ${search} · ${variant}`
}
