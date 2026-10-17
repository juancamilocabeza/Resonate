import assert from 'node:assert/strict'

const offlineContexts = []

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
    this.connections = []
  }

  connect (target) {
    this.connections.push(target)
  }

  disconnect () {
    this.disconnected = true
  }
}

class FakeSource {
  constructor () {
    this.gain = null
    this.buffer = null
    this.onended = null
    this.startTime = null
    this.stoppedAt = null
    this.disconnected = false
  }

  connect (node) {
    this.gain = node
  }

  start (time = 0) {
    this.startTime = time
  }

  stop (time) {
    this.stoppedAt = time
  }

  disconnect () {
    this.disconnected = true
  }
}

class FakeOfflineAudioContext {
  constructor (...args) {
    this.args = args
    offlineContexts.push(this)
  }

  async decodeAudioData (data) {
    return data
  }
}

globalThis.OfflineAudioContext = FakeOfflineAudioContext

function createContext () {
  const context = {
    currentTime: 0,
    sampleRate: 48000,
    destination: {},
    sources: [],
    gains: [],
    state: 'running',
    createBufferSource () {
      const source = new FakeSource()
      this.sources.push(source)
      return source
    },
    createGain () {
      const gain = new FakeGain()
      this.gains.push(gain)
      return gain
    },
    async close () {
      this.state = 'closed'
    }
  }

  return context
}

const requests = []
const { GaplessBufferManager } = await import('../packages/player-component/src/GaplessBufferManager.js')
const managerContext = createContext()
const manager = new GaplessBufferManager('current.mp3', 'next.mp3', {
  context: managerContext,
  fetch: async url => {
    requests.push(url)
    return { ok: true, arrayBuffer: async () => ({ url, duration: 10 }) }
  }
})
await manager.prepareNext('next.mp3')
managerContext.currentTime = 2
await manager.playCurrent()

assert.deepEqual(requests.sort(), ['current.mp3', 'next.mp3'])
assert.equal(offlineContexts.length, 2)
assert.deepEqual(offlineContexts[0].args, [2, 240000, 48000])
assert.equal(managerContext.sources.length, 2)
const currentSource = managerContext.sources[0]
const nextSource = managerContext.sources[1]
assert.equal(currentSource.startTime, 2)
assert.equal(nextSource.startTime, 11.5)
assert.equal(currentSource.stoppedAt, 12)
assert.deepEqual(managerContext.gains[0].gain.events.at(-1), { type: 'ramp', value: 0, time: 12 })
assert.deepEqual(managerContext.gains[1].gain.events.at(-1), { type: 'ramp', value: 1, time: 12 })

currentSource.onended()
assert.equal(manager.currentTrackUrl, 'next.mp3')
assert.equal(manager.currentSource, nextSource)
assert.equal(currentSource.disconnected, true)
assert.equal(managerContext.gains[0].disconnected, true)
assert.equal(nextSource.onended, null)
assert.equal(manager.currentBuffer.duration, 10)

const failedContext = createContext()
const errors = []
const failedManager = new GaplessBufferManager('playing.mp3', null, {
  context: failedContext,
  fetch: async url => {
    if (url === 'offline-next.mp3') throw new Error('network unavailable')
    return { ok: true, arrayBuffer: async () => ({ duration: 10 }) }
  },
  onError: error => errors.push(error.message)
})
await failedManager.playCurrent()
const playingSource = failedManager.currentSource
assert.equal(await failedManager.prepareNext('offline-next.mp3'), null)
assert.deepEqual(errors, ['network unavailable'])
assert.equal(failedManager.transitionToNext(), false)
assert.equal(playingSource.stoppedAt, null)

const lateContext = createContext()
let releasePrefetch
const delayedResponse = new Promise(resolve => { releasePrefetch = resolve })
const lateManager = new GaplessBufferManager('late-current.mp3', null, {
  context: lateContext,
  fetch: async url => {
    if (url === 'late-next.mp3') return delayedResponse
    return { ok: true, arrayBuffer: async () => ({ duration: 8 }) }
  }
})
await lateManager.playCurrent()
const latePrefetch = lateManager.prepareNext('late-next.mp3')
releasePrefetch({ ok: true, arrayBuffer: async () => ({ duration: 8 }) })
await latePrefetch
assert.equal(lateContext.sources.length, 2)
assert.equal(lateContext.sources[1].startTime, 7.5)
assert.equal(lateContext.sources[0].stoppedAt, 8)

await manager.destroy()
await failedManager.destroy()
await lateManager.destroy()
assert.equal(managerContext.state, 'running')
assert.equal(failedContext.state, 'running')
assert.equal(nextSource.disconnected, true)

console.log('Gapless buffer manager tests passed')
