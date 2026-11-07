export class AudioVisualizer {
  constructor (audio, canvas, shouldRender = () => true) {
    this.audio = audio
    this.canvas = canvas
    this.shouldRender = shouldRender
    this.context = null
    this.source = null
    this.analyser = null
    this.frame = null
    this.data = null
    this.resizeObserver = null
    this.warned = false
    this.barColor = '#83c8b2'
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this)
    this.handlePlayback = this.handlePlayback.bind(this)
    this.handlePause = this.stop.bind(this)
    this.handleResize = this.resizeCanvas.bind(this)
    this.handleAmbientColors = event => {
      if (event.detail && event.detail.secondary) this.barColor = event.detail.secondary
    }
  }

  attach () {
    if (!this.audio || !this.canvas) return false
    if (this.source) return true
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext
    if (!AudioContextConstructor) return this.disable('Web Audio is not supported')

    try {
      const sourceUrl = this.audio.currentSrc || this.audio.src
      const sourceOrigin = sourceUrl ? new URL(sourceUrl, window.location.href).origin : window.location.origin
      if (sourceOrigin !== window.location.origin && this.audio.crossOrigin !== 'anonymous') {
        return this.disable('Cross-origin audio is not configured for analysis')
      }

      this.context = new AudioContextConstructor()
      this.analyser = this.context.createAnalyser()
      this.analyser.fftSize = 128
      this.analyser.smoothingTimeConstant = 0.82
      this.data = new Uint8Array(this.analyser.frequencyBinCount)
      this.source = this.context.createMediaElementSource(this.audio)
      this.source.connect(this.analyser)
      this.analyser.connect(this.context.destination)
      this.canvas.hidden = false
      this.observeCanvasSize()
      document.addEventListener('visibilitychange', this.handleVisibilityChange)
      window.addEventListener('resonate:ambient-colors', this.handleAmbientColors)
      this.audio.addEventListener('play', this.handlePlayback)
      this.audio.addEventListener('pause', this.handlePause)
      this.audio.addEventListener('ended', this.handlePause)
      if (!this.audio.paused) this.handlePlayback()
      return true
    } catch (error) {
      this.disable(`Could not initialize the audio visualizer: ${error.message}`)
      return false
    }
  }

  activate () {
    if (!this.attach()) return false
    if (this.context.state === 'suspended') {
      this.context.resume().catch(error => this.disable(`Could not resume audio analysis: ${error.message}`))
    }
    if (!this.audio.paused) this.start()
    return true
  }

  observeCanvasSize () {
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => this.resizeCanvas())
      this.resizeObserver.observe(this.canvas)
    } else {
      window.addEventListener('resize', this.handleResize)
    }
    this.resizeCanvas()
  }

  resizeCanvas () {
    if (!this.canvas) return
    const bounds = this.canvas.getBoundingClientRect()
    if (!bounds.width || !bounds.height) return
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    this.canvas.width = Math.round(bounds.width * ratio)
    this.canvas.height = Math.round(bounds.height * ratio)
  }

  handlePlayback () {
    if (this.context && this.context.state === 'suspended') {
      this.context.resume().catch(error => this.disable(`Could not resume audio analysis: ${error.message}`))
    }
    this.start()
  }

  handleVisibilityChange () {
    if (document.visibilityState === 'hidden') {
      this.stop()
    } else if (!this.audio.paused) {
      this.start()
    }
  }

  start () {
    if (!this.analyser || !this.shouldRender() ||
      this.frame !== null || document.visibilityState === 'hidden') return
    this.frame = window.requestAnimationFrame(() => this.draw())
  }

  stop () {
    if (this.frame !== null) {
      window.cancelAnimationFrame(this.frame)
      this.frame = null
    }
  }

  draw () {
    this.frame = null
    if (!this.analyser || !this.canvas || document.visibilityState === 'hidden') return
    const bounds = this.canvas.getBoundingClientRect()
    if (!bounds.width || !bounds.height) return

    this.analyser.getByteFrequencyData(this.data)
    const context = this.canvas.getContext('2d')
    if (!context) return
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    const width = this.canvas.width
    const height = this.canvas.height
    const barCount = Math.min(42, this.data.length)
    const gap = Math.max(2, width / 100)
    const barWidth = (width - gap * (barCount - 1)) / barCount

    context.clearRect(0, 0, width, height)
    context.fillStyle = this.barColor
    for (let index = 0; index < barCount; index++) {
      const value = this.data[index]
      const barHeight = Math.max(2 * ratio, (value / 255) * height)
      const x = index * (barWidth + gap)
      const y = (height - barHeight) / 2
      context.globalAlpha = 0.48 + (value / 255) * 0.52
      if (typeof context.roundRect === 'function') {
        context.beginPath()
        context.roundRect(x, y, barWidth, barHeight, barWidth / 2)
        context.fill()
      } else {
        context.fillRect(x, y, barWidth, barHeight)
      }
    }
    context.globalAlpha = 1

    if (!this.audio.paused) this.frame = window.requestAnimationFrame(() => this.draw())
  }

  disable (message) {
    this.stop()
    if (this.canvas) this.canvas.hidden = true
    if (!this.warned && window.logger && typeof window.logger.warn === 'function') {
      window.logger.warn(message, 'PLAYER')
      this.warned = true
    }
    return false
  }

  destroy () {
    this.stop()
    document.removeEventListener('visibilitychange', this.handleVisibilityChange)
    window.removeEventListener('resonate:ambient-colors', this.handleAmbientColors)
    window.removeEventListener('resize', this.handleResize)
    this.audio?.removeEventListener('play', this.handlePlayback)
    this.audio?.removeEventListener('pause', this.handlePause)
    this.audio?.removeEventListener('ended', this.handlePause)
    this.resizeObserver?.disconnect()
    if (this.context && this.context.state !== 'closed') {
      this.context.close().catch(error => {
        if (window.logger && typeof window.logger.warn === 'function') {
          window.logger.warn(`Could not close audio visualizer: ${error.message}`, 'PLAYER')
        }
      })
    }
  }
}

if (typeof window !== 'undefined') window.AudioVisualizer = AudioVisualizer
