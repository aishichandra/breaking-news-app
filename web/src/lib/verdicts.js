export const PLATFORM_NAMES = ['google', 'chatgpt', 'claude', 'perplexity']

export const PLATFORM_LABELS = {
  google: 'Google AI Overview',
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  perplexity: 'Perplexity'
}

export const VERDICTS = [
  { value: 'correct',     symbol: '✓', title: 'Correct' },
  { value: 'partial',     symbol: '~', title: 'Partially correct' },
  { value: 'incorrect',   symbol: '✗', title: 'Incorrect' },
  { value: 'abstained',   symbol: '∅', title: 'Abstained — no answer given' },
  { value: 'speculation', symbol: '?', title: 'Speculation — unsupported claim' }
]

export const SYMBOL = Object.fromEntries(VERDICTS.map((v) => [v.value, v.symbol]))
