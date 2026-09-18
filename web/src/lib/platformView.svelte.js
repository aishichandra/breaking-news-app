// Whether to show the 6 raw-API platform columns alongside the 4 live-
// interface ones. One shared, global switch rather than a per-question or
// per-run toggle — flipping it once should declutter (or restore) the whole
// page, not require repeating the decision on every question you open.
// Off by default: the API columns roughly doubled the platform count, and
// most of the time the live-interface answers are what you're scanning for.

const STORAGE_KEY = 'bn:showApiPlatforms'

function readStored() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export const platformView = $state({ showApi: readStored() })

export function toggleShowApi() {
  platformView.showApi = !platformView.showApi
  try {
    localStorage.setItem(STORAGE_KEY, String(platformView.showApi))
  } catch {
    // Private browsing / storage disabled — the toggle still works for this
    // session, it just won't be remembered next time.
  }
}
