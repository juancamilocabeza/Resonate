const CROSSFADE_SECONDS = 0.5
const PREFETCH_SECONDS = 5

export class GaplessBufferManager {
  constructor (currentTrackUrl, nextTrackUrl, options = {}) {
    if (currentTrackUrl && typeof currentTrackUrl === 'object') {
      options = currentTrackUrl
      currentTrackUrl = options.currentTrackUrl
      nextTrackUrl = options.nextTrackUrl
    }

    this.currentTrackUrl = currentTrackUrl || null
    this.nextTrackUrl = nextTrackUrl || null
    this.ownsContext = !options.context
    this.context = options.context || new AudioContext()
    this.fetch = options.fetch || globalThis.fetch
    this.onError = options.onError || (error => console.warn('Gapless audio prefetch failed', error))
    this.currentBuffer = null
    this.nextBuffer = null
    this.currentSource = null
    this.nextSource = null
    this.currentStartTime = 0
    this.currentGain = null
    this.nextGain = null
    this.prefetchPromise = null
    this.destroyed = false
    this.transitionScheduled = false

    if (this.nextTrackUrl) this.prepareNext(this.nextTrackUrl)
  }

  async decodeTrack (url) {
    if (typeof this.fetch !== 'function') throw new Error('Fetch is not available for audio prefetch')

    const response = await this.fetch(url)
    if (!response.ok) {
      throw new Error(`Audio request failed with status ${response.status}`)
    }

    const audioData = await response.arrayBuffer()
    const decodeContext = new OfflineAudioContext(
      2,
      Math.ceil(this.context.sampleRate * PREFETCH_SECONDS),
      this.context.sampleRate
    )
    return decodeContext.decodeAudioData(audioData)
  }

  async prepareNext (url) {
    if (this.destroyed) throw new Error('GaplessBufferManager has been destroyed')
    if (typeof url !== 'string' || url.length === 0) {
      throw new TypeError('A next track URL is required')
    }

    if (this.nextTrackUrl === url && this.prefetchPromise) return this.prefetchPromise

    this.nextTrackUrl = url
    this.nextBuffer = null
    this.transitionScheduled = false

    const prefetchPromise = this.decodeTrack(url)
      .then(buffer => {
        if (this.destroyed || this.nextTrackUrl !== url) return null
        this.nextBuffer = buffer
        this.scheduleTransition()
        return buffer
      })
      .catch(error => {
        if (this.nextTrackUrl === url) {
          this.nextBuffer = null
          this.prefetchPromise = null
          try {
            this.onError(error)
          } catch (callbackError) {
            console.error('Gapless audio error handler failed', callbackError)
          }
        }
        return null
      })

    this.prefetchPromise = prefetchPromise
    return prefetchPromise
  }

  async playCurrent () {
    if (this.destroyed) throw new Error('GaplessBufferManager has been destroyed')

    if (!this.currentBuffer) {
      if (!this.currentTrackUrl) throw new Error('A current track URL is required')
      this.currentBuffer = await this.decodeTrack(this.currentTrackUrl)
    }

    if (this.destroyed) return null

    this.disposeSource(this.currentSource, this.currentGain)
    this.currentSource = this.context.createBufferSource()
    this.currentSource.buffer = this.currentBuffer
    this.currentGain = this.context.createGain()
    this.currentGain.gain.setValueAtTime(1, this.context.currentTime)
    this.currentSource.connect(this.currentGain)
    this.currentGain.connect(this.context.destination)
    this.currentStartTime = this.context.currentTime
    this.currentSource.start(this.currentStartTime)
    this.transitionScheduled = false
    this.scheduleTransition()

    return this.currentSource
  }

  scheduleTransition () {
    if (this.transitionScheduled || !this.currentSource || !this.currentBuffer || !this.nextBuffer) return false

    const now = this.context.currentTime
    const transitionTime = Math.max(
      now,
      this.currentStartTime + Math.max(0, this.currentBuffer.duration - CROSSFADE_SECONDS)
    )
    const endTime = Math.max(transitionTime, now) + CROSSFADE_SECONDS

    this.nextSource = this.context.createBufferSource()
    this.nextSource.buffer = this.nextBuffer
    this.nextGain = this.context.createGain()
    this.nextGain.gain.setValueAtTime(0, transitionTime)
    this.nextGain.gain.linearRampToValueAtTime(1, endTime)
    this.currentGain.gain.setValueAtTime(1, transitionTime)
    this.currentGain.gain.linearRampToValueAtTime(0, endTime)
    this.nextSource.connect(this.nextGain)
    this.nextGain.connect(this.context.destination)
    this.nextSource.start(transitionTime)
    this.currentSource.stop(endTime)
    this.transitionScheduled = true

    const scheduledNextSource = this.nextSource
    const outgoingSource = this.currentSource
    const outgoingGain = this.currentGain
    outgoingSource.onended = () => {
      if (this.destroyed || this.currentSource !== outgoingSource || this.nextSource !== scheduledNextSource) return
      this.disposeSource(outgoingSource, outgoingGain, false)
      this.currentSource = scheduledNextSource
      this.currentBuffer = this.nextBuffer
      this.currentGain = this.nextGain
      this.currentStartTime = transitionTime
      this.nextSource = null
      this.nextBuffer = null
      this.nextGain = null
      this.currentTrackUrl = this.nextTrackUrl
      this.nextTrackUrl = null
      this.prefetchPromise = null
      this.transitionScheduled = false
    }

    return true
  }

  transitionToNext () {
    if (this.destroyed) throw new Error('GaplessBufferManager has been destroyed')
    if (!this.nextBuffer && this.prefetchPromise) {
      return this.prefetchPromise.then(() => this.scheduleTransition())
    }

    return this.scheduleTransition()
  }

  disposeSource (source, gain, stop = true) {
    if (source) {
      source.onended = null
      if (stop) {
        try {
          source.stop()
        } catch (error) {
          if (error.name !== 'InvalidStateError') throw error
        }
      }
      source.disconnect()
    }

    if (gain) gain.disconnect()
  }

  destroy () {
    if (this.destroyed) return
    this.destroyed = true

    this.disposeSource(this.currentSource, this.currentGain)
    this.disposeSource(this.nextSource, this.nextGain)
    this.currentSource = null
    this.nextSource = null
    this.currentGain = null
    this.nextGain = null
    this.currentBuffer = null
    this.nextBuffer = null
    this.prefetchPromise = null
    this.transitionScheduled = false

    if (this.ownsContext && typeof this.context.close === 'function' && this.context.state !== 'closed') {
      return this.context.close()
    }
  }
}
