const CROSSFADE_DURATION = 0.1
const MINIMUM_GAIN = 0.001

export class CrossfadeController {
  constructor (context) {
    if (!context || typeof context.currentTime !== 'number') {
      throw new TypeError('An AudioContext is required')
    }

    this.context = context
  }

  crossfade (outgoingGain, incomingGain, outgoingSource) {
    if (!outgoingGain || !outgoingGain.gain ||
        !incomingGain || !incomingGain.gain ||
        !outgoingSource || typeof outgoingSource.stop !== 'function') {
      throw new TypeError('Outgoing and incoming GainNodes and the outgoing source are required')
    }

    const now = this.context.currentTime
    const endTime = now + CROSSFADE_DURATION

    outgoingGain.gain.setValueAtTime(1, now)
    outgoingGain.gain.linearRampToValueAtTime(MINIMUM_GAIN, endTime)
    incomingGain.gain.setValueAtTime(MINIMUM_GAIN, now)
    incomingGain.gain.linearRampToValueAtTime(1, endTime)

    let cleanedUp = false
    let onendedHandler = null
    const cleanup = () => {
      if (cleanedUp) return
      cleanedUp = true
      if (outgoingSource.onended === onendedHandler || outgoingSource.onended === cleanup) {
        outgoingSource.onended = null
      }
      if (typeof outgoingSource.removeEventListener === 'function') {
        outgoingSource.removeEventListener('ended', cleanup)
      }
      outgoingSource.disconnect()
      outgoingSource.buffer = null
      outgoingGain.disconnect()
    }

    if (typeof outgoingSource.addEventListener === 'function') {
      outgoingSource.addEventListener('ended', cleanup, { once: true })
    } else {
      const previousOnended = outgoingSource.onended
      onendedHandler = event => {
        cleanup()
        if (typeof previousOnended === 'function') previousOnended.call(outgoingSource, event)
      }
      outgoingSource.onended = onendedHandler
    }

    try {
      outgoingSource.stop(endTime)
    } catch (error) {
      cleanup()
      throw error
    }

    return endTime
  }
}

export default CrossfadeController
