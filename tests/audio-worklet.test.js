import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const processorUrl = pathToFileURL(new URL('../packages/player-component/src/ResonateAudioProcessor.js', import.meta.url).pathname)
const processorRegistry = new Map()

class MockAudioWorkletProcessor {
  constructor () {
    this.port = {
      onmessage: null,
      messages: [],
      postMessage (message) {
        this.messages.push(message)
      }
    }
  }
}

globalThis.AudioWorkletProcessor = MockAudioWorkletProcessor
globalThis.registerProcessor = (name, processor) => processorRegistry.set(name, processor)
await import(processorUrl.href)

const Processor = processorRegistry.get('ResonateAudioProcessor')

function makeOutput (channels, frames) {
  return Array.from({ length: channels }, () => new Float32Array(frames))
}

function send (processor, data) {
  processor.port.onmessage({ data })
}

function render (processor, output) {
  assert.equal(processor.process([], [output]), true)
  return output
}

const processor = new Processor({ processorOptions: { channelCount: 1, bufferSize: 128 } })
const initialOutput = render(processor, makeOutput(1, 4))
assert.deepEqual(Array.from(initialOutput[0]), [0, 0, 0, 0])

send(processor, { type: 'audio', data: new Float32Array([1, 2, 3]) })
send(processor, { type: 'setGain', gain: 0.5 })
send(processor, { type: 'play' })
const gainedOutput = render(processor, makeOutput(1, 4))
assert.deepEqual(Array.from(gainedOutput[0]), [0.5, 1, 1.5, 0])

send(processor, { type: 'audio', data: new Float32Array([4, 5]) })
send(processor, { type: 'pause' })
const pausedOutput = render(processor, makeOutput(1, 2))
assert.deepEqual(Array.from(pausedOutput[0]), [0, 0])
send(processor, { type: 'play' })
const resumedOutput = render(processor, makeOutput(1, 2))
assert.deepEqual(Array.from(resumedOutput[0]), [2, 2.5])

send(processor, { type: 'audio', data: new Float32Array(130).fill(1) })
const overflowMessage = processor.port.messages[processor.port.messages.length - 1]
assert.equal(overflowMessage.type, 'overflow')
assert.equal(overflowMessage.droppedFrames, 2)
assert.equal(processor.availableFrames, 128)
const wrappedOutput = render(processor, makeOutput(1, 128))
assert.equal(wrappedOutput[0][0], 0.5)
assert.equal(wrappedOutput[0][127], 0.5)
assert.equal(processor.availableFrames, 0)

const stereoProcessor = new Processor({ processorOptions: { channelCount: 2, bufferSize: 128 } })
send(stereoProcessor, { type: 'audio', data: new Float32Array([1, -1, 0.5, -0.5]) })
send(stereoProcessor, { type: 'setGain', gain: 2 })
send(stereoProcessor, { type: 'play' })
const stereoOutput = render(stereoProcessor, makeOutput(2, 2))
assert.deepEqual(Array.from(stereoOutput[0]), [2, 1])
assert.deepEqual(Array.from(stereoOutput[1]), [-2, -1])

class MockAudioWorkletNode {
  constructor (context, name, options) {
    this.context = context
    this.name = name
    this.options = options
    this.port = { messages: [], postMessage (message) { this.messages.push(message) } }
  }
}

globalThis.AudioWorkletNode = MockAudioWorkletNode
const { ResonateAudioNode } = await import('./../packages/player-component/src/ResonateAudioNode.js')
const moduleUrls = []
const context = { audioWorklet: { async addModule (url) { moduleUrls.push(url) } } }
const node = await ResonateAudioNode.create(context, '/audio-processor.js', { channelCount: 2 })
assert.deepEqual(moduleUrls, ['/audio-processor.js'])
assert.equal(node.name, 'ResonateAudioProcessor')
assert.deepEqual(node.options.outputChannelCount, [2])
node.enqueueAudio(new Float32Array([1, 0.5, 0.25, 0.125])).setGain(0.75).play().pause()
assert.deepEqual(node.port.messages.map(message => message.type), ['audio', 'setGain', 'play', 'pause'])
assert.throws(() => node.enqueueAudio(new Float32Array([1])), /complete 2-channel frames/)
assert.throws(() => node.setGain(-1), /Gain/)

console.log('Audio worklet tests passed')
