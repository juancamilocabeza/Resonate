const DEFAULT_CHANNEL_COUNT = 2
const DEFAULT_BUFFER_SIZE = 16384
const MAX_CHANNEL_COUNT = 32

export class ResonateAudioNode extends AudioWorkletNode {
  constructor (context, options = {}) {
    const channelCount = options.channelCount === undefined ? DEFAULT_CHANNEL_COUNT : options.channelCount
    const bufferSize = options.bufferSize === undefined ? DEFAULT_BUFFER_SIZE : options.bufferSize

    if (!Number.isInteger(channelCount) || channelCount < 1 || channelCount > MAX_CHANNEL_COUNT) {
      throw new RangeError(`channelCount must be an integer between 1 and ${MAX_CHANNEL_COUNT}`)
    }
    if (!Number.isInteger(bufferSize) || bufferSize < 128) {
      throw new RangeError('bufferSize must be an integer of at least 128 frames')
    }

    super(context, 'ResonateAudioProcessor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [channelCount],
      channelCount,
      channelCountMode: 'explicit',
      processorOptions: { channelCount, bufferSize }
    })

    this.channelCount = channelCount
  }

  static async create (context, workletUrl, options) {
    if (!context || !context.audioWorklet || typeof context.audioWorklet.addModule !== 'function') {
      throw new Error('The provided AudioContext does not support AudioWorklet')
    }
    if (typeof workletUrl !== 'string' || workletUrl.length === 0) {
      throw new TypeError('A worklet module URL is required')
    }

    await context.audioWorklet.addModule(workletUrl)
    return new ResonateAudioNode(context, options)
  }

  enqueueAudio (audioData) {
    if (!(audioData instanceof Float32Array)) {
      throw new TypeError('Audio data must be a Float32Array')
    }
    if (audioData.length % this.channelCount !== 0) {
      throw new RangeError(`Audio data must contain complete ${this.channelCount}-channel frames`)
    }

    this.port.postMessage({ type: 'audio', data: audioData })
    return this
  }

  play () {
    this.port.postMessage({ type: 'play' })
    return this
  }

  pause () {
    this.port.postMessage({ type: 'pause' })
    return this
  }

  setGain (gain) {
    if (typeof gain !== 'number' || !Number.isFinite(gain) || gain < 0) {
      throw new RangeError('Gain must be a finite, non-negative number')
    }

    this.port.postMessage({ type: 'setGain', gain })
    return this
  }
}
