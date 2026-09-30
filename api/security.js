const READ_ONLY = new Set(['GET', 'HEAD', 'OPTIONS'])

export function productionEnvironment(env) {
  return env.NODE_ENV === 'production' || Boolean(env.RAILWAY_ENVIRONMENT_ID)
}

export function assertAuthentication(env) {
  if (productionEnvironment(env) && !env.AUTH_PASSWORD && !env.AUTH_USERS_JSON) {
    throw new Error('AUTH_PASSWORD must be configured for a deployed app')
  }
}

export function allowedOrigin(req, env = process.env) {
  const origin = req.get('Origin')
  if (!origin) return true // Authenticated non-browser collection clients.
  try {
    const url = new URL(origin)
    if (!['http:', 'https:'].includes(url.protocol)) return false
    const explicit = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
    if (explicit.includes(url.origin)) return true
    if (url.host === req.get('Host')) return true
    return !productionEnvironment(env) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  } catch { return false }
}

export function requestSecurity(env = process.env) {
  return (req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff')
    res.set('X-Frame-Options', 'DENY')
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin')
    res.set('Cache-Control', 'no-store')
    if (!productionEnvironment(env) && !env.AUTH_PASSWORD && !env.AUTH_USERS_JSON) {
      const host = (req.get('Host') || '').replace(/:\d+$/, '')
      if (!['localhost','127.0.0.1','[::1]'].includes(host)) return res.status(403).json({error:'Invalid local host'})
    }
    if (!READ_ONLY.has(req.method) &&
        (!allowedOrigin(req, env) || req.get('Sec-Fetch-Site') === 'cross-site')) {
      return res.status(403).json({error: 'Cross-site writes are not allowed'})
    }
    next()
  }
}
