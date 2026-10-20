const MEDIA_ACTIONS = [
  'play',
  'pause',
  'previoustrack',
  'nexttrack',
  'seekto',
  'seekbackward',
  'seekforward'
]

const ARTWORK_SIZES = [96, 128, 256, 512]

export class MediaSessionAdapter {
  constructor (options = {}) {
    const browserNavigator = options.navigator ||
      (typeof globalThis.navigator !== 'undefined' ? globalThis.navigator : null)
    this.mediaSession = options.mediaSession !== undefined
      ? options.mediaSession
      : (browserNavigator && browserNavigator.mediaSession) || null
    this.MediaMetadata = options.MediaMetadata !== undefined
      ? options.MediaMetadata
      : (typeof globalThis.MediaMetadata === 'function' ? globalThis.MediaMetadata : null)
    this.player = options.player || null
    this.isSupported = Boolean(this.mediaSession)
  }

  updateMetadata (track) {
    if (!this.mediaSession || !track || !this.MediaMetadata) return false

    const artworkSource = this.getArtworkSource(track)
    const artwork = artworkSource
      ? ARTWORK_SIZES.map(size => ({
        src: artworkSource,
        sizes: `${size}x${size}`,
        type: this.getArtworkType(artworkSource)
      }))
      : []
    const metadata = new this.MediaMetadata({
      title: track.title || 'Untitled',
      artist: track.artist || track.creator || 'Unknown Artist',
      album: track.album || track.albumTitle || '',
      artwork
    })

    this.mediaSession.metadata = metadata
    return true
  }

  updatePositionState (duration, playbackRate, currentTime) {
    if (!this.mediaSession || typeof this.mediaSession.setPositionState !== 'function') return false
    if (!Number.isFinite(duration) || duration <= 0 ||
      !Number.isFinite(playbackRate) || playbackRate <= 0 ||
      !Number.isFinite(currentTime) || currentTime < 0) {
      return false
    }

    this.mediaSession.setPositionState({
      duration,
      playbackRate,
      position: Math.min(currentTime, duration)
    })
    return true
  }

  registerActionHandlers (handlers = {}) {
    if (!this.mediaSession || typeof this.mediaSession.setActionHandler !== 'function') return false

    const actions = {
      play: () => this.invoke(handlers.onPlay, ['play', 'togglePlay']),
      pause: () => this.invoke(handlers.onPause, ['pause']),
      previoustrack: () => this.invoke(handlers.onPreviousTrack, ['playPrevious', 'previousTrack']),
      nexttrack: () => this.invoke(handlers.onNextTrack, ['playNext', 'nextTrack']),
      seekto: details => this.seekTo(details && details.seekTime, handlers.onSeekTo),
      seekbackward: details => this.seekBy(-Math.abs(this.getSeekOffset(details)), handlers.onSeekTo),
      seekforward: details => this.seekBy(Math.abs(this.getSeekOffset(details)), handlers.onSeekTo)
    }

    let registered = false
    MEDIA_ACTIONS.forEach(action => {
      try {
        this.mediaSession.setActionHandler(action, actions[action])
        registered = true
      } catch (error) {
        if (error.name !== 'NotSupportedError' && error.name !== 'TypeError') throw error
      }
    })

    return registered
  }

  invoke (handler, playerMethods) {
    if (typeof handler === 'function') return handler()
    if (!this.player) return undefined

    for (const method of playerMethods) {
      if (typeof this.player[method] === 'function') return this.player[method]()
    }

    if (playerMethods.includes('play') && this.player.audio &&
      typeof this.player.audio.play === 'function') {
      return this.player.audio.play()
    }
    if (playerMethods.includes('pause') && this.player.audio &&
      typeof this.player.audio.pause === 'function') {
      return this.player.audio.pause()
    }
    return undefined
  }

  seekTo (seekTime, handler) {
    if (!Number.isFinite(seekTime)) return undefined
    if (typeof handler === 'function') return handler(seekTime)
    if (this.player && typeof this.player.seekTo === 'function') {
      return this.player.seekTo(seekTime)
    }
    if (this.player && this.player.audio) {
      this.player.audio.currentTime = seekTime
    }
    return undefined
  }

  seekBy (offset, handler) {
    const currentTime = this.player && this.player.audio
      ? this.player.audio.currentTime
      : this.player && this.player.currentTime
    if (!Number.isFinite(currentTime)) return undefined
    return this.seekTo(currentTime + offset, handler)
  }

  getSeekOffset (details) {
    return details && Number.isFinite(details.seekOffset)
      ? details.seekOffset
      : 10
  }

  getArtworkSource (track) {
    const artwork = track.artwork || track.coverArt || track.cover || track.image || track.thumbnail
    if (typeof artwork === 'string') return artwork
    if (Array.isArray(artwork)) {
      const item = artwork.find(entry => entry && typeof entry.src === 'string')
      if (item) return item.src
    }
    if (artwork && typeof artwork.src === 'string') return artwork.src
    if (track.identifier) {
      return `https://archive.org/services/img/${encodeURIComponent(track.identifier)}`
    }
    return ''
  }

  getArtworkType (source) {
    if (/\.png(?:$|[?#])/i.test(source)) return 'image/png'
    if (/\.webp(?:$|[?#])/i.test(source)) return 'image/webp'
    return 'image/jpeg'
  }
}

export default MediaSessionAdapter
