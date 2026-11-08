const PREFIX_BYTES = 256 * 1024

export class SmartPrefetchEngine {
  constructor (options = {}) {
    this.context = options.context || null
    this.fetch = options.fetch || globalThis.fetch
    this.connection = options.connection || (
      typeof globalThis.navigator !== 'undefined'
        ? globalThis.navigator.connection ||
          globalThis.navigator.mozConnection ||
          globalThis.navigator.webkitConnection ||
          null
        : null
    )
    this.serviceWorker = options.serviceWorker !== undefined
      ? options.serviceWorker
      : (typeof globalThis.navigator !== 'undefined' ? globalThis.navigator.serviceWorker : null)
    this.onError = options.onError || (error => console.error('Audio prefetch failed', error))
    this.onNetworkChange = options.onNetworkChange || null
    this.handleServiceWorkerMessage = event => {
      const result = event.data
      if (!result || result.type !== 'PRECACHE_AUDIO_PIPELINE_RESULT') return
      if (result.error) {
        this.reportError(new Error(result.error))
      } else {
        for (const item of result.results || []) {
          if (!item.cached) {
            this.reportError(new Error(`Audio prefix cache failed: ${item.reason || 'unknown error'}`))
          }
        }
      }
    }
    this.handleConnectionChange = () => {
      if (typeof this.onNetworkChange === 'function') this.onNetworkChange(this.getNetworkProfile())
    }

    this.connection?.addEventListener?.('change', this.handleConnectionChange)
    this.serviceWorker?.addEventListener?.('message', this.handleServiceWorkerMessage)
  }

  getNetworkProfile () {
    const effectiveType = String(this.connection?.effectiveType || '').toLowerCase()
    const connectionType = String(this.connection?.type || '').toLowerCase()
    const saveData = Boolean(this.connection?.saveData)
    const fast = !saveData && (
      effectiveType === '4g' ||
      effectiveType === '5g' ||
      connectionType === 'wifi' ||
      connectionType === 'ethernet'
    )

    return { effectiveType: effectiveType || 'unknown', connectionType, saveData, fast }
  }

  async loadTrack (url) {
    this.validateUrl(url)
    if (!this.context || typeof this.context.decodeAudioData !== 'function') {
      throw new Error('An AudioContext with decodeAudioData is required')
    }
    if (typeof this.fetch !== 'function') throw new Error('Fetch is not available for audio playback')

    const response = await this.fetch(url)
    if (!response.ok) throw new Error(`Audio request failed with status ${response.status}`)

    this.cacheCompleteTrack(url, response)
    let audioData = await response.arrayBuffer()
    try {
      return await this.context.decodeAudioData(audioData)
    } finally {
      audioData = null
    }
  }

  cacheCompleteTrack (url, response) {
    const cacheStorage = globalThis.caches
    if (!cacheStorage || typeof cacheStorage.open !== 'function') return
    const cachedResponse = response.clone()
    cacheStorage.open('continuous-queue-v1')
      .then(cache => cache.put(url, cachedResponse))
      .catch(error => this.reportError(error))
  }

  async prefetchTrack (track, followingTrack = null) {
    this.validateTrack(track)
    const profile = this.getNetworkProfile()

    if (profile.fast) {
      const buffer = await this.loadTrack(track.url)
      if (followingTrack) await this.cachePrefixes(null, followingTrack.url)
      return { buffer, complete: true, profile }
    }

    await this.cachePrefixes(track.url, null)
    return { buffer: null, complete: false, profile }
  }

  async cachePrefixes (queueUrl, searchUrl) {
    const controller = this.serviceWorker && this.serviceWorker.controller
    if (controller && typeof controller.postMessage === 'function') {
      try {
        controller.postMessage({
          type: 'PRECACHE_AUDIO_PIPELINE',
          queueUrl,
          searchUrl,
          maxBytes: PREFIX_BYTES
        })
        return true
      } catch (error) {
        this.reportError(error)
      }
    }

    try {
      await Promise.all([
        queueUrl ? this.fetchPrefix(queueUrl) : null,
        searchUrl ? this.fetchPrefix(searchUrl) : null
      ])
      return false
    } catch (error) {
      this.reportError(error)
      return false
    }
  }

  async fetchPrefix (url) {
    this.validateUrl(url)
    if (typeof this.fetch !== 'function') throw new Error('Fetch is not available for audio prefetch')

    const response = await this.fetch(url, {
      headers: { Range: `bytes=0-${PREFIX_BYTES - 1}` }
    })
    if (!response.ok && response.status !== 206) {
      throw new Error(`Audio prefix request failed with status ${response.status}`)
    }

    if (!response.body || typeof response.body.getReader !== 'function') {
      const prefix = await response.arrayBuffer()
      return prefix.slice(0, PREFIX_BYTES)
    }

    const reader = response.body.getReader()
    const chunks = []
    let totalBytes = 0
    try {
      while (totalBytes < PREFIX_BYTES) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = value.subarray(0, PREFIX_BYTES - totalBytes)
        chunks.push(chunk)
        totalBytes += chunk.byteLength
        if (chunk.byteLength < value.byteLength) {
          await reader.cancel()
          break
        }
      }
    } finally {
      reader.releaseLock()
    }

    const prefix = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      prefix.set(chunk, offset)
      offset += chunk.byteLength
    }
    return prefix.buffer
  }

  validateTrack (track) {
    if (!track || typeof track !== 'object') throw new TypeError('A track is required')
    this.validateUrl(track.url)
  }

  validateUrl (url) {
    if (typeof url !== 'string' || url.length === 0) throw new TypeError('A track URL is required')
  }

  reportError (error) {
    try {
      this.onError(error)
    } catch (callbackError) {
      console.error('Audio prefetch error handler failed', callbackError)
    }
  }

  destroy () {
    this.connection?.removeEventListener?.('change', this.handleConnectionChange)
    this.serviceWorker?.removeEventListener?.('message', this.handleServiceWorkerMessage)
    this.onNetworkChange = null
  }
}

export default SmartPrefetchEngine
