(function (root) {
  'use strict'

  const PROFILES = {
    broadband: { codec: 'opus', bitrate: 256, prefetchSeconds: 60, label: 'Alta calidad' },
    fourG: { codec: 'opus', bitrate: 128, prefetchSeconds: 30, label: 'Calidad estándar' },
    lowBandwidth: { codec: 'mp3', bitrate: 96, prefetchSeconds: 5, label: 'Ahorro de datos' }
  }

  function sourceCodec (source) {
    const description = `${source.codec || ''} ${source.format || ''}`.toLowerCase()
    if (description.includes('opus')) return 'opus'
    if (description.includes('mp3')) return 'mp3'
    if (/\.opus(?:$|[?#])/i.test(source.url)) return 'opus'
    if (/\.mp3(?:$|[?#])/i.test(source.url)) return 'mp3'
    return null
  }

  class AdaptiveStreamController {
    constructor (options = {}) {
      this.connection = options.connection || (
        typeof navigator !== 'undefined'
          ? navigator.connection || navigator.mozConnection || navigator.webkitConnection || null
          : null
      )
      this.bus = options.bus || (root.state && root.state.events) || null
      this.onStateChange = options.onStateChange || null
      this.state = this.getNetworkState()
      this.handleChange = () => this.update()

      if (this.connection && typeof this.connection.addEventListener === 'function') {
        this.connection.addEventListener('change', this.handleChange)
      }

      this.emitState(null)
    }

    getNetworkState () {
      const effectiveType = this.connection && this.connection.effectiveType
        ? String(this.connection.effectiveType).toLowerCase()
        : ''
      const connectionType = this.connection && this.connection.type
        ? String(this.connection.type).toLowerCase()
        : ''
      const downlink = this.connection && Number.isFinite(this.connection.downlink)
        ? this.connection.downlink
        : 0
      const saveData = Boolean(this.connection && this.connection.saveData)

      let profile
      if (saveData || effectiveType === '2g' || effectiveType === 'slow-2g' ||
        effectiveType === '3g' || (connectionType === 'cellular' && effectiveType !== '4g')) {
        profile = PROFILES.lowBandwidth
      } else if ((connectionType === 'wifi' || connectionType === 'ethernet' ||
        effectiveType === '5g' || downlink >= 20) &&
        !(connectionType === 'cellular' && effectiveType === '4g')) {
        profile = PROFILES.broadband
      } else {
        profile = PROFILES.fourG
      }

      return {
        effectiveType: effectiveType || 'unknown',
        connectionType: connectionType || 'unknown',
        downlink,
        saveData,
        codec: profile.codec,
        bitrate: profile.bitrate,
        prefetchSeconds: profile.prefetchSeconds,
        quality: profile.label
      }
    }

    emitState (previous) {
      const detail = { ...this.state, previous }
      if (this.bus && typeof this.bus.emit === 'function') {
        this.bus.emit('network:state', detail)
        this.bus.emit('stream:quality-change', detail)
      }
      if (typeof root.dispatchEvent === 'function' && typeof root.CustomEvent === 'function') {
        root.dispatchEvent(new root.CustomEvent('resonate:network-state', { detail }))
      }
      if (typeof this.onStateChange === 'function') this.onStateChange(this.state, previous)
    }

    update () {
      const next = this.getNetworkState()
      const previous = this.state
      if (Object.keys(next).every(key => next[key] === previous[key])) return false
      this.state = next
      this.emitState(previous)
      return true
    }

    selectSource (track) {
      if (!track || typeof track !== 'object') return track
      const sources = Array.isArray(track.sources) ? track.sources : []
      const candidates = sources.filter(source =>
        source && typeof source.url === 'string' && sourceCodec(source) === this.state.codec
      )
      if (!candidates.length) return track

      const ratedCandidates = candidates.filter(source => Number.isFinite(Number(source.bitrate)) && Number(source.bitrate) > 0)
      const selected = ratedCandidates.length
        ? ratedCandidates.reduce((best, source) =>
          Math.abs(Number(source.bitrate) - this.state.bitrate) < Math.abs(Number(best.bitrate) - this.state.bitrate)
            ? source
            : best
        )
        : candidates[0]
      return { ...track, ...selected }
    }

    destroy () {
      if (this.connection && typeof this.connection.removeEventListener === 'function') {
        this.connection.removeEventListener('change', this.handleChange)
      }
      this.onStateChange = null
      this.bus = null
    }
  }

  root.AdaptiveStreamController = AdaptiveStreamController
})(typeof window !== 'undefined' ? window : globalThis)
