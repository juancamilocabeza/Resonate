import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import AccessibleAudioPlayer from './src/AccessibleAudioPlayer.js'

const actionHandlers = new Map()
const mediaSession = {
  metadata: null,
  playbackState: 'none',
  setActionHandler (action, handler) {
    if (handler === null) actionHandlers.delete(action)
    else actionHandlers.set(action, handler)
  }
}
const emitted = []
const keyboardListeners = new Map()
const keyboardTarget = {
  addEventListener (type, listener) {
    keyboardListeners.set(type, listener)
  },
  removeEventListener (type, listener) {
    keyboardListeners.delete(type)
  }
}
class FakeMediaMetadata {
  constructor (metadata) {
    Object.assign(this, metadata)
  }
}

const audio = {
  currentTime: 12,
  duration: 90,
  volume: 0.5,
  muted: false,
  paused: false,
  pauseCalls: 0,
  playCalls: 0,
  play () {
    this.playCalls += 1
    this.paused = false
    return Promise.resolve()
  },
  pause () {
    this.pauseCalls += 1
    this.paused = true
  }
}
const player = new AccessibleAudioPlayer({
  audio,
  events: {
    emit (name, payload) {
      emitted.push({ name, payload })
    }
  }
}, {
  mediaSession,
  MediaMetadata: FakeMediaMetadata,
  keyboardTarget
})
const track = {
  title: 'Example Track',
  artist: 'Example Artist',
  album: 'Example Album',
  artwork: 'https://example.test/cover.jpg'
}
const props = { audio, track, currentTime: 12, duration: 90, volume: 0.5 }
const markup = String(player.createElement(props))
const styles = await readFile(new URL('./src/AudioPlayer.css', import.meta.url), 'utf8')

assert.match(markup, /role="region"/)
assert.match(markup, /aria-label="Audio Player"/)
assert.match(markup, /aria-valuemin="0"/)
assert.match(markup, /aria-valuemax="90"/)
assert.match(markup, /aria-valuenow="12"/)
assert.match(markup, /focus-ring/)
assert.match(styles, /\.focus-ring:focus-visible/)
assert.equal(mediaSession.metadata.title, 'Example Track')
assert.equal(mediaSession.metadata.artist, 'Example Artist')
assert.equal(mediaSession.metadata.album, 'Example Album')
assert.equal(mediaSession.metadata.artwork.length, 6)
assert.deepEqual([...actionHandlers.keys()].sort(), [
  'nexttrack',
  'pause',
  'play',
  'previoustrack',
  'seekbackward',
  'seekforward',
  'seekto'
])

actionHandlers.get('seekto')({ seekTime: 30 })
assert.equal(audio.currentTime, 30)
actionHandlers.get('seekbackward')({ seekOffset: 8 })
assert.equal(audio.currentTime, 22)
actionHandlers.get('seekforward')({ seekOffset: 4 })
assert.equal(audio.currentTime, 26)
actionHandlers.get('seekforward')({})
assert.equal(audio.currentTime, 36)
actionHandlers.get('pause')()
assert.equal(audio.pauseCalls, 1)
assert.equal(mediaSession.playbackState, 'paused')
actionHandlers.get('play')()
assert.equal(audio.playCalls, 1)
assert.equal(mediaSession.playbackState, 'playing')
actionHandlers.get('previoustrack')()
actionHandlers.get('nexttrack')()
assert.ok(emitted.some(event => event.name === 'player:previous'))
assert.ok(emitted.some(event => event.name === 'player:next'))

player.load()
assert.equal(keyboardListeners.has('keydown'), true)
const press = (code, target = { tagName: 'BODY' }) => {
  let prevented = false
  keyboardListeners.get('keydown')({
    code,
    target,
    preventDefault () { prevented = true }
  })
  return prevented
}
assert.equal(press('ArrowRight'), true)
assert.equal(audio.currentTime, 41)
assert.equal(press('ArrowLeft'), true)
assert.equal(audio.currentTime, 36)
assert.equal(press('ArrowUp'), true)
assert.equal(audio.volume, 0.6)
assert.equal(press('ArrowDown'), true)
assert.equal(audio.volume, 0.5)
assert.equal(press('KeyM'), true)
assert.equal(audio.muted, true)
assert.equal(press('Space'), true)
assert.equal(audio.pauseCalls, 2)
assert.equal(press('Space', { tagName: 'INPUT' }), false)
const seekbar = { tagName: 'INPUT', type: 'range' }
assert.equal(press('ArrowRight', seekbar), true)
assert.equal(audio.currentTime, 41)
assert.equal(press('Space', { tagName: 'BUTTON' }), false)
assert.ok(emitted.some(event => event.name === 'player:seek' && event.payload.time === 41))
assert.ok(emitted.some(event => event.name === 'player:volume' && event.payload.volume === 0.6))
assert.ok(emitted.some(event => event.name === 'player:mute' && event.payload.muted === true))

player.unload()
assert.equal(keyboardListeners.has('keydown'), false)
assert.equal(actionHandlers.size, 0)
assert.equal(mediaSession.metadata, null)
assert.equal(mediaSession.playbackState, 'none')

console.log('Accessible audio player tests passed')
