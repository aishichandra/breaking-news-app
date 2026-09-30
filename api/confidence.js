export const CONFIDENCE_VALUES = ['confident', 'not_confident']
export const supportsConfidence = (verdict) => ['correct', 'incorrect'].includes(verdict)

export function confidenceUpdate(body, existingVerdict) {
  const verdict = 'verdict' in body ? body.verdict : existingVerdict
  if ('confidence' in body) {
    if (body.confidence !== null && !CONFIDENCE_VALUES.includes(body.confidence)) {
      throw new Error('confidence must be null, confident, or not_confident')
    }
    if (body.confidence !== null && !supportsConfidence(verdict)) {
      throw new Error('Confidence is only available for Correct or Incorrect answers')
    }
    return { confidence: body.confidence }
  }
  return 'verdict' in body && !supportsConfidence(verdict) ? { confidence: null } : {}
}
