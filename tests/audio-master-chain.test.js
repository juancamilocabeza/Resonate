import assert from 'node:assert/strict'
import { AudioMasterChain } from '../js/AudioMasterChain.js'

function createAudioParam () {
  return {
    value: 0,
    targetCalls: [],
    setTargetAtTime (value, time, constant) {
      this.targetCalls.push({ value, time, constant })
    }
  }
}

function createNode (parameters = []) {
  const connections = []
  const disconnections = []
  const node = {
    connections,
    disconnections,
    connect (destination) {
      connections.push(destination)
    },
    disconnect (destination) {
      disconnections.push(destination)
    }
  }

  parameters.forEach(parameter => {
    node[parameter] = createAudioParam()
  })

  return node
}

const destination = {}
const gainNode = createNode(['gain'])
const compressorNode = createNode(['threshold', 'knee', 'ratio', 'attack', 'release'])
const audioContext = {
  currentTime: 4.25,
  destination,
  createGain: () => gainNode,
  createDynamicsCompressor: () => compressorNode
}

const chain = new AudioMasterChain(audioContext)

assert.equal(compressorNode.threshold.value, -24)
assert.equal(compressorNode.knee.value, 30)
assert.equal(compressorNode.ratio.value, 12)
assert.equal(compressorNode.attack.value, 0.003)
assert.equal(compressorNode.release.value, 0.25)
assert.deepEqual(gainNode.connections, [compressorNode])
assert.deepEqual(compressorNode.connections, [destination])
assert.equal(chain.compressionEnabled, true)

assert.equal(chain.setLogarithmicVolume(0.5), 0.25)
assert.deepEqual(gainNode.gain.targetCalls, [
  { value: 0.25, time: 4.25, constant: 0.01 }
])
assert.equal(chain.setLogarithmicVolume(0), 0)
assert.equal(chain.setLogarithmicVolume(1), 1)
assert.equal(chain.setLogarithmicVolume(2), 1)
assert.throws(() => chain.setLogarithmicVolume(Number.NaN), /finite number/)

assert.equal(chain.setCompressionEnabled(false), false)
assert.deepEqual(compressorNode.disconnections, [destination])
assert.deepEqual(gainNode.connections, [compressorNode, destination])
assert.equal(chain.toggleCompression(), true)
assert.deepEqual(gainNode.disconnections, [destination])
assert.deepEqual(compressorNode.connections, [destination, destination])
assert.equal(chain.toggleCompression(), false)

assert.throws(() => new AudioMasterChain({}), /requires an AudioContext/)

console.log('Audio master chain tests passed')
