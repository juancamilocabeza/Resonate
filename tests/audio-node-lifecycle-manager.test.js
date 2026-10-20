import assert from 'node:assert/strict'
import {
  AudioNodeLifecycleManager,
  audioNodeLifecycleManager
} from '../packages/player-component/src/AudioNodeLifecycleManager.js'

class FakeSource {
  constructor () {
    this.buffer = null
    this.onended = null
    this.connections = []
    this.stopCalls = 0
    this.disconnected = false
  }

  connect (node) {
    this.connections.push(node)
  }

  start () {
    this.started = true
  }

  stop () {
    this.stopCalls += 1
  }

  disconnect () {
    this.disconnected = true
  }
}

class FakeGain {
  constructor () {
    this.connections = []
    this.disconnected = false
  }

  connect (node) {
    this.connections.push(node)
  }

  disconnect () {
    this.disconnected = true
  }
}

function createDestination () {
  const context = {
    sources: [],
    gains: [],
    createBufferSource () {
      const source = new FakeSource()
      this.sources.push(source)
      return source
    },
    createGain () {
      const gain = new FakeGain()
      this.gains.push(gain)
      return gain
    }
  }

  return { context }
}

const manager = new AudioNodeLifecycleManager()
const destination = createDestination()
const buffer = { duration: 4 }
const { sourceNode, gainNode } = manager.createSource(buffer, destination)

assert.equal(sourceNode.buffer, buffer)
assert.equal(sourceNode.started, true)
assert.deepEqual(sourceNode.connections, [gainNode])
assert.deepEqual(gainNode.connections, [destination])

manager.disposeNode(sourceNode, gainNode)
assert.equal(sourceNode.stopCalls, 1)
assert.equal(sourceNode.disconnected, true)
assert.equal(gainNode.disconnected, true)
assert.equal(sourceNode.buffer, null)
assert.equal(sourceNode.onended, null)
assert.equal(manager.nodes.size, 0)

const endedNodes = manager.createSource(buffer, destination)
const endedSource = endedNodes.sourceNode
endedSource.onended()
assert.equal(endedSource.stopCalls, 0)
assert.equal(endedSource.buffer, null)
assert.equal(endedNodes.gainNode.disconnected, true)
assert.equal(manager.nodes.size, 0)

const cleanupNodes = manager.createSource(buffer, destination)
manager.cleanupAll()
assert.equal(cleanupNodes.sourceNode.stopCalls, 1)
assert.equal(cleanupNodes.sourceNode.buffer, null)
assert.equal(manager.nodes.size, 0)
assert.equal(audioNodeLifecycleManager.nodes.size, 0)

assert.throws(() => manager.createSource(buffer, {}), TypeError)

console.log('Audio node lifecycle manager tests passed')
