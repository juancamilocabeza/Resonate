import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const listeners = new Map()
const attributes = {}
attributes['aria-label'] = 'Track title'
const classes = new Set()
const icons = []
const row = {
  dataset: { trackUrl: 'https://audio.example.test/track.mp3' },
  classList: {
    toggle (name, enabled) {
      if (enabled) classes.add(name)
      else classes.delete(name)
    }
  },
  setAttribute (name, value) {
    attributes[name] = value
  },
  getAttribute (name) {
    return attributes[name] || null
  },
  querySelector (selector) {
    return selector === '.offline-track-status' ? icons[0] || null : null
  },
  appendChild (element) {
    icons.push(element)
  }
}
const partialResponse = {
  status: 200,
  headers: {
    get (name) {
      return name === 'X-Audio-Precache-Partial' ? 'true' : null
    },
    has (name) {
      return name === 'X-Audio-Precache-Content-Range'
    }
  }
}
const fullResponse = {
  status: 200,
  headers: {
    get () {
      return null
    },
    has () {
      return false
    }
  }
}
const cacheEntries = new Map([
  ['continuous-queue-v1', partialResponse],
  ['search-precache-v1', null],
  ['audio-cache-v1', null],
  ['resonate-audio-v1', fullResponse],
  ['audio-precache-v1', partialResponse]
])
const caches = {
  async keys () {
    return Array.from(cacheEntries.keys())
  },
  async open (name) {
    return {
      async match (url) {
        return url === 'https://audio.example.test/track.mp3'
          ? cacheEntries.get(name)
          : null
      }
    }
  }
}
const document = {
  documentElement: null,
  querySelectorAll () {
    return [row]
  },
  createElement () {
    return {
      className: '',
      textContent: '',
      title: '',
      setAttribute (name, value) {
        this[name] = value
      }
    }
  }
}
const announcements = []
const window = {
  document,
  caches,
  navigator: { onLine: true },
  state: { networkOnline: true },
  location: { href: 'https://app.example.test/' },
  addEventListener (event, listener) {
    listeners.set(event, listener)
  },
  setTimeout,
  clearTimeout,
  A11yAnnouncer: {
    announce (message, priority) {
      announcements.push({ message, priority })
    }
  }
}
const context = { window, document, caches, URL, console }
vm.createContext(context)
const source = await readFile(new URL('../js/OfflineStatusManager.js', import.meta.url), 'utf8')
vm.runInContext(source, context)

const manager = window.OfflineStatusManager
const availability = await manager.checkTrackAvailability(row.dataset.trackUrl)
assert.deepEqual(
  { available: availability.available, complete: availability.complete, partial: availability.partial },
  { available: true, complete: true, partial: false }
)
const missingAvailability = await manager.checkTrackAvailability('https://audio.example.test/missing.mp3')
assert.equal(missingAvailability.available, false)
assert.equal(missingAvailability.complete, false)
assert.equal(missingAvailability.partial, false)

cacheEntries.set('resonate-audio-v1', null)
const partialAvailability = await manager.checkTrackAvailability(row.dataset.trackUrl)
assert.deepEqual(
  { available: partialAvailability.available, complete: partialAvailability.complete, partial: partialAvailability.partial },
  { available: true, complete: false, partial: true }
)

await manager.updateQueueStatus()
assert.equal(row.dataset.offlineAvailability, 'partial')
assert.ok(classes.has('offline-track-partial'))
assert.equal(icons[0].textContent, '◧')
assert.match(attributes['aria-label'], /partially available offline/)

window.navigator.onLine = false
listeners.get('offline')()
assert.equal(window.state.networkOnline, false)
assert.equal(classes.has('o-50'), false)
assert.equal(announcements[0].priority, 'assertive')
assert.match(announcements[0].message, /Sin conexión/)

cacheEntries.set('continuous-queue-v1', null)
cacheEntries.set('audio-precache-v1', null)
await manager.updateQueueStatus()
assert.equal(row.dataset.offlineAvailability, 'network-required')
assert.ok(classes.has('o-50'))
assert.equal(icons[0].textContent, '☁')

console.log('Offline status manager tests passed')
