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
