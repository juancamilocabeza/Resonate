import assert from 'node:assert/strict'
import { ColorExtractor } from '../js/ColorExtractor.js'
import { reorderQueue } from '../js/QueueList.js'
import { AudioVisualizer } from '../js/AudioVisualizer.js'

const pixels = new Uint8ClampedArray([
  ...Array(24).fill([238, 42, 66, 255]).flat(),
  ...Array(8).fill([38, 142, 172, 255]).flat()
])
const colors = ColorExtractor.extractFromPixels(pixels)
const foreground = { r: 240, g: 242, b: 245 }
const toRgb = hex => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16)
})

assert.ok(colors.primary.startsWith('#'))
assert.ok(colors.secondary.startsWith('#'))
assert.ok(ColorExtractor.contrastRatio(foreground, toRgb(colors.primary)) >= 4.5)
assert.ok(ColorExtractor.contrastRatio(foreground, toRgb(colors.secondary)) >= 4.5)
assert.deepEqual(await ColorExtractor.extract(''), ColorExtractor.getFallbackColors())

const currentTrack = { title: 'Currently playing' }
const first = { title: 'First upcoming' }
const second = { title: 'Second upcoming' }
const third = { title: 'Third upcoming' }
const queue = [first, second, third]

assert.equal(reorderQueue(queue, 0, 2), first)
assert.deepEqual(queue, [second, third, first])
assert.equal(currentTrack.title, 'Currently playing')
assert.equal(reorderQueue(queue, -1, 0), null)
assert.deepEqual(queue, [second, third, first])

const previousWindow = globalThis.window
const previousDocument = globalThis.document
const scheduledFrames = new Map()
const cancelledFrames = []
const documentListeners = new Map()
const audioListeners = new Map()
const audioConnections = []
let nextFrameId = 0
let pageVisibility = 'visible'
let playerVisible = true
const audioContext = {
  state: 'suspended',
  destination: {},
  createAnalyser: () => ({
    fftSize: 0,
    smoothingTimeConstant: 0,
    frequencyBinCount: 64,
    connect: destination => audioConnections.push(['analyser', destination]),
    getByteFrequencyData: () => {}
  }),
  createMediaElementSource: () => ({
    connect: destination => audioConnections.push(['source', destination])
  }),
  resume: async function () {
    this.state = 'running'
  },
  close: async function () {
    this.state = 'closed'
  }
}
globalThis.window = {
  AudioContext: function () { return audioContext },
  location: { href: 'https://resonate.example/', origin: 'https://resonate.example' },
  devicePixelRatio: 1,
  addEventListener: () => {},
  removeEventListener: () => {},
  requestAnimationFrame: callback => {
    const id = ++nextFrameId
    scheduledFrames.set(id, callback)
    return id
  },
  cancelAnimationFrame: id => {
    cancelledFrames.push(id)
    scheduledFrames.delete(id)
  }
}
globalThis.document = {
  get visibilityState () { return pageVisibility },
  addEventListener: (type, listener) => documentListeners.set(type, listener),
  removeEventListener: type => documentListeners.delete(type)
}
const fakeAudio = {
  currentSrc: 'https://archive.org/download/item/audio.mp3',
  crossOrigin: 'anonymous',
  paused: true,
  addEventListener: (type, listener) => audioListeners.set(type, listener),
  removeEventListener: type => audioListeners.delete(type)
}
const fakeCanvas = {
  hidden: true,
  getBoundingClientRect: () => ({ width: 120, height: 24 })
}
const visualizer = new AudioVisualizer(fakeAudio, fakeCanvas, () => playerVisible)

assert.equal(visualizer.attach(), true)
assert.equal(fakeCanvas.hidden, false)
assert.equal(audioConnections.some(([source]) => source === 'source'), true)
assert.equal(audioConnections.some(([source]) => source === 'analyser'), true)
fakeAudio.paused = false
audioListeners.get('play')()
assert.equal(scheduledFrames.size, 1)
pageVisibility = 'hidden'
documentListeners.get('visibilitychange')()
assert.equal(scheduledFrames.size, 0)
assert.equal(cancelledFrames.length, 1)
pageVisibility = 'visible'
documentListeners.get('visibilitychange')()
assert.equal(scheduledFrames.size, 1)
playerVisible = false
visualizer.stop()
audioListeners.get('play')()
assert.equal(scheduledFrames.size, 0)
await visualizer.destroy()
globalThis.window = previousWindow
globalThis.document = previousDocument

console.log('Player experience service tests passed')
