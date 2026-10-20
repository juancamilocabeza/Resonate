import assert from 'node:assert/strict'
import { CrossfadeController } from '../packages/player-component/src/CrossfadeController.js'

class FakeAudioParam {
  constructor () {
    this.events = []
  }

  setValueAtTime (value, time) {
    this.events.push({ type: 'set', value, time })
  }

  linearRampToValueAtTime (value, time) {
    this.events.push({ type: 'ramp', value, time })
  }
}

class FakeGain {
  constructor () {
    this.gain = new FakeAudioParam()
    this.disconnected = false
  }

  disconnect () {
    this.disconnected = true
  }
}

class FakeSource {
  constructor () {
    this.buffer = { id: 'outgoing' }
    this.listeners = new Map()
    this.disconnected = false
  }

  addEventListener (type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type).add(listener)
  }

  removeEventListener (type, listener) {
    const listeners = this.listeners.get(type)
    if (listeners) listeners.delete(listener)
  }

  stop (time) {
    this.stoppedAt = time
  }

  disconnect () {
    this.disconnected = true
  }

  end () {
    for (const listener of this.listeners.get('ended')) listener()
  }
}

const context = { currentTime: 42.25 }
const outgoingGain = new FakeGain()
const incomingGain = new FakeGain()
const outgoingSource = new FakeSource()
let existingEndedCalls = 0
outgoingSource.addEventListener('ended', () => { existingEndedCalls += 1 })

const controller = new CrossfadeController(context)
const endTime = controller.crossfade(outgoingGain, incomingGain, outgoingSource)

assert.equal(endTime, 42.35)
assert.deepEqual(outgoingGain.gain.events, [
  { type: 'set', value: 1, time: 42.25 },
  { type: 'ramp', value: 0.001, time: 42.35 }
])
assert.deepEqual(incomingGain.gain.events, [
  { type: 'set', value: 0.001, time: 42.25 },
  { type: 'ramp', value: 1, time: 42.35 }
])
assert.equal(outgoingSource.stoppedAt, 42.35)
assert.equal(outgoingSource.disconnected, false)

outgoingSource.end()
assert.equal(outgoingSource.disconnected, true)
assert.equal(outgoingSource.buffer, null)
assert.equal(outgoingGain.disconnected, true)
assert.equal(existingEndedCalls, 1)

assert.throws(() => controller.crossfade(null, incomingGain, outgoingSource), TypeError)

const fallbackSource = {
  onended: () => { existingEndedCalls += 1 },
  stop (time) { this.stoppedAt = time },
  disconnect () { this.disconnected = true }
}
const fallbackGain = new FakeGain()
controller.crossfade(fallbackGain, incomingGain, fallbackSource)
fallbackSource.onended()
assert.equal(fallbackSource.onended, null)
assert.equal(fallbackSource.disconnected, true)
assert.equal(fallbackGain.disconnected, true)
assert.equal(existingEndedCalls, 2)

console.log('Crossfade controller tests passed')
