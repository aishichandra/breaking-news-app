// Shared by ingestion and rendering: escaping HTML does not make a URL safe.
export function safeHttpUrl(value) {
  if (typeof value !== 'string' || value.length > 8192) return null
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? value.trim() : null
  } catch { return null }
}
