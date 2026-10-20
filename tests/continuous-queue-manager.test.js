import assert from 'node:assert/strict'
import { ContinuousQueueManager } from '../packages/player-component/src/ContinuousQueueManager.js'

class FakeSource {
  constructor () {
    this.buffer = null
    this.onended = null
    this.startTimes = []
  }

  connect (destination) {
    this.destination = destination
  }

  start (time) {
    this.startTimes.push(time)
  }

  stop () {
    this.stopped = true
  }

  disconnect () {
    this.disconnected = true
  }
}

function createContext () {
  return {
    currentTime: 0,
    destination: {},
    sources: [],
    async decodeAudioData(data) {
      return data
    },
    createBufferSource () {
      const source = new FakeSource()
      this.sources.push(source)
      return source
    }
  }
}

const context = createContext()
const released = []
const requested = []
const tracks = new Map([
  ['track-n', { id: 'N' }],
  ['track-n1', { id: 'N+1' }],
  ['track-n2', { id: 'N+2' }]
])
const manager = new ContinuousQueueManager({
  context,
  fetch: async url => {
    requested.push(url)
    return { ok: true, arrayBuffer: async () => tracks.get(url) }
  },
  onBufferReleased: (buffer, url) => released.push({ buffer, url }),
  getNextTrackUrl: url => url === 'track-n1' ? 'track-n2' : null
})

await manager.playTrack('track-n')
assert.equal(manager.currentBuffer.id, 'N')
assert.equal(context.sources[0].startTimes[0], 0)
await manager.prefetchNextTrack('track-n1')
assert.equal(manager.nextBuffer.id, 'N+1')

context.currentTime = 12.5
context.sources[0].onended()
assert.equal(context.sources[0].buffer, null)
assert.equal(context.sources[0].disconnected, true)
assert.equal(manager.currentBuffer.id, 'N+1')
assert.equal(manager.nextBuffer, null)
assert.equal(manager.currentTrackUrl, 'track-n1')
assert.equal(context.sources[1].startTimes[0], 12.5)
assert.deepEqual(released[0], { buffer: tracks.get('track-n'), url: 'track-n' })

await new Promise(resolve => setImmediate(resolve))
assert.deepEqual(requested, ['track-n', 'track-n1', 'track-n2'])
assert.equal(manager.nextBuffer.id, 'N+2')

await manager.destroy()
assert.equal(manager.currentBuffer, null)
assert.equal(manager.nextBuffer, null)
assert.equal(manager.currentSource, null)
assert.equal(released.some(item => item.buffer.id === 'N+1'), true)
assert.equal(released.some(item => item.buffer.id === 'N+2'), true)

console.log('Continuous queue manager tests passed')
