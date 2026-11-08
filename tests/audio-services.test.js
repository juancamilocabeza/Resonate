import assert from 'node:assert/strict'
import { AudioNodeLifecycle } from '../src/services/AudioNodeLifecycle.js'
import { GaplessAudioScheduler } from '../src/services/GaplessAudioScheduler.js'
import { SmartPrefetchEngine } from '../src/services/SmartPrefetchEngine.js'

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

  cancelScheduledValues (time) {
    this.events.push({ type: 'cancel', time })
  }
}

class FakeSource {
  constructor (context) {
    this.context = context
    this.buffer = null
    this.onended = null
  }

  connect (node) {
    this.target = node
  }

  start (time, offset) {
    this.startedAt = time
    this.offset = offset
  }

  stop (time) {
    this.stoppedAt = time
  }

  disconnect () {
    this.disconnected = true
  }
}

function createContext () {
  return {
    currentTime: 0,
    state: 'running',
    destination: {},
    sources: [],
    gains: [],
    createBufferSource () {
      const source = new FakeSource(this)
      this.sources.push(source)
      return source
    },
    createGain () {
      const gain = {
        gain: new FakeAudioParam(),
        connect (target) { this.target = target },
        disconnect () { this.disconnected = true }
      }
      this.gains.push(gain)
      return gain
    },
    async resume () {
      this.state = 'running'
    }
  }
}

const schedulerContext = createContext()
const trackChanges = []
const scheduler = new GaplessAudioScheduler({
  context: schedulerContext,
  prefetchEngine: {
    loadTrack: async url => ({ url, duration: 100 }),
    prefetchTrack: async track => ({
      buffer: { url: track.url, duration: 60 },
      complete: true
    }),
    destroy () {}
  },
  requestAnimationFrame: null,
  document: null,
  onTrackChange: track => trackChanges.push(track.url)
})

await scheduler.play({ url: 'track-n', title: 'N' })
scheduler.setNextTrack({ url: 'track-n1', title: 'N+1' })
schedulerContext.currentTime = 79
assert.equal(scheduler.checkPrefetchThreshold(), false)
schedulerContext.currentTime = 80
assert.equal(scheduler.checkPrefetchThreshold(), true)
await scheduler.nextLoadPromise

const outgoing = schedulerContext.sources[0]
const incoming = schedulerContext.sources[1]
assert.equal(incoming.startedAt, 100)
assert.equal(outgoing.stoppedAt, 100)
outgoing.onended()
assert.equal(scheduler.current.track.url, 'track-n1')
assert.equal(schedulerContext.sources[0].buffer, null)
assert.deepEqual(trackChanges, ['track-n', 'track-n1'])
scheduler.destroy()

const clockContext = createContext()
clockContext.sampleRate = 48000
clockContext.createConstantSource = function () {
  const source = new FakeSource(this)
  this.sources.push(source)
  return source
}
let clockPrefetchCalls = 0
const clockScheduler = new GaplessAudioScheduler({
  context: clockContext,
  prefetchEngine: {
    loadTrack: async url => ({ url, duration: 100 }),
    prefetchTrack: async track => {
      clockPrefetchCalls += 1
      return { buffer: { url: track.url, duration: 50 } }
    },
    destroy () {}
  },
  requestAnimationFrame: null,
  document: null
})
await clockScheduler.play({ url: 'clock-n' })
clockScheduler.setNextTrack({ url: 'clock-n1' })
const prefetchClockSource = clockContext.sources[1]
assert.equal(prefetchClockSource.startedAt, 80)
assert.ok(Math.abs(prefetchClockSource.stoppedAt - (80 + 1 / 48000)) < 1e-9)
clockContext.currentTime = 80
prefetchClockSource.onended()
await clockScheduler.nextLoadPromise
assert.equal(clockPrefetchCalls, 1)
clockScheduler.destroy()

const manualContext = createContext()
const manualScheduler = new GaplessAudioScheduler({
  context: manualContext,
  prefetchEngine: {
    loadTrack: async url => ({ url, duration: 20 }),
    destroy () {}
  },
  requestAnimationFrame: null,
  document: null
})
await manualScheduler.play({ url: 'manual-n' })
manualContext.currentTime = 4
await manualScheduler.play({ url: 'manual-selection' }, { manual: true })
assert.equal(manualContext.sources[1].startedAt, 4)
assert.equal(manualContext.sources[0].stoppedAt, 4.1)
assert.equal(manualScheduler.current.track.url, 'manual-selection')
const outgoingValues = manualContext.gains[0].gain.events.filter(event => event.type === 'ramp')
const incomingValues = manualContext.gains[1].gain.events.filter(event => event.type === 'ramp')
assert.equal(outgoingValues.at(-1).value, 0)
assert.equal(incomingValues.at(-1).value, 1)
assert.equal(outgoingValues.at(-1).time, 4.1)
manualContext.currentTime = 4.05
assert.equal(manualScheduler.pause(), true)
assert.equal(await manualScheduler.resume(), true)
assert.ok(Math.abs(manualContext.sources.at(-1).offset - 0.05) < 1e-9)
manualScheduler.destroy()

const followingCacheRequests = []
const followingContext = createContext()
const followingScheduler = new GaplessAudioScheduler({
  context: followingContext,
  prefetchEngine: {
    loadTrack: async url => ({ url, duration: 20 }),
    prefetchTrack: async track => ({
      buffer: { url: track.url, duration: 20 },
      profile: { fast: true }
    }),
    getNetworkProfile: () => ({ fast: true }),
    cachePrefixes: async (queueUrl, searchUrl) => followingCacheRequests.push({ queueUrl, searchUrl }),
    destroy () {}
  },
  getNextTrack: async track => ({ url: `${track.url}-following` }),
  requestAnimationFrame: null,
  document: null
})
await followingScheduler.play({ url: 'queue-n' }, { nextTrack: { url: 'queue-n1' } })
followingContext.currentTime = 5
followingScheduler.checkPrefetchThreshold()
await followingScheduler.nextLoadPromise
await followingScheduler.followingLookupPromise
assert.deepEqual(followingCacheRequests, [{ queueUrl: null, searchUrl: 'queue-n1-following' }])
followingScheduler.destroy()

const fastMessages = []
const fastContext = createContext()
fastContext.decodeAudioData = async data => ({ decodedBytes: data.byteLength })
const fastEngine = new SmartPrefetchEngine({
  context: fastContext,
  connection: { effectiveType: '4g', saveData: false },
  serviceWorker: { controller: { postMessage: message => fastMessages.push(message) } },
  fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) })
})
const fastResult = await fastEngine.prefetchTrack(
  { url: 'https://audio.test/n1.mp3' },
  { url: 'https://audio.test/n2.mp3' }
)
assert.equal(fastResult.complete, true)
assert.equal(fastResult.buffer.decodedBytes, 16)
assert.equal(fastMessages[0].searchUrl, 'https://audio.test/n2.mp3')
fastEngine.destroy()

let requestedRange
let cancelled = false
let decodeCount = 0
const slowEngine = new SmartPrefetchEngine({
  context: { decodeAudioData: async () => { decodeCount += 1 } },
  connection: { effectiveType: '4g', saveData: true },
  serviceWorker: null,
  fetch: async (url, options) => {
    requestedRange = options.headers.Range
    return {
      ok: true,
      status: 206,
      body: {
        getReader: () => ({
          read: async () => ({ done: false, value: new Uint8Array(256 * 1024 + 128) }),
          cancel: async () => { cancelled = true },
          releaseLock () {}
        })
      }
    }
  }
})
const slowResult = await slowEngine.prefetchTrack({ url: 'https://audio.test/slow.mp3' })
assert.equal(slowResult.complete, false)
assert.equal(slowResult.buffer, null)
assert.equal(requestedRange, 'bytes=0-262143')
assert.equal(cancelled, true)
assert.equal(decodeCount, 0)
slowEngine.destroy()

const visibilityListeners = new Map()
const fakeDocument = {
  visibilityState: 'hidden',
  addEventListener: (type, listener) => visibilityListeners.set(type, listener),
  removeEventListener: (type, listener) => visibilityListeners.delete(type)
}
const lifecycleContext = createContext()
const lifecycle = new AudioNodeLifecycle({ document: fakeDocument })
const managed = lifecycle.createSource(
  { duration: 1 },
  Object.assign(lifecycleContext.destination, { context: lifecycleContext }),
  { start: false }
)
lifecycleContext.state = 'suspended'
lifecycleContext.sources[0].onended()
assert.equal(lifecycleContext.sources[0].buffer, null)
assert.equal(lifecycle.nodes.size, 0)
const resumedContext = createContext()
const resumedSource = new FakeSource(resumedContext)
const resumedGain = resumedContext.createGain()
lifecycle.register(resumedSource, resumedGain)
lifecycle.handleVisibilityChange()
await Promise.resolve()
assert.equal(resumedContext.state, 'running')
lifecycle.destroy()
assert.equal(visibilityListeners.has('visibilitychange'), false)

console.log('Audio services tests passed')
