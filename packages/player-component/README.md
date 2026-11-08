# Player audio worklet

`ResonateAudioNode` accepts interleaved `Float32Array` PCM and renders it from
an `AudioWorkletProcessor`, keeping sample buffering and gain scaling off the
main thread. The ring buffer is allocated once when the processor is created;
`process()` only reads and writes existing typed arrays.

```js
import { ResonateAudioNode } from './src/ResonateAudioNode.js'

const node = await ResonateAudioNode.create(
  audioContext,
  new URL('./src/ResonateAudioProcessor.js', import.meta.url).href,
  { channelCount: 2, bufferSize: 16384 }
)

node.connect(audioContext.destination)
node.enqueueAudio(interleavedPcmFloat32)
node.setGain(0.8)
node.play()
```

Call `pause()` to silence output without discarding buffered samples. For stereo,
audio samples are interleaved left/right. If the ring buffer fills, the oldest
queued samples are retained and an `overflow` message reports how many incoming
frames were dropped. Processor errors are reported as `error` messages on
`node.port`.

## Gapless buffer manager

`GaplessBufferManager` is an opt-in Web Audio playback path for decoded tracks.
It fetches the current track and next track as ArrayBuffers, decodes through an
`OfflineAudioContext` configured for a five-second prefetch window, then schedules
the decoded next track to crossfade during the final 500 ms of the current track.
The full decoded next buffer is retained so playback can continue past the
prefetch window. A prefetch network/decode failure is reported through `onError`
and does not stop the current source.

```js
import { GaplessBufferManager } from './src/GaplessBufferManager.js'

const buffers = new GaplessBufferManager(currentTrackUrl, nextTrackUrl, {
  onError: error => console.warn('Could not prefetch next track', error)
})

await buffers.playCurrent()
// Call prepareNext(url) for upcoming queue items after the current transition.
// Call destroy() when the Web Audio player is disposed.
```

## Clock-scheduled continuous playback

The native-ES-module services in `src/services` provide an opt-in scheduler and
adaptive prefetch path for Web Audio clients:

```js
import { GaplessAudioScheduler } from '../../src/services/GaplessAudioScheduler.js'
import { SmartPrefetchEngine } from '../../src/services/SmartPrefetchEngine.js'
import { MediaSessionAdapter } from '../../js/MediaSessionAdapter.js'

const context = new AudioContext()
const prefetchEngine = new SmartPrefetchEngine({ context })
const scheduler = new GaplessAudioScheduler({
  context,
  prefetchEngine,
  mediaSessionAdapter: new MediaSessionAdapter(),
  getNextTrack: track => queue.getFollowingTrack(track)
})

await scheduler.play(currentTrack, { nextTrack })
// Call scheduler.destroy() and context.close() when the player is disposed.
```

The scheduler checks queue progress without timer-based audio scheduling and
starts a decoded next track at the outgoing buffer's exact `AudioContext` end
time. Manual selections use a 100 ms equal-power ramp. `AudioNodeLifecycle`
disconnects ended/replaced sources, clears their buffers, and resumes active
contexts when the page is hidden and the browser has suspended them.

On 4G/5G, Wi-Fi, or Ethernet, the prefetch engine decodes the complete next
track and asks `sw.js` to cache the following track's first 256 KiB. On slow
networks or with Data Saver enabled, it limits precaching to 256 KiB of the
next track; that prefix is not a complete decodable track, so uninterrupted
playback on a constrained connection still depends on the network completing
the track before the current one ends. The service worker keeps those queue
prefixes in `continuous-queue-v1` and search prefixes in the FIFO-limited
`search-precache-v1` cache (20 MiB).

## Adaptive stream controller

`AdaptiveStreamController` monitors the Network Information API, selects an
available audio source that matches the current network profile, and emits
`network:state` and `stream:quality-change` events through a Choo-compatible
`state.events` bus. Data Saver and 3G use MP3 at 96 kbps with a five-second
prefetch target; 4G uses Opus at 128 kbps and broadband uses Opus at 256 kbps.
Only sources with explicit codec metadata are selected as Opus; when a matching
variant is not available, playback keeps its current source.

The browser player loads this controller before playback and initializes it
with the app event bus. Consumers can also instantiate it directly:

```js
const controller = new window.AdaptiveStreamController({
  connection: navigator.connection,
  bus: state.events,
  onStateChange: networkState => {
    console.log(networkState.prefetchSeconds)
  }
})
```

## Accessible audio player controls

`AccessibleAudioPlayer` is a Nanocomponent for Choo applications. It renders
a labeled player region with a keyboard-operable seek slider and controls,
updates the Media Session metadata and action handlers, and emits Choo bus
events when no callback is supplied. Keyboard shortcuts are active while the
component is mounted: Space toggles playback, Left/Right seek by five seconds,
Up/Down adjust volume by ten percent, and M toggles mute. Shortcuts do not
intercept typing in editable controls or native Space activation on buttons.

Load `src/AudioPlayer.css` alongside the component styles to provide visible
Tachyons `focus-ring` focus indicators without changing the control layout.

```js
import AccessibleAudioPlayer from '@resonate/player-component'

const player = new AccessibleAudioPlayer(state, {
  mediaSession: navigator.mediaSession
})

player.render({
  audio,
  track: {
    title: 'Track title',
    artist: 'Artist',
    album: 'Album',
    artwork: 'https://example.test/cover.jpg'
  },
  currentTime: audio.currentTime,
  duration: audio.duration
})
```

The component exports its event names as `AccessibleAudioPlayer.events`:
`player:play`, `player:pause`, `player:previous`, `player:next`, `player:seek`,
`player:volume`, and `player:mute`. Track callbacks (`onPlay`, `onPause`,
`onPreviousTrack`, `onNextTrack`, `onSeek`, `onVolumeChange`, and `onMuteChange`)
can be provided as render props to handle actions directly.
