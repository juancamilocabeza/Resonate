(function (root) {
  'use strict'

  const REGION_ID = 'a11y-status-announce'
  let clearTimer = null

  function ensureRegion () {
    if (typeof document === 'undefined') return null

    let region = document.getElementById(REGION_ID)
    if (region) return region
    if (!document.body) return null

    region = document.createElement('div')
    region.id = REGION_ID
    region.setAttribute('aria-live', 'polite')
    region.setAttribute('aria-atomic', 'true')
    region.className = 'sr-only'
    document.body.appendChild(region)
    return region
  }

  function announce (message, priority = 'polite') {
    const region = ensureRegion()
    if (!region || message === null || message === undefined) return false

    if (clearTimer !== null) {
      root.clearTimeout(clearTimer)
      clearTimer = null
    }

    region.setAttribute('aria-live', priority === 'assertive' ? 'assertive' : 'polite')
    region.textContent = ''

    const text = String(message).trim()
    if (!text) return false

    clearTimer = root.setTimeout(() => {
      region.textContent = text
      clearTimer = null
    }, 0)
    return true
  }

  root.A11yAnnouncer = { announce }

  if (typeof document !== 'undefined') {
    if (document.body) {
      ensureRegion()
    } else {
      document.addEventListener('DOMContentLoaded', ensureRegion, { once: true })
    }
  }
})(typeof window !== 'undefined' ? window : globalThis)
