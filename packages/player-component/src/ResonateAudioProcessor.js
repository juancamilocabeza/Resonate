const DEFAULT_CHANNEL_COUNT = 2
const DEFAULT_BUFFER_SIZE = 16384
const MAX_CHANNEL_COUNT = 32

export class ResonateAudioProcessor extends AudioWorkletProcessor {
  constructor (options) {
    super()

    const processorOptions = options.processorOptions || {}
    const channelCount = processorOptions.channelCount
    const bufferSize = processorOptions.bufferSize

    this.channelCount = Number.isInteger(channelCount) && channelCount > 0 && channelCount <= MAX_CHANNEL_COUNT
      ? channelCount
      : DEFAULT_CHANNEL_COUNT
    this.bufferCapacity = Number.isInteger(bufferSize) && bufferSize >= 128
      ? bufferSize
      : DEFAULT_BUFFER_SIZE
    this.buffer = new Float32Array(this.bufferCapacity * this.channelCount)
    this.readFrame = 0
    this.writeFrame = 0
    this.availableFrames = 0
    this.gain = 1
    this.playing = false

    this.port.onmessage = event => this.handleMessage(event.data)
  }

  handleMessage (message) {
    if (message instanceof Float32Array) {
      this.enqueue(message)
      return
    }

    if (!message || typeof message !== 'object') {
      this.port.postMessage({ type: 'error', message: 'Expected audio data or a control command' })
      return
    }

    if (message.type === 'audio' && message.data instanceof Float32Array) {
      this.enqueue(message.data)
    } else if (message.type === 'play') {
      this.playing = true
    } else if (message.type === 'pause') {
      this.playing = false
    } else if (message.type === 'setGain') {
      if (typeof message.gain !== 'number' || !Number.isFinite(message.gain) || message.gain < 0) {
        this.port.postMessage({ type: 'error', message: 'Gain must be a finite, non-negative number' })
        return
      }

      this.gain = message.gain
    } else {
      this.port.postMessage({ type: 'error', message: 'Unknown audio processor message' })
    }
  }

  enqueue (audioData) {
    if (audioData.length % this.channelCount !== 0) {
      this.port.postMessage({
        type: 'error',
        message: `Audio data must contain complete ${this.channelCount}-channel frames`
      })
      return
    }

    const frameCount = Math.floor(audioData.length / this.channelCount)
    const framesToWrite = Math.min(frameCount, this.bufferCapacity - this.availableFrames)

    for (let frame = 0; frame < framesToWrite; frame += 1) {
      const sourceOffset = frame * this.channelCount
      const destinationOffset = this.writeFrame * this.channelCount

      for (let channel = 0; channel < this.channelCount; channel += 1) {
        this.buffer[destinationOffset + channel] = audioData[sourceOffset + channel]
      }

      this.writeFrame = (this.writeFrame + 1) % this.bufferCapacity
    }

    this.availableFrames += framesToWrite

    if (framesToWrite < frameCount) {
      this.port.postMessage({
        type: 'overflow',
        droppedFrames: frameCount - framesToWrite
      })
    }
  }

  process (inputs, outputs) {
    const output = outputs[0]
    if (!output || output.length === 0) return true

    const frameCount = output[0].length

    for (let frame = 0; frame < frameCount; frame += 1) {
      if (this.playing && this.availableFrames > 0) {
        const sourceOffset = this.readFrame * this.channelCount

        for (let channel = 0; channel < output.length; channel += 1) {
          const sourceChannel = Math.min(channel, this.channelCount - 1)
          output[channel][frame] = this.buffer[sourceOffset + sourceChannel] * this.gain
        }

        this.readFrame = (this.readFrame + 1) % this.bufferCapacity
        this.availableFrames -= 1
      } else {
        for (let channel = 0; channel < output.length; channel += 1) {
          output[channel][frame] = 0
        }
      }
    }

    return true
  }
}

registerProcessor('ResonateAudioProcessor', ResonateAudioProcessor)
