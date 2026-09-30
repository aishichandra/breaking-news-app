// Compare article identities without dropping meaningful query parameters.
export function articleIdentity(value) {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || /^(fbclid|gclid|msclkid|mc_cid|mc_eid)$/i.test(key)) {
        url.searchParams.delete(key)
      }
    }
    url.searchParams.sort()
    return url.hostname.replace(/^www\./, '') + (url.port ? ':' + url.port : '')
      + (url.pathname.replace(/\/+$/, '') || '/') + url.search
  } catch { return null }
}

export function sourceCitationStatus(sourceUrl, citations) {
  const source = articleIdentity(sourceUrl)
  if (!source) return null
  return (Array.isArray(citations) ? citations : []).some((c) => articleIdentity(c?.url) === source)
}
