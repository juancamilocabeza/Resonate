import assert from 'node:assert/strict'
import { MediaSessionAdapter } from '../js/MediaSessionAdapter.js'

class MockMediaMetadata {
  constructor (details) {
    Object.assign(this, details)
  }
}

const actionHandlers = new Map()
const positionStates = []
const mediaSession = {
  metadata: null,
  setActionHandler (action, handler) {
    actionHandlers.set(action, handler)
  },
  setPositionState (state) {
    positionStates.push(state)
  }
}
const seeks = []
const player = {
  audio: { currentTime: 15 },
  play () {},
  pause () {},
  playPrevious () {},
  playNext () {},
  seekTo (time) {
    seeks.push(time)
  }
}
const adapter = new MediaSessionAdapter({
  mediaSession,
  MediaMetadata: MockMediaMetadata,
  player
})

assert.equal(adapter.isSupported, true)
assert.equal(adapter.updateMetadata({
  title: 'Example Track',
  artist: 'Example Artist',
  album: 'Example Album',
  artwork: 'https://example.test/cover.png'
}), true)
assert.equal(mediaSession.metadata.title, 'Example Track')
assert.equal(mediaSession.metadata.artist, 'Example Artist')
assert.equal(mediaSession.metadata.album, 'Example Album')
assert.deepEqual(mediaSession.metadata.artwork.map(image => image.sizes), [
  '96x96',
  '128x128',
  '256x256',
  '512x512'
])
assert.ok(mediaSession.metadata.artwork.every(image =>
  image.src === 'https://example.test/cover.png' && image.type === 'image/png'
))

assert.equal(adapter.updatePositionState(120, 1.25, 135), true)
assert.deepEqual(positionStates, [{ duration: 120, playbackRate: 1.25, position: 120 }])
assert.equal(adapter.updatePositionState(0, 1, 1), false)

assert.equal(adapter.registerActionHandlers(), true)
assert.deepEqual(Array.from(actionHandlers.keys()), [
  'play',
  'pause',
  'previoustrack',
  'nexttrack',
  'seekto',
  'seekbackward',
  'seekforward'
])
actionHandlers.get('seekto')({ seekTime: 42 })
assert.deepEqual(seeks, [42])
actionHandlers.get('seekbackward')({ seekOffset: 5 })
actionHandlers.get('seekforward')({})
assert.deepEqual(seeks, [42, 10, 25])

let debugSeekTime
const debugAdapter = new MediaSessionAdapter({
  mediaSession,
  MediaMetadata: MockMediaMetadata,
  player
})
debugAdapter.registerActionHandlers({
  onSeekTo (seekTime) {
    debugSeekTime = seekTime
  }
})
actionHandlers.get('seekto')({ seekTime: 73 })
assert.equal(debugSeekTime, 73)

const unsupportedAdapter = new MediaSessionAdapter({
  mediaSession: null,
  MediaMetadata: MockMediaMetadata
})
assert.equal(unsupportedAdapter.isSupported, false)
assert.equal(unsupportedAdapter.updateMetadata({ title: 'Unavailable' }), false)
assert.equal(unsupportedAdapter.updatePositionState(60, 1, 10), false)
assert.equal(unsupportedAdapter.registerActionHandlers(), false)

console.log('Media session adapter tests passed')
