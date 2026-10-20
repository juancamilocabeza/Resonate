export class ContinuousQueueManager {
  constructor (options = {}) {
    if (options && typeof options.decodeAudioData === 'function') {
      options = { context: options }
    }

    this.ownsContext = !options.context
    this.context = options.context || new AudioContext()
    this.fetch = options.fetch || globalThis.fetch
    this.onBufferReleased = options.onBufferReleased || (() => {})
    this.getNextTrackUrl = options.getNextTrackUrl || null
    this.onError = options.onError || (error => console.error('Continuous playback failed', error))
    this.currentBuffer = null
    this.nextBuffer = null
    this.currentTrackUrl = null
    this.nextTrackUrl = null
    this.currentSource = null
    this.prefetchPromise = null
    this.prefetchToken = 0
    this.currentLoadToken = 0
    this.followingToken = 0
    this.waitingForNextTrack = false
    this.destroyed = false
  }

  async decodeTrack (url) {
    if (typeof this.fetch !== 'function') throw new Error('Fetch is not available for audio playback')

    const response = await this.fetch(url)
    if (!response.ok) throw new Error(`Audio request failed with status ${response.status}`)

    return this.context.decodeAudioData(await response.arrayBuffer())
  }

  async playTrack (url) {
    this.assertActive()
    this.validateUrl(url)
    const loadToken = ++this.currentLoadToken
    this.prefetchToken += 1
    this.followingToken += 1
    this.stopCurrentSource()
    this.releaseBuffer('currentBuffer', this.currentTrackUrl)
    this.releaseBuffer('nextBuffer', this.nextTrackUrl)
    this.currentTrackUrl = null
    this.nextTrackUrl = null
    this.prefetchPromise = null

    const buffer = await this.decodeTrack(url)
    if (this.destroyed || loadToken !== this.currentLoadToken) {
      this.notifyBufferReleased(buffer, url)
      return null
    }

    this.currentBuffer = buffer
    this.currentTrackUrl = url
    this.waitingForNextTrack = false
    this.startCurrentBuffer(this.context.currentTime)
    return this.currentSource
  }

  async prefetchNextTrack (url) {
    this.assertActive()
    this.validateUrl(url)

    if (this.nextTrackUrl === url && this.prefetchPromise) return this.prefetchPromise

    const token = ++this.prefetchToken
    this.releaseBuffer('nextBuffer', this.nextTrackUrl)
    this.nextTrackUrl = url

    const promise = this.decodeTrack(url)
      .then(buffer => {
        if (this.destroyed || token !== this.prefetchToken || this.nextTrackUrl !== url) {
          this.notifyBufferReleased(buffer, url)
          return null
        }

        this.nextBuffer = buffer
        if (this.waitingForNextTrack && !this.currentSource) this.promoteNextTrack()
        return buffer
      })
      .catch(error => {
        if (token === this.prefetchToken) {
          this.nextTrackUrl = null
          this.prefetchPromise = null
          this.reportError(error)
        }
        return null
      })

    this.prefetchPromise = promise
    return promise
  }

  startCurrentBuffer (startTime) {
    const source = this.context.createBufferSource()
    source.buffer = this.currentBuffer
    source.connect(this.context.destination)
    source.onended = () => this.handleTrackEnded(source)
    this.currentSource = source
    source.start(startTime)
  }

  handleTrackEnded (source) {
    if (this.destroyed || this.currentSource !== source) return

    source.onended = null
    source.disconnect()
    source.buffer = null
    this.currentSource = null
    this.releaseBuffer('currentBuffer', this.currentTrackUrl)
    this.currentTrackUrl = null
    this.waitingForNextTrack = true

    if (this.nextBuffer) this.promoteNextTrack()
  }

  promoteNextTrack () {
    if (!this.nextBuffer || this.destroyed) return false

    this.currentBuffer = this.nextBuffer
    this.currentTrackUrl = this.nextTrackUrl
    this.nextBuffer = null
    this.nextTrackUrl = null
    this.prefetchPromise = null
    this.waitingForNextTrack = false
    this.followingToken += 1
    this.startCurrentBuffer(this.context.currentTime)
    this.prefetchFollowingTrack()
    return true
  }

  async prefetchFollowingTrack () {
    if (typeof this.getNextTrackUrl !== 'function' || this.destroyed) return

    const token = ++this.followingToken
    const currentUrl = this.currentTrackUrl
    try {
      const url = await this.getNextTrackUrl(currentUrl)
      if (url && !this.destroyed && token === this.followingToken && currentUrl === this.currentTrackUrl) {
        this.prefetchNextTrack(url).catch(error => this.reportError(error))
      }
    } catch (error) {
      this.reportError(error)
    }
  }

  releaseBuffer (property, url) {
    const buffer = this[property]
    this[property] = null
    if (buffer) this.notifyBufferReleased(buffer, url)
  }

  notifyBufferReleased (buffer, url) {
    try {
      this.onBufferReleased(buffer, url)
    } catch (error) {
      this.reportError(error)
    }
  }

  reportError (error) {
    try {
      this.onError(error)
    } catch (callbackError) {
      console.error('Continuous playback error handler failed', callbackError)
    }
  }

  stopCurrentSource () {
    if (!this.currentSource) return

    const source = this.currentSource
    this.currentSource = null
    source.onended = null
    try {
      source.stop()
    } catch (error) {
      if (error.name !== 'InvalidStateError') throw error
    }
    source.disconnect()
    source.buffer = null
  }

  validateUrl (url) {
    if (typeof url !== 'string' || url.length === 0) {
      throw new TypeError('A track URL is required')
    }
  }

  assertActive () {
    if (this.destroyed) throw new Error('ContinuousQueueManager has been destroyed')
  }

  destroy () {
    if (this.destroyed) return
    this.destroyed = true
    this.currentLoadToken += 1
    this.prefetchToken += 1
    this.followingToken += 1
    this.stopCurrentSource()
    this.releaseBuffer('currentBuffer', this.currentTrackUrl)
    this.releaseBuffer('nextBuffer', this.nextTrackUrl)
    this.currentTrackUrl = null
    this.nextTrackUrl = null
    this.prefetchPromise = null
    this.waitingForNextTrack = false

    if (this.ownsContext && this.context.state !== 'closed') return this.context.close()
  }
}

export default ContinuousQueueManager
