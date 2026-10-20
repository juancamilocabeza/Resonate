export class AudioMasterChain {
  constructor (audioContext) {
    if (!audioContext || typeof audioContext.createGain !== 'function' ||
      typeof audioContext.createDynamicsCompressor !== 'function') {
      throw new TypeError('AudioMasterChain requires an AudioContext with Web Audio support')
    }

    this.audioContext = audioContext
    this.gainNode = audioContext.createGain()
    this.compressorNode = audioContext.createDynamicsCompressor()
    this.compressionEnabled = true

    this.compressorNode.threshold.value = -24
    this.compressorNode.knee.value = 30
    this.compressorNode.ratio.value = 12
    this.compressorNode.attack.value = 0.003
    this.compressorNode.release.value = 0.25

    this.gainNode.connect(this.compressorNode)
    this.compressorNode.connect(audioContext.destination)
  }

  setLogarithmicVolume (sliderValue) {
    const value = Number(sliderValue)
    if (!Number.isFinite(value)) {
      throw new TypeError('Volume must be a finite number between 0 and 1')
    }

    const normalizedValue = Math.max(0, Math.min(1, value))
    const outputValue = Math.pow(normalizedValue, 2)
    this.gainNode.gain.setTargetAtTime(outputValue, this.audioContext.currentTime, 0.01)
    return outputValue
  }

  setCompressionEnabled (enabled) {
    const shouldEnable = Boolean(enabled)
    if (shouldEnable === this.compressionEnabled) return this.compressionEnabled

    const destination = this.audioContext.destination
    if (shouldEnable) {
      this.gainNode.disconnect(destination)
      this.compressorNode.connect(destination)
    } else {
      this.compressorNode.disconnect(destination)
      this.gainNode.connect(destination)
    }

    this.compressionEnabled = shouldEnable
    return this.compressionEnabled
  }

  toggleCompression () {
    return this.setCompressionEnabled(!this.compressionEnabled)
  }
}

export default AudioMasterChain
