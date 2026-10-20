(function (root) {
  'use strict'

  const CACHE_NAMES = [
    'continuous-queue-v1',
    'search-precache-v1',
    'audio-cache-v1',
    'resonate-audio-v1',
    'audio-precache-v1'
  ]
  const QUEUE_ROW_SELECTOR = [
    '.pl-track-row[data-track-url]',
    '.tlv2-row[data-track-url]',
    '.track-item[data-track-url]',
    '.track-item[data-url]',
    '.track-row[data-track-url]',
    '[data-offline-track-url]'
  ].join(',')

  class OfflineStatusManager {
    constructor (options = {}) {
      this.window = options.window || root
      this.document = options.document || this.window.document
      this.caches = options.caches || this.window.caches
      this.cacheNames = options.cacheNames || CACHE_NAMES
      this.isOffline = options.isOffline || (() =>
        (this.window.navigator && this.window.navigator.onLine === false) ||
        (this.window.state && this.window.state.networkOnline === false)
      )
      this.handleOnline = () => this.handleConnectionChange(false)
      this.handleOffline = () => this.handleConnectionChange(true)
      this.refreshTimer = null
      this.refreshing = false

      this.window.addEventListener('online', this.handleOnline)
      this.window.addEventListener('offline', this.handleOffline)
      this.observeQueue()
      this.refreshQueueStatus()
    }

    async checkTrackAvailability (trackUrl) {
      if (!trackUrl || typeof trackUrl !== 'string' || !this.caches ||
        typeof this.caches.keys !== 'function') {
        return { available: false, complete: false, partial: false }
      }

      let cacheNames
      try {
        cacheNames = await this.caches.keys()
      } catch (error) {
        this.log('warn', 'Unable to list offline audio caches', error)
        return { available: false, complete: false, partial: false }
      }

      const availableCacheNames = this.cacheNames.filter(name => cacheNames.includes(name))
      let partialAvailability = false
      for (const name of availableCacheNames) {
        let response
        try {
          const cache = await this.caches.open(name)
          response = await cache.match(trackUrl)
          if (!response) {
            const normalizedUrl = this.normalizeUrl(trackUrl)
            if (normalizedUrl !== trackUrl) response = await cache.match(normalizedUrl)
          }
        } catch (error) {
          this.log('warn', `Unable to check offline audio cache "${name}"`, error)
          continue
        }

        if (!response) continue
        const partial = this.isPartialResponse(response, name)
        if (partial) {
          partialAvailability = true
          continue
        }
        return { available: true, complete: true, partial: false }
      }

      if (partialAvailability) return { available: true, complete: false, partial: true }
      return { available: false, complete: false, partial: false }
    }

    async updateQueueStatus (rows) {
      const queueRows = rows || (this.document
        ? this.document.querySelectorAll(QUEUE_ROW_SELECTOR)
        : [])
      const updates = Array.from(queueRows || []).map(async row => {
        const trackUrl = row.dataset.trackUrl || row.dataset.url || row.dataset.offlineTrackUrl
        if (!trackUrl) return
        const availability = await this.checkTrackAvailability(trackUrl)
        this.updateRow(row, availability)
      })
      await Promise.all(updates)
    }

    async refreshQueueStatus () {
      if (this.refreshing) return
      this.refreshing = true
      try {
        await this.updateQueueStatus()
      } finally {
        this.refreshing = false
      }
    }

    updateRow (row, availability) {
      const offline = this.isOffline()
      const status = availability.complete
        ? 'available'
        : availability.partial
          ? 'partial'
          : 'network-required'

      row.dataset.offlineAvailability = status
      row.dataset.offlineAvailable = String(availability.available)
      row.classList.toggle('offline-track-cached', status === 'available')
      row.classList.toggle('offline-track-partial', status === 'partial')
      row.classList.toggle('offline-track-network-required', status === 'network-required')
      row.classList.toggle('o-50', offline && !availability.available)
      if (!row.dataset.baseAriaLabel && row.getAttribute('aria-label')) {
        row.dataset.baseAriaLabel = row.getAttribute('aria-label')
      }

      const icon = this.getStatusIcon(row)
      if (!icon) return
      const symbol = status === 'available' ? '▣' : status === 'partial' ? '◧' : '☁'
      if (icon.textContent !== symbol) icon.textContent = symbol
      icon.title = status === 'available'
        ? 'Available offline'
        : status === 'partial'
          ? 'Partially available offline; network required for the rest'
          : 'Network required'
      icon.setAttribute('aria-label', icon.title)

      const baseLabel = row.dataset.baseAriaLabel || row.getAttribute('aria-label') || ''
      if (baseLabel) {
        const accessibleStatus = status === 'available'
          ? 'available offline'
          : status === 'partial'
            ? 'partially available offline'
            : 'network required'
        const cleanBaseLabel = baseLabel
          .replace(/, (?:available offline|partially available offline|network required)$/, '')
        row.setAttribute('aria-label', `${cleanBaseLabel}, ${accessibleStatus}`)
      }
    }

    getStatusIcon (row) {
      let icon = row.querySelector('.offline-track-status')
      if (!icon) {
        icon = this.document.createElement('span')
        icon.className = 'offline-track-status dib ml2'
        icon.setAttribute('aria-hidden', 'true')
        row.appendChild(icon)
      }
      return icon
    }

    observeQueue () {
      const MutationObserverClass = this.window.MutationObserver
      if (!this.document || !MutationObserverClass || !this.document.documentElement) return
      this.observer = new MutationObserverClass(() => {
        if (this.refreshTimer !== null) this.window.clearTimeout(this.refreshTimer)
        this.refreshTimer = this.window.setTimeout(() => {
          this.refreshTimer = null
          this.refreshQueueStatus()
        }, 100)
      })
      this.observer.observe(this.document.documentElement, { childList: true, subtree: true })
    }

    handleConnectionChange (offline) {
      if (this.window.state) this.window.state.networkOnline = !offline
      if (offline && this.window.A11yAnnouncer &&
        typeof this.window.A11yAnnouncer.announce === 'function') {
        this.window.A11yAnnouncer.announce(
          'Sin conexión. Solo se pueden reproducir pistas guardadas para uso sin conexión.',
          'assertive'
        )
      }
      this.refreshQueueStatus()
    }

    isPartialResponse (response, cacheName) {
      if (cacheName === 'audio-precache-v1') return true
      if (!response.headers || typeof response.headers.get !== 'function') return response.status === 206
      return response.status === 206 ||
        response.headers.get('X-Audio-Precache-Partial') === 'true' ||
        (typeof response.headers.has === 'function' &&
          response.headers.has('X-Audio-Precache-Content-Range'))
    }

    normalizeUrl (trackUrl) {
      try {
        const url = new URL(trackUrl, this.window.location && this.window.location.href)
        url.hash = ''
        return url.href
      } catch {
        return trackUrl
      }
    }

    log (level, message, error) {
      const logger = this.window.logger
      if (logger && typeof logger[level] === 'function') {
        logger[level]({ message, error }, 'OFFLINE')
      }
    }
  }

  const manager = new OfflineStatusManager()
  root.OfflineStatusManager = manager
  root.OfflineStatusManagerClass = OfflineStatusManager
  root.checkTrackAvailability = manager.checkTrackAvailability.bind(manager)
})(typeof window !== 'undefined' ? window : globalThis)
