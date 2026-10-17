'use strict'

import Nanocomponent from 'nanocomponent'
import html from 'nanohtml'

const PLAYER_EVENTS = {
  play: 'player:play',
  pause: 'player:pause',
  previous: 'player:previous',
  next: 'player:next',
  seek: 'player:seek',
  volume: 'player:volume',
  mute: 'player:mute'
}

const MEDIA_ACTIONS = [
  'play',
  'pause',
  'previoustrack',
  'nexttrack',
  'seekto',
  'seekbackward',
  'seekforward'
]

const SEEK_SECONDS = 5
const VOLUME_STEP = 0.1
const ARTWORK_SIZES = [96, 128, 192, 256, 384, 512]

function finiteNumber (value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function getArtwork (track) {
  const artwork = track.artwork || track.coverArt || track.cover || track.image
  if (Array.isArray(artwork)) {
    return artwork.filter(item => item && typeof item.src === 'string')
  }
  if (typeof artwork !== 'string' || artwork.length === 0) return []

  const type = /\.png(?:$|[?#])/i.test(artwork) ? 'image/png' : 'image/jpeg'
  return ARTWORK_SIZES.map(size => ({
    src: artwork,
    sizes: `${size}x${size}`,
    type
  }))
}

function isEditableTarget (target) {
  if (!target) return false
  if (target.isContentEditable) return true
  const tagName = String(target.tagName || '').toLowerCase()
  if (tagName === 'input') return String(target.type || '').toLowerCase() !== 'range'
  return tagName === 'textarea' || tagName === 'select'
}

class AccessibleAudioPlayer extends Nanocomponent {
  constructor (state, options = {}) {
    super('accessible-audio-player')
    this.state = state || {}
    this.options = options
    this.props = {}
    this.keyboardTarget = options.keyboardTarget ||
      (typeof document !== 'undefined' ? document : null)
    this.mediaSession = options.mediaSession ||
      (typeof navigator !== 'undefined' ? navigator.mediaSession : null)
    this.handleKeydown = event => this.onKeydown(event)
    this.registeredActions = []
  }

  getAudio (props = this.props) {
    return props.audio || this.options.audio || this.state.audio || null
  }

  getTrack (props = this.props) {
    return props.track || this.state.currentTrack || {}
  }

  createElement (props = {}) {
    this.props = props
    const audio = this.getAudio(props)
    const track = this.getTrack(props)
    const duration = Math.max(0, finiteNumber(props.duration, finiteNumber(audio && audio.duration)))
    const currentTime = Math.max(0, Math.min(duration || Infinity, finiteNumber(props.currentTime, finiteNumber(audio && audio.currentTime))))
    const volume = Math.max(0, Math.min(1, finiteNumber(props.volume, finiteNumber(audio && audio.volume, 1))))
    const muted = props.muted === undefined ? Boolean(audio && audio.muted) : Boolean(props.muted)
    const playing = props.playing === undefined ? Boolean(audio && !audio.paused) : Boolean(props.playing)

    this.updateMediaSession(track, props)
    this.registerMediaSessionActions()

    return html`
      <section class="audio-player" role="region" aria-label="Audio Player" tabindex="-1">
        <div class="audio-player__track" aria-live="polite">
          <span class="audio-player__title">${track.title || 'No track selected'}</span>
          <span class="audio-player__artist">${track.artist || track.creator || ''}</span>
        </div>
        <label class="audio-player__seek-label" for="audio-player-seek">Playback position</label>
        <input
          id="audio-player-seek"
          class="audio-player__seek focus-ring"
          type="range"
          min="0"
          max="${duration}"
          value="${currentTime}"
          role="slider"
          aria-label="Playback position"
          aria-valuemin="0"
          aria-valuemax="${duration}"
          aria-valuenow="${currentTime}"
          aria-valuetext="${this.formatTime(currentTime)} of ${this.formatTime(duration)}"
          oninput=${event => this.seekTo(finiteNumber(event.currentTarget.value))}
        >
        <div class="audio-player__controls">
          <button class="audio-player__button focus-ring" type="button" aria-label="Previous track" onclick=${() => this.dispatch('previous')}>Previous</button>
          <button class="audio-player__button focus-ring" type="button" aria-label="${playing ? 'Pause' : 'Play'}" onclick=${() => this.togglePlayback()}>
            ${playing ? 'Pause' : 'Play'}
          </button>
          <button class="audio-player__button focus-ring" type="button" aria-label="Next track" onclick=${() => this.dispatch('next')}>Next</button>
          <label class="audio-player__volume-label" for="audio-player-volume">Volume</label>
          <input
            id="audio-player-volume"
            class="audio-player__volume focus-ring"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value="${volume}"
            aria-label="Volume"
            aria-valuemin="0"
            aria-valuemax="1"
            aria-valuenow="${volume}"
            oninput=${event => this.setVolume(finiteNumber(event.currentTarget.value))}
          >
          <button class="audio-player__button focus-ring" type="button" aria-label="${muted ? 'Unmute' : 'Mute'}" aria-pressed="${muted}" onclick=${() => this.toggleMute()}>
            ${muted ? 'Unmute' : 'Mute'}
          </button>
        </div>
      </section>
    `
  }

  update (props = {}) {
    const previous = this.props
    return Object.keys(props).some(key => props[key] !== previous[key]) ||
      Object.keys(previous).some(key => props[key] !== previous[key])
  }

  load () {
    if (this.keyboardTarget && typeof this.keyboardTarget.addEventListener === 'function') {
      this.keyboardTarget.addEventListener('keydown', this.handleKeydown)
    }
    this.registerMediaSessionActions()
  }

  unload () {
    if (this.keyboardTarget && typeof this.keyboardTarget.removeEventListener === 'function') {
      this.keyboardTarget.removeEventListener('keydown', this.handleKeydown)
    }
    this.registeredActions.forEach(action => {
      try {
        this.mediaSession.setActionHandler(action, null)
      } catch (error) {
        if (error.name !== 'NotSupportedError' && error.name !== 'TypeError') throw error
      }
    })
    this.registeredActions = []
    if (this.mediaSession) {
      this.mediaSession.metadata = null
      this.mediaSession.playbackState = 'none'
    }
  }

  formatTime (seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
    const minutes = Math.floor(seconds / 60)
    return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
  }

  updateMediaSession (track, props = this.props) {
    if (!this.mediaSession || !track) return
    const Metadata = this.options.MediaMetadata ||
      (typeof MediaMetadata === 'function' ? MediaMetadata : null)
    if (Metadata) {
      this.mediaSession.metadata = new Metadata({
        title: track.title || 'Untitled',
        artist: track.artist || track.creator || 'Unknown Artist',
        album: track.album || track.albumTitle || '',
        artwork: getArtwork(track)
      })
    }

    const audio = this.getAudio(props)
    const playing = props.playing === undefined ? Boolean(audio && !audio.paused) : Boolean(props.playing)
    this.mediaSession.playbackState = playing ? 'playing' : 'paused'
  }

  registerMediaSessionActions () {
    if (!this.mediaSession || typeof this.mediaSession.setActionHandler !== 'function') return
    const handlers = {
      play: () => this.dispatch('play'),
      pause: () => this.dispatch('pause'),
      previoustrack: () => this.dispatch('previous'),
      nexttrack: () => this.dispatch('next'),
      seekto: details => this.seekTo(finiteNumber(details && details.seekTime)),
      seekbackward: details => this.seekBy(-Math.abs(finiteNumber(details && details.seekOffset, 10))),
      seekforward: details => this.seekBy(Math.abs(finiteNumber(details && details.seekOffset, 10)))
    }

    MEDIA_ACTIONS.forEach(action => {
      try {
        this.mediaSession.setActionHandler(action, handlers[action])
        if (!this.registeredActions.includes(action)) this.registeredActions.push(action)
      } catch (error) {
        if (error.name !== 'NotSupportedError' && error.name !== 'TypeError') throw error
      }
    })
  }

  emit (action, payload) {
    const events = this.state && this.state.events
    if (events && typeof events.emit === 'function') {
      events.emit(PLAYER_EVENTS[action], payload)
    }
  }

  dispatch (action) {
    const callbackNames = {
      play: 'onPlay',
      pause: 'onPause',
      previous: 'onPreviousTrack',
      next: 'onNextTrack'
    }
    const callback = this.props[callbackNames[action]]
    const audio = this.getAudio()
    if (typeof callback === 'function') {
      callback()
    } else if (action === 'play' && audio && typeof audio.play === 'function') {
      const result = audio.play()
      if (result && typeof result.catch === 'function') result.catch(error => this.reportError(error))
    } else if (action === 'pause' && audio && typeof audio.pause === 'function') {
      audio.pause()
    }
    this.emit(action)
    if (action === 'play' || action === 'pause') {
      if (this.mediaSession) this.mediaSession.playbackState = action === 'play' ? 'playing' : 'paused'
    }
  }

  togglePlayback () {
    const audio = this.getAudio()
    const playing = this.props.playing === undefined ? Boolean(audio && !audio.paused) : Boolean(this.props.playing)
    this.dispatch(playing ? 'pause' : 'play')
  }

  seekTo (time) {
    const audio = this.getAudio()
    const duration = finiteNumber(this.props.duration, finiteNumber(audio && audio.duration))
    const seekTime = Math.max(0, duration > 0 ? Math.min(duration, time) : time)
    const callback = this.props.onSeek
    if (typeof callback === 'function') callback(seekTime)
    else if (audio) audio.currentTime = seekTime
    this.emit('seek', { time: seekTime })
  }

  seekBy (offset) {
    const audio = this.getAudio()
    const currentTime = typeof this.props.onSeek === 'function'
      ? finiteNumber(this.props.currentTime, finiteNumber(audio && audio.currentTime))
      : finiteNumber(audio && audio.currentTime, finiteNumber(this.props.currentTime))
    this.seekTo(currentTime + offset)
  }

  setVolume (volume) {
    const nextVolume = Math.max(0, Math.min(1, volume))
    const audio = this.getAudio()
    if (typeof this.props.onVolumeChange === 'function') this.props.onVolumeChange(nextVolume)
    else if (audio) audio.volume = nextVolume
    this.emit('volume', { volume: nextVolume })
  }

  toggleMute () {
    const audio = this.getAudio()
    const muted = this.props.muted === undefined ? Boolean(audio && audio.muted) : Boolean(this.props.muted)
    const nextMuted = !muted
    if (typeof this.props.onMuteChange === 'function') this.props.onMuteChange(nextMuted)
    else if (audio) audio.muted = nextMuted
    this.emit('mute', { muted: nextMuted })
  }

  onKeydown (event) {
    if (!event || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isEditableTarget(event.target)) return

    switch (event.code || event.key) {
      case 'Space':
      case ' ':
        if (event.target && String(event.target.tagName || '').toLowerCase() === 'button') return
        this.togglePlayback()
        event.preventDefault()
        break
      case 'ArrowLeft':
        this.seekBy(-SEEK_SECONDS)
        event.preventDefault()
        break
      case 'ArrowRight':
        this.seekBy(SEEK_SECONDS)
        event.preventDefault()
        break
      case 'ArrowUp': {
        const audio = this.getAudio()
        const volume = typeof this.props.onVolumeChange === 'function'
          ? finiteNumber(this.props.volume, finiteNumber(audio && audio.volume, 1))
          : finiteNumber(audio && audio.volume, finiteNumber(this.props.volume, 1))
        this.setVolume(volume + VOLUME_STEP)
        event.preventDefault()
        break
      }
      case 'ArrowDown': {
        const audio = this.getAudio()
        const volume = typeof this.props.onVolumeChange === 'function'
          ? finiteNumber(this.props.volume, finiteNumber(audio && audio.volume, 1))
          : finiteNumber(audio && audio.volume, finiteNumber(this.props.volume, 1))
        this.setVolume(volume - VOLUME_STEP)
        event.preventDefault()
        break
      }
      case 'KeyM':
      case 'm':
      case 'M':
        this.toggleMute()
        event.preventDefault()
        break
    }
  }

  reportError (error) {
    const callback = this.props.onError || this.options.onError
    if (typeof callback === 'function') callback(error)
    else if (typeof console !== 'undefined' && typeof console.error === 'function') {
      console.error('Audio player action failed', error)
    }
  }
}

AccessibleAudioPlayer.events = PLAYER_EVENTS

export default AccessibleAudioPlayer
