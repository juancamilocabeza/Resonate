import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../js/adaptive-stream-controller.js', import.meta.url), 'utf8')
const listeners = new Map()
const connection = {
  effectiveType: '4g',
  type: 'cellular',
  downlink: 30,
  saveData: false,
  addEventListener (type, listener) {
    listeners.set(type, listener)
  },
  removeEventListener (type, listener) {
    if (listeners.get(type) === listener) listeners.delete(type)
  }
}
const events = []
const stateChanges = []
const context = vm.createContext({
  navigator: { connection },
  window: {
    state: { events: { emit: (name, detail) => events.push({ name, detail }) } }
  }
})
vm.runInContext(source, context)
const controller = new context.window.AdaptiveStreamController({
  connection,
  onStateChange: (next, previous) => stateChanges.push({ next, previous })
})

assert.equal(controller.state.codec, 'opus')
assert.equal(controller.state.bitrate, 128)
assert.equal(controller.state.prefetchSeconds, 30)
assert.equal(events[0].name, 'network:state')

connection.downlink = 8

const variants = {
  url: 'current.mp3',
  format: 'MP3',
  sources: [
    { url: 'standard.opus', format: 'Opus', bitrate: 128 },
    { url: 'high.opus', codec: 'opus', bitrate: 256 },
    { url: 'economy.mp3', format: 'MP3', bitrate: 96 }
  ]
}
assert.equal(controller.selectSource(variants).url, 'standard.opus')

connection.effectiveType = '3g'
listeners.get('change')()
assert.equal(controller.state.codec, 'mp3')
assert.equal(controller.state.bitrate, 96)
assert.equal(controller.state.prefetchSeconds, 5)
assert.equal(controller.selectSource(variants).url, 'economy.mp3')
assert.equal(stateChanges.length, 2)
assert.equal(stateChanges[1].previous.effectiveType, '4g')

connection.effectiveType = '4g'
connection.saveData = true
listeners.get('change')()
assert.equal(controller.state.saveData, true)
assert.equal(controller.state.codec, 'mp3')
assert.equal(events.at(-1).name, 'stream:quality-change')

connection.saveData = false
connection.type = 'wifi'
connection.downlink = 30
listeners.get('change')()
assert.equal(controller.state.bitrate, 256)
assert.equal(controller.state.prefetchSeconds, 60)
assert.equal(controller.selectSource(variants).url, 'high.opus')
assert.equal(controller.selectSource({ url: 'only-ogg.ogg', sources: [] }).url, 'only-ogg.ogg')

controller.destroy()
assert.equal(listeners.has('change'), false)

console.log('Adaptive stream controller tests passed')
