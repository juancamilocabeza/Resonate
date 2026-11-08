import { AudioNodeLifecycle } from './AudioNodeLifecycle.js'
import { SmartPrefetchEngine } from './SmartPrefetchEngine.js'

const PREFETCH_FRACTION = 0.8
const PREFETCH_REMAINING_SECONDS = 15
const MANUAL_CROSSFADE_SECONDS = 0.1
const CROSSFADE_STEPS = 10

export class GaplessAudioScheduler {
  constructor (options = {}) {
    if (!options.context) throw new TypeError('An AudioContext is required')
    this.context = options.context
    this.ownsEngine = !options.prefetchEngine
    this.engine = options.prefetchEngine || new SmartPrefetchEngine({
      context: this.context,
      fetch: options.fetch,
      connection: options.connection,
      serviceWorker: options.serviceWorker,
      onError: options.onError
    })
    this.ownsLifecycle = !options.lifecycle
    this.lifecycle = options.lifecycle || new AudioNodeLifecycle({
      document: options.document,
      onError: options.onError
    })
    this.mediaSession = options.mediaSessionAdapter || null
    this.getNextTrack = options.getNextTrack || null
    this.onTrackChange = options.onTrackChange || (() => {})
    this.onError = options.onError || (error => console.error('Gapless playback failed', error))
    this.current = null
    this.nextTrack = null
    this.nextBuffer = null
    this.nextLoadPromise = null
    this.nextLoadToken = 0
    this.followingLookupToken = 0
    this.followingLookupFor = null
    this.followingLookupPromise = null
    this.followingTrackFor = null
    this.followingTrack = null
    this.scheduledNext = null
    this.transitionOutgoing = null
    this.prefetchTrigger = null
    this.prefetchStarted = false
    this.paused = false
    this.destroyed = false
    this.lastPositionUpdateAt = Number.NEGATIVE_INFINITY
    this.animationFrame = null
    this.monitorToken = 0
    this.requestAnimationFrame = options.requestAnimationFrame ||
      (typeof globalThis.requestAnimationFrame === 'function'
        ? globalThis.requestAnimationFrame.bind(globalThis)
        : null)
    this.cancelAnimationFrame = options.cancelAnimationFrame ||
      (typeof globalThis.cancelAnimationFrame === 'function'
        ? globalThis.cancelAnimationFrame.bind(globalThis)
        : null)
    this.handleVisibilityChange = () => {
      if (this.document?.visibilityState !== 'visible') {
        this.resumeContext().catch(error => this.reportError(error))
      }
      this.checkPrefetchThreshold()
    }
    this.document = options.document !== undefined
      ? options.document
      : (typeof globalThis.document !== 'undefined' ? globalThis.document : null)
    this.document?.addEventListener('visibilitychange', this.handleVisibilityChange)
    this.mediaSession?.registerActionHandlers?.({
      onPlay: () => this.resume(),
      onPause: () => this.pause(),
      onNextTrack: () => this.skipToNext(),
      onSeekTo: time => this.seekTo(time)
    })
  }

  async resumeContext () {
    if (this.context.state === 'suspended' && typeof this.context.resume === 'function') {
      await this.context.resume()
    }
  }

  async play (track, options = {}) {
    this.assertActive()
    this.validateTrack(track)
    await this.resumeContext()
    const buffer = options.buffer || await this.engine.loadTrack(track.url)
    if (this.destroyed) return null
    await this.resumeContext()

    if (!this.current) {
      this.startPlayback(track, buffer, this.context.currentTime, 0, 1)
    } else if (options.manual) {
      this.startManualTransition(track, buffer)
    } else {
      this.nextLoadToken += 1
      this.nextTrack = null
      this.nextLoadPromise = null
      this.resetFollowingTrack()
      this.cancelPrefetchTrigger()
      this.releaseNextBuffer()
      this.stopPlayback(this.transitionOutgoing)
      this.transitionOutgoing = null
      this.stopPlayback(this.current)
      this.startPlayback(track, buffer, this.context.currentTime, 0, 1)
    }

    if (options.nextTrack) this.setNextTrack(options.nextTrack)
    this.startMonitoring()
    return this.current.source
  }

  setNextTrack (track) {
    this.assertActive()
    if (track) this.validateTrack(track)
    this.nextLoadToken += 1
    this.nextTrack = track || null
    this.releaseNextBuffer()
    this.cancelPrefetchTrigger()
    this.nextLoadPromise = null
    this.prefetchStarted = false
    if (this.followingTrackFor === this.current?.track && this.followingTrack !== track) {
      this.resetFollowingTrack()
    }
    if (this.current) this.armPrefetchTrigger()
  }

  checkPrefetchThreshold () {
    if (this.destroyed || !this.current || !this.nextTrack || this.prefetchStarted) return false
    if (this.paused || this.current.source === null) return false

    if (this.getCurrentPosition() < this.getPrefetchPosition()) return false

    this.prefetchStarted = true
    const track = this.nextTrack
    const token = ++this.nextLoadToken
    if (typeof this.getNextTrack === 'function') this.requestFollowingTrack(track)
    const load = this.engine.prefetchTrack(track)
      .then(result => {
        if (this.destroyed || token !== this.nextLoadToken || this.nextTrack !== track) return null
        if (result.buffer) {
          this.nextBuffer = result.buffer
          this.scheduleNaturalTransition()
        }
        return result.buffer
      })
      .catch(error => {
        if (token === this.nextLoadToken) {
          this.prefetchStarted = false
          this.reportError(error)
        }
        return null
      })
    this.nextLoadPromise = load
    this.cancelPrefetchTrigger()
    return true
  }

  getPrefetchPosition () {
    const duration = this.current.buffer.duration
    return Math.max(0, Math.min(
      duration * PREFETCH_FRACTION,
      duration - PREFETCH_REMAINING_SECONDS
    ))
  }

  armPrefetchTrigger () {
    if (this.checkPrefetchThreshold()) return true
    if (!this.current || !this.nextTrack || this.paused ||
      typeof this.context.createConstantSource !== 'function') return false

    const startTime = this.current.startedAt + this.getPrefetchPosition() - this.current.offset
    if (startTime <= this.context.currentTime) return this.checkPrefetchThreshold()

    let source
    let gain
    try {
      source = this.context.createConstantSource()
      gain = this.context.createGain()
      gain.gain.setValueAtTime(0, this.context.currentTime)
      source.connect(gain)
      gain.connect(this.context.destination)
      this.prefetchTrigger = { source, gain }
      this.lifecycle.register(source, gain, () => {
        if (this.prefetchTrigger?.source === source) this.prefetchTrigger = null
        this.checkPrefetchThreshold()
      })
      source.start(startTime)
      source.stop(startTime + (1 / this.context.sampleRate))
    } catch (error) {
      if (source || gain) this.lifecycle.disposeNode(source, gain)
      this.prefetchTrigger = null
      this.reportError(error)
      return false
    }
    return true
  }

  cancelPrefetchTrigger () {
    if (!this.prefetchTrigger) return
    const { source, gain } = this.prefetchTrigger
    this.prefetchTrigger = null
    this.lifecycle.disposeNode(source, gain)
  }

  scheduleNaturalTransition () {
    if (!this.current || !this.nextBuffer || !this.nextTrack || this.scheduledNext) return false
    const current = this.current
    const expectedTime = current.startedAt + current.buffer.duration - current.offset
    const now = this.context.currentTime
    const nextOffset = Math.max(0, now - expectedTime)
    if (nextOffset >= this.nextBuffer.duration) return false
    const transitionTime = Math.max(now, expectedTime)
    const nextPlayback = this.createPlayback(this.nextTrack, this.nextBuffer, transitionTime, nextOffset, 1)
    nextPlayback.previous = current
    this.scheduledNext = nextPlayback
    current.source.stop(transitionTime)
    return true
  }

  async skipToNext () {
    if (!this.nextTrack) return null
    if (this.nextBuffer) {
      await this.resumeContext()
      this.startManualTransition(this.nextTrack, this.nextBuffer)
      return this.current.source
    }
    if (this.nextLoadPromise) await this.nextLoadPromise
    if (this.nextBuffer) {
      await this.resumeContext()
      this.startManualTransition(this.nextTrack, this.nextBuffer)
      return this.current.source
    }
    return this.play(this.nextTrack, { manual: true })
  }

  startManualTransition (track, buffer) {
    this.stopPlayback(this.transitionOutgoing)
    this.transitionOutgoing = null
    this.releaseNextBuffer()
    this.nextLoadToken += 1
    this.nextTrack = null
    this.nextLoadPromise = null
    this.prefetchStarted = false
    this.cancelPrefetchTrigger()
    const now = this.context.currentTime
    const outgoing = this.current
    const hasOutgoing = Boolean(outgoing?.source)
    const incoming = this.createPlayback(track, buffer, now, 0, hasOutgoing ? 0 : 1)

    if (hasOutgoing) {
      this.rampEqualPower(outgoing.gain.gain, incoming.gain.gain, now)
      outgoing.source.stop(now + MANUAL_CROSSFADE_SECONDS)
      this.transitionOutgoing = outgoing
    }
    this.current = incoming
    this.scheduledNext = null
    this.updateMediaSession(track, buffer, 0)
    this.notifyTrackChange(track)
    this.requestFollowingTrack(track)
    this.startMonitoring()
  }

  rampEqualPower (outgoing, incoming, startTime) {
    outgoing.cancelScheduledValues?.(startTime)
    incoming.cancelScheduledValues?.(startTime)
    outgoing.setValueAtTime(1, startTime)
    incoming.setValueAtTime(0, startTime)

    for (let step = 1; step <= CROSSFADE_STEPS; step++) {
      const progress = step / CROSSFADE_STEPS
      const time = startTime + MANUAL_CROSSFADE_SECONDS * progress
      const outgoingGain = step === CROSSFADE_STEPS ? 0 : Math.cos(progress * Math.PI / 2)
      const incomingGain = step === CROSSFADE_STEPS ? 1 : Math.sin(progress * Math.PI / 2)
      outgoing.linearRampToValueAtTime(outgoingGain, time)
      incoming.linearRampToValueAtTime(incomingGain, time)
    }
  }

  createPlayback (track, buffer, startedAt, offset, gainValue) {
    const source = this.context.createBufferSource()
    const gain = this.context.createGain()
    const playback = { track, buffer, source, gain, startedAt, offset, previous: null }
    try {
      source.buffer = buffer
      gain.gain.setValueAtTime(gainValue, startedAt)
      source.connect(gain)
      gain.connect(this.context.destination)
      this.lifecycle.register(source, gain, () => this.handleSourceEnded(playback))
      source.start(startedAt, offset)
    } catch (error) {
      this.lifecycle.disposeNode(source, gain)
      throw error
    }
    return playback
  }

  handleSourceEnded (playback) {
    if (this.destroyed) return
    if (this.transitionOutgoing === playback) this.transitionOutgoing = null
    if (this.scheduledNext?.previous === playback && this.current === playback) {
      playback = this.scheduledNext
      this.current = playback
      this.scheduledNext = null
      this.nextBuffer = null
      this.nextTrack = null
      this.nextLoadPromise = null
      this.nextLoadToken += 1
      this.prefetchStarted = false
      this.paused = false
      this.updateMediaSession(playback.track, playback.buffer, playback.offset)
      this.notifyTrackChange(playback.track)
      if (this.followingTrackFor === playback.track) {
        this.setNextTrack(this.followingTrack)
      } else {
        this.requestFollowingTrack(playback.track)
      }
      return
    }

    if (this.current === playback && !this.paused) {
      this.current = null
      this.stopMonitoring()
      if (this.nextTrack) this.skipToNext().catch(error => this.reportError(error))
    }
  }

  requestFollowingTrack (track) {
    if (typeof this.getNextTrack !== 'function' || this.destroyed) return Promise.resolve(null)
    if (this.followingTrackFor === track) return Promise.resolve(this.followingTrack)
    if (this.followingLookupFor === track && this.followingLookupPromise) {
      return this.followingLookupPromise
    }

    const token = ++this.followingLookupToken
    this.followingLookupFor = track
    const lookup = Promise.resolve()
      .then(() => this.getNextTrack(track))
      .then(async next => {
        if (this.destroyed || token !== this.followingLookupToken) return null
        if (next) this.validateTrack(next)
        this.followingTrackFor = track
        this.followingTrack = next || null

        if (next && this.engine.getNetworkProfile?.().fast &&
          typeof this.engine.cachePrefixes === 'function') {
          await this.engine.cachePrefixes(null, next.url)
        }
        if (this.current?.track === track) this.setNextTrack(next)
        return next || null
      })
      .catch(error => {
        if (token === this.followingLookupToken) {
          this.followingLookupFor = null
          this.followingLookupPromise = null
        }
        this.reportError(error)
        return null
      })
    this.followingLookupPromise = lookup
    return lookup
  }

  pause () {
    if (!this.current || this.paused) return false
    const position = this.getCurrentPosition()
    this.current.offset = position
    this.current.startedAt = this.context.currentTime
    this.cancelScheduledNext()
    this.cancelPrefetchTrigger()
    this.stopPlayback(this.transitionOutgoing)
    this.transitionOutgoing = null
    this.lifecycle.disposeNode(this.current.source, this.current.gain)
    this.current.source = null
    this.paused = true
    this.stopMonitoring()
    if (this.mediaSession?.mediaSession) this.mediaSession.mediaSession.playbackState = 'paused'
    this.updatePositionState()
    return true
  }

  async resume () {
    if (!this.current || !this.paused) return false
    await this.resumeContext()
    const playback = this.current
    const source = this.context.createBufferSource()
    const gain = this.context.createGain()
    source.buffer = playback.buffer
    gain.gain.setValueAtTime(1, this.context.currentTime)
    source.connect(gain)
    gain.connect(this.context.destination)
    playback.source = source
    playback.gain = gain
    playback.startedAt = this.context.currentTime
    this.lifecycle.register(source, gain, () => this.handleSourceEnded(playback))
    source.start(playback.startedAt, playback.offset)
    this.paused = false
    if (this.nextBuffer) this.scheduleNaturalTransition()
    else if (this.nextTrack) this.armPrefetchTrigger()
    this.startMonitoring()
    if (this.mediaSession?.mediaSession) this.mediaSession.mediaSession.playbackState = 'playing'
    return true
  }

  seekTo (time) {
    if (!this.current || !Number.isFinite(time)) return false
    const duration = this.current.buffer.duration
    const position = Math.min(Math.max(0, time), Math.max(0, duration - 0.001))
    const playback = this.current
    this.stopPlayback(this.transitionOutgoing)
    this.transitionOutgoing = null
    this.cancelScheduledNext()
    this.cancelPrefetchTrigger()
    if (playback.source) this.lifecycle.disposeNode(playback.source, playback.gain)
    playback.offset = position
    playback.startedAt = this.context.currentTime

    if (!this.paused) {
      const source = this.context.createBufferSource()
      const gain = this.context.createGain()
      source.buffer = playback.buffer
      gain.gain.setValueAtTime(1, playback.startedAt)
      source.connect(gain)
      gain.connect(this.context.destination)
      playback.source = source
      playback.gain = gain
      this.lifecycle.register(source, gain, () => this.handleSourceEnded(playback))
      source.start(playback.startedAt, position)
    }
    if (!this.paused && this.nextBuffer) this.scheduleNaturalTransition()
    else if (!this.paused && this.nextTrack) this.armPrefetchTrigger()
    this.updatePositionState()
    return true
  }

  getCurrentPosition () {
    if (!this.current) return 0
    if (this.paused || !this.current.source) return this.current.offset
    return Math.min(
      this.current.buffer.duration,
      this.current.offset + Math.max(0, this.context.currentTime - this.current.startedAt)
    )
  }

  startPlayback (track, buffer, startTime, offset, gainValue) {
    this.current = this.createPlayback(track, buffer, startTime, offset, gainValue)
    this.paused = false
    this.updateMediaSession(track, buffer, offset)
    this.notifyTrackChange(track)
  }

  stopPlayback (playback) {
    if (playback?.source) this.lifecycle.disposeNode(playback.source, playback.gain)
  }

  resetFollowingTrack () {
    this.followingLookupToken += 1
    this.followingLookupFor = null
    this.followingLookupPromise = null
    this.followingTrackFor = null
    this.followingTrack = null
  }

  updateMediaSession (track, buffer, position) {
    this.mediaSession?.updateMetadata?.(track)
    this.mediaSession?.updatePositionState?.(buffer.duration, 1, position)
    if (this.mediaSession?.mediaSession) this.mediaSession.mediaSession.playbackState = 'playing'
  }

  updatePositionState () {
    if (!this.current) return
    const now = this.context.currentTime
    if (now - this.lastPositionUpdateAt < 1) return
    this.lastPositionUpdateAt = now
    this.mediaSession?.updatePositionState?.(
      this.current.buffer.duration,
      1,
      this.getCurrentPosition()
    )
  }

  notifyTrackChange (track) {
    try {
      this.onTrackChange(track)
    } catch (error) {
      this.reportError(error)
    }
  }

  startMonitoring () {
    if (!this.requestAnimationFrame || this.animationFrame !== null) return
    const token = ++this.monitorToken
    const tick = () => {
      if (token !== this.monitorToken) return
      this.animationFrame = null
      if (this.destroyed || !this.current || this.paused) return
      if (this.context.state === 'suspended') {
        this.resumeContext().catch(error => this.reportError(error))
      }
      this.checkPrefetchThreshold()
      this.updatePositionState()
      this.animationFrame = this.requestAnimationFrame(tick)
    }
    this.animationFrame = this.requestAnimationFrame(tick)
  }

  stopMonitoring () {
    this.monitorToken += 1
    if (this.animationFrame !== null && this.cancelAnimationFrame) {
      this.cancelAnimationFrame(this.animationFrame)
    }
    this.animationFrame = null
  }

  releaseNextBuffer () {
    this.cancelScheduledNext()
    this.nextBuffer = null
  }

  cancelScheduledNext () {
    if (!this.scheduledNext) return
    this.stopPlayback(this.scheduledNext)
    this.scheduledNext = null
  }

  reportError (error) {
    try {
      this.onError(error)
    } catch (callbackError) {
      console.error('Gapless playback error handler failed', callbackError)
    }
  }

  validateTrack (track) {
    if (!track || typeof track !== 'object' ||
      typeof track.url !== 'string' || track.url.length === 0) {
      throw new TypeError('A track with a URL is required')
    }
  }

  assertActive () {
    if (this.destroyed) throw new Error('GaplessAudioScheduler has been destroyed')
  }

  destroy () {
    if (this.destroyed) return
    this.destroyed = true
    this.nextLoadToken += 1
    this.stopMonitoring()
    this.cancelPrefetchTrigger()
    this.document?.removeEventListener('visibilitychange', this.handleVisibilityChange)
    this.stopPlayback(this.current)
    this.stopPlayback(this.scheduledNext)
    this.stopPlayback(this.transitionOutgoing)
    this.current = null
    this.scheduledNext = null
    this.transitionOutgoing = null
    this.nextTrack = null
    this.nextBuffer = null
    this.nextLoadPromise = null
    if (this.ownsEngine) this.engine.destroy()
    if (this.ownsLifecycle) this.lifecycle.destroy()
  }
}

export default GaplessAudioScheduler
